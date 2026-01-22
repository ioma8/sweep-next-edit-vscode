import * as vscode from "vscode";
import * as path from "node:path";
import type { NextEditPredictor } from "../model/nextEditPredictor";
import { computeRecentDiffSnippet } from "../core/recentDiff";
import { getWindowLineSpan } from "../core/window";
import type { Logger } from "../logging";
import { createNoopLogger } from "../logging";

export type NextEditProviderConfig = {
  enabled: boolean;
  contextLines: number;
};

export class NextEditInlineProvider implements vscode.InlineCompletionItemProvider {
  private readonly logger: Logger;
  private readonly inFlightByDoc = new Map<
    string,
    {
      controller: AbortController;
      requestId: number;
      version: number;
      line: number;
      promise: Promise<string>;
    }
  >();
  private readonly lastResultByDoc = new Map<
    string,
    {
      version: number;
      line: number;
      currentWindow: string;
      predicted: string;
    }
  >();

  constructor(
    private readonly predictor: NextEditPredictor,
    private readonly getConfig: () => NextEditProviderConfig,
    private readonly getOriginalText: (doc: vscode.TextDocument) => string | undefined,
    logger?: Logger
  ) {
    this.logger = logger ?? createNoopLogger();
  }

  private getWindowTextFromString(text: string, span: { startLine: number; endLineExclusive: number }): string {
    const lines = text.split("\n");
    const sliced = lines.slice(span.startLine, span.endLineExclusive).join("\n");
    return span.endLineExclusive < lines.length ? `${sliced}\n` : sliced;
  }

  private getDocumentDisplayPath(document: vscode.TextDocument): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) return path.basename(document.fileName);
    const rel = path.relative(workspaceFolder.uri.fsPath, document.fileName);
    return rel.length === 0 ? path.basename(document.fileName) : rel;
  }

  private collectContextFiles(currentDoc: vscode.TextDocument): Record<string, string> {
    const maxFiles = vscode.workspace.getConfiguration("sweepNextEdit").get<number>("contextFileCount", 4);
    const maxCharsPerFile = vscode.workspace.getConfiguration("sweepNextEdit").get<number>("contextFileMaxChars", 8000);

    const contextDocs = vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === "file" && d.uri.toString() !== currentDoc.uri.toString())
      .slice(0, Math.max(0, maxFiles));

    const out: Record<string, string> = {};
    for (const doc of contextDocs) {
      const key = this.getDocumentDisplayPath(doc);
      const text = doc.getText();
      out[key] = text.length > maxCharsPerFile ? text.slice(0, maxCharsPerFile) : text;
    }
    return out;
  }

  private normalizePredictedWindow(predictedWindow: string, currentWindow: string): string {
    if (predictedWindow.startsWith("\n") && !currentWindow.startsWith("\n")) return predictedWindow.slice(1);
    return predictedWindow;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList> {
    const config = this.getConfig();
    if (!config.enabled) return { items: [] };

    const ignoreAutomatic = vscode.workspace.getConfiguration("sweepNextEdit").get<boolean>("ignoreAutomaticTrigger", true);
    if (ignoreAutomatic && context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      this.logger.info("Ignoring automatic inline completion trigger.");
      return { items: [] };
    }

    const span = getWindowLineSpan({
      totalLines: document.lineCount,
      cursorLine: position.line,
      contextLines: config.contextLines
    });

    const start = new vscode.Position(span.startLine, 0);
    const end = span.endLineExclusive < document.lineCount ? new vscode.Position(span.endLineExclusive, 0) : document.lineAt(document.lineCount - 1).range.end;

    const windowRange = new vscode.Range(start, end);
    const currentWindow = document.getText(windowRange);

    const originalText = this.getOriginalText(document) ?? document.getText();
    const originalWindow = this.getWindowTextFromString(originalText, span);
    const filePathForPrompt = this.getDocumentDisplayPath(document);
    const contextFiles = this.collectContextFiles(document);
    const previousFullText = this.getOriginalText(document);
    const currentFullText = document.getText();
    const recentDiffSnippet = previousFullText ? computeRecentDiffSnippet(previousFullText, currentFullText) : undefined;
    const recentDiffs =
      recentDiffSnippet == null ? [] : [{ filePath: filePathForPrompt, original: recentDiffSnippet.original, updated: recentDiffSnippet.updated }];
    this.logger.info(
      `Prompt inputs: contextFiles=${Object.keys(contextFiles).length} recentDiffs=${recentDiffs.length} filePath=${filePathForPrompt}`
    );

    const docKey = document.uri.toString();
    const cached = this.lastResultByDoc.get(docKey);
    if (cached && cached.version === document.version && cached.line === position.line && cached.currentWindow === currentWindow) {
      if (cached.predicted !== currentWindow) {
        let predicted = cached.predicted;
        if (end.character === 0 && span.endLineExclusive < document.lineCount && !predicted.endsWith("\n")) {
          predicted = `${predicted}\n`;
        }
        this.logger.info(`Using cached suggestion v${document.version} line ${position.line + 1}`);
        const item = new vscode.InlineCompletionItem(predicted, new vscode.Range(start, end));
        return { items: [item] };
      }
      return { items: [] };
    }

    const prev = this.inFlightByDoc.get(docKey);
    let requestId: number;
    let predicted: string;
    try {
      if (prev && prev.version === document.version && prev.line === position.line) {
        requestId = prev.requestId;
        this.logger.info(`Reusing in-flight request v${document.version} line ${position.line + 1}`);
        if (token.isCancellationRequested) return { items: [] };
        predicted = await prev.promise;
      } else {
        if (prev) {
          this.logger.info(`Aborting previous request v${prev.version} line ${prev.line + 1}`);
          prev.controller.abort();
        }

        const abortController = new AbortController();
        requestId = (prev?.requestId ?? 0) + 1;
        const promise = this.predictor.predictNextEdit(
          { filePath: filePathForPrompt, originalWindow, currentWindow, contextFiles, recentDiffs },
          abortController.signal
        );
        this.inFlightByDoc.set(docKey, {
          controller: abortController,
          requestId,
          version: document.version,
          line: position.line,
          promise
        });

        this.logger.info(`Predict request: ${path.basename(document.fileName)} v${document.version} @ line ${position.line + 1}`);
        if (token.isCancellationRequested) return { items: [] };
        predicted = await promise;
        if (this.inFlightByDoc.get(docKey)?.requestId === requestId) this.inFlightByDoc.delete(docKey);
        this.lastResultByDoc.set(docKey, { version: document.version, line: position.line, currentWindow, predicted });
      }
    } catch (err) {
      this.logger.warn("Predictor threw; returning no suggestions.");
      this.logger.error("Predictor error details:", err);
      return { items: [] };
    }

    if (token.isCancellationRequested) return { items: [] };
    const inflight = this.inFlightByDoc.get(docKey);
    if (inflight && inflight.requestId !== requestId) return { items: [] };
    if (predicted === currentWindow) return { items: [] };

    predicted = this.normalizePredictedWindow(predicted, currentWindow);

    const cursorLineIndexInWindow = position.line - start.line;
    const predictedLines = predicted.split("\n");
    if (cursorLineIndexInWindow < 0 || cursorLineIndexInWindow >= predictedLines.length) {
      this.logger.warn(
        `Predicted output has unexpected line count (predictedLines=${predictedLines.length}, cursorLineIndexInWindow=${cursorLineIndexInWindow}); skipping.`
      );
      return { items: [] };
    }

    const predictedLine = predictedLines[cursorLineIndexInWindow] ?? "";
    const insertText = predictedLine.slice(position.character);
    if (insertText.length === 0) return { items: [] };

    const cursorLineRange = document.lineAt(position.line).range;
    const replaceRange = new vscode.Range(position, cursorLineRange.end);

    this.logger.info(`Suggestion produced (insertChars=${insertText.length}).`);
    const item = new vscode.InlineCompletionItem(insertText, replaceRange, {
      command: "sweepNextEdit.applyWindowPrediction",
      title: "Apply Sweep Next Edit",
      arguments: [
        {
          uri: document.uri.toString(),
          docVersion: document.version,
          startLine: span.startLine,
          endLineExclusive: span.endLineExclusive,
          predictedWindow: predicted
        }
      ]
    });
    return { items: [item] };
  }
}
