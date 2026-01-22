import * as vscode from "vscode";
import * as path from "node:path";
import type { Logger } from "../logging";
import type { NextEditPredictor } from "../model/nextEditPredictor";
import { computeRecentDiffSnippet } from "../core/recentDiff";
import { getWindowLineSpan } from "../core/window";

type Suggestion = {
  docUri: string;
  docVersion: number;
  cursor: vscode.Position;
  windowStartLine: number;
  windowEndLineExclusive: number;
  currentWindow: string;
  predictedWindow: string;
};

export class SuggestionController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationType: vscode.TextEditorDecorationType;
  private triggerTimer: NodeJS.Timeout | undefined;
  private inFlightAbort: AbortController | undefined;
  private suggestion: Suggestion | undefined;

  constructor(
    private readonly predictor: NextEditPredictor,
    private readonly logger: Logger,
    private readonly getPreviousText: (doc: vscode.TextDocument) => string | undefined
  ) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: { color: new vscode.ThemeColor("editorGhostText.foreground") }
    });
    this.disposables.push(this.decorationType);
  }

  start() {
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.clearSuggestion("active editor changed")));
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document.uri.toString() !== vscode.window.activeTextEditor?.document.uri.toString()) return;
        this.clearSuggestion("cursor moved");
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== e.document.uri.toString()) return;
        if (!vscode.workspace.getConfiguration("sweepNextEdit").get<boolean>("enabled", true)) return;
        this.schedulePrediction(editor);
      })
    );
  }

  dispose() {
    this.clearTimer();
    this.abortInFlight();
    this.clearSuggestion("disposed");
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  async acceptSuggestion() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.suggestion) return;
    if (editor.document.uri.toString() !== this.suggestion.docUri) return;
    if (editor.document.version !== this.suggestion.docVersion) {
      this.logger.warn(
        `Skipping accept: document version changed (expected=${this.suggestion.docVersion}, actual=${editor.document.version}).`
      );
      this.clearSuggestion("stale version");
      return;
    }

    const doc = editor.document;
    const start = new vscode.Position(Math.max(0, this.suggestion.windowStartLine), 0);
    const end =
      this.suggestion.windowEndLineExclusive < doc.lineCount
        ? new vscode.Position(Math.max(0, this.suggestion.windowEndLineExclusive), 0)
        : doc.lineAt(doc.lineCount - 1).range.end;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(start, end), this.suggestion.predictedWindow);
    const ok = await vscode.workspace.applyEdit(edit);
    this.logger.info(`Accepted suggestion (ok=${String(ok)}).`);
    this.clearSuggestion("accepted");
  }

  private clearTimer() {
    if (this.triggerTimer) clearTimeout(this.triggerTimer);
    this.triggerTimer = undefined;
  }

  private abortInFlight() {
    if (!this.inFlightAbort) return;
    this.inFlightAbort.abort();
    this.inFlightAbort = undefined;
  }

  private clearSuggestion(reason: string) {
    this.suggestion = undefined;
    void vscode.commands.executeCommand("setContext", "sweepNextEdit.suggestionActive", false);
    const editor = vscode.window.activeTextEditor;
    if (editor) editor.setDecorations(this.decorationType, []);
    this.logger.info(`Cleared suggestion (${reason}).`);
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

  private buildHoverMarkdown(currentWindow: string, predictedWindow: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    const diff = computeRecentDiffSnippet(currentWindow, predictedWindow);
    if (!diff) return md;

    const originalLines = diff.original.length === 0 ? [] : diff.original.split("\n");
    const updatedLines = diff.updated.length === 0 ? [] : diff.updated.split("\n");
    const lines = [
      ...originalLines.map((l) => `- ${l}`),
      ...updatedLines.map((l) => `+ ${l}`)
    ];
    md.appendCodeblock(lines.join("\n"), "diff");
    return md;
  }

  private showSuggestion(editor: vscode.TextEditor, suggestion: Suggestion) {
    this.suggestion = suggestion;
    void vscode.commands.executeCommand("setContext", "sweepNextEdit.suggestionActive", true);

    const hover = this.buildHoverMarkdown(suggestion.currentWindow, suggestion.predictedWindow);
    const cursorRange = new vscode.Range(suggestion.cursor, suggestion.cursor);
    editor.setDecorations(this.decorationType, [
      {
        range: cursorRange,
        renderOptions: { after: { contentText: "  ⇥ Sweep suggestion" } },
        hoverMessage: hover
      }
    ]);

    setTimeout(() => {
      void vscode.commands.executeCommand("editor.action.showHover").then(
        () => {},
        (err) => this.logger.error("Failed to show hover popup.", err)
      );
    }, 0);
  }

  private schedulePrediction(editor: vscode.TextEditor) {
    this.clearTimer();
    this.abortInFlight();
    this.clearSuggestion("typing");

    const debounceMs = vscode.workspace.getConfiguration("sweepNextEdit").get<number>("triggerDebounceMs", 250);
    this.triggerTimer = setTimeout(() => {
      void this.runPrediction(editor);
    }, debounceMs);
  }

  private async runPrediction(editor: vscode.TextEditor) {
    const doc = editor.document;
    const position = editor.selection.active;
    const startingVersion = doc.version;

    const contextLines = vscode.workspace.getConfiguration("sweepNextEdit").get<number>("contextLines", 10);
    const span = getWindowLineSpan({ totalLines: doc.lineCount, cursorLine: position.line, contextLines });

    const start = new vscode.Position(span.startLine, 0);
    const end = span.endLineExclusive < doc.lineCount ? new vscode.Position(span.endLineExclusive, 0) : doc.lineAt(doc.lineCount - 1).range.end;
    const windowRange = new vscode.Range(start, end);

    const currentWindow = doc.getText(windowRange);

    const previousFullText = this.getPreviousText(doc);
    const recentDiffSnippet = previousFullText ? computeRecentDiffSnippet(previousFullText, doc.getText()) : undefined;
    const recentDiffs =
      recentDiffSnippet == null ? [] : [{ filePath: this.getDocumentDisplayPath(doc), original: recentDiffSnippet.original, updated: recentDiffSnippet.updated }];

    const originalWindow = previousFullText ? this.extractWindowFromFullText(previousFullText, span) : currentWindow;

    const contextFiles = this.collectContextFiles(doc);

    this.logger.info(
      `Predicting: file=${this.getDocumentDisplayPath(doc)} v${doc.version} line=${position.line + 1} windowLines=${span.startLine + 1}-${span.endLineExclusive} contextFiles=${Object.keys(contextFiles).length} recentDiffs=${recentDiffs.length}`
    );

    const abortController = new AbortController();
    this.inFlightAbort = abortController;

    let predictedWindow: string;
    try {
      predictedWindow = await this.predictor.predictNextEdit(
        {
          filePath: this.getDocumentDisplayPath(doc),
          originalWindow,
          currentWindow,
          contextFiles,
          recentDiffs
        },
        abortController.signal
      );
    } catch (err) {
      this.logger.error("Prediction failed.", err);
      return;
    } finally {
      if (this.inFlightAbort === abortController) this.inFlightAbort = undefined;
    }

    if (abortController.signal.aborted) return;
    if (doc.isClosed) return;
    if (doc.version !== startingVersion) return;
    if (predictedWindow === currentWindow) return;

    this.showSuggestion(editor, {
      docUri: doc.uri.toString(),
      docVersion: doc.version,
      cursor: position,
      windowStartLine: span.startLine,
      windowEndLineExclusive: span.endLineExclusive,
      currentWindow,
      predictedWindow
    });
  }

  private extractWindowFromFullText(fullText: string, span: { startLine: number; endLineExclusive: number }): string {
    const lines = fullText.split("\n");
    const sliced = lines.slice(span.startLine, span.endLineExclusive).join("\n");
    return span.endLineExclusive < lines.length ? `${sliced}\n` : sliced;
  }
}
