import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { DocumentTextStore } from "./provider/documentTextStore";
import { NextEditInlineProvider } from "./provider/nextEditInlineProvider";
import { LlamaCppNextEditPredictor } from "./model/llamaCppNextEditPredictor";
import type { Logger } from "./logging";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Sweep Next Edit");
  const logger: Logger = {
    info: (m) => output.appendLine(`[info] ${m}`),
    warn: (m) => output.appendLine(`[warn] ${m}`),
    error: (m, e) => output.appendLine(`[error] ${m}${e ? `\n${String(e)}` : ""}`)
  };

  const isLoggingEnabled = () => vscode.workspace.getConfiguration("sweepNextEdit").get<boolean>("logging", true);
  if (isLoggingEnabled()) output.show(true);
  logger.info(
    `editor.inlineSuggest.enabled=${String(
      vscode.workspace.getConfiguration("editor").get("inlineSuggest.enabled", true)
    )}`
  );

  const store = new DocumentTextStore();

  for (const doc of vscode.workspace.textDocuments) store.track(doc);

  const findDefaultModelPath = (): string => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return "";
    const modelCandidate = path.join(folder.uri.fsPath, "sweep-next-edit-1.5b.q8_0.v2.gguf");
    return fs.existsSync(modelCandidate) ? modelCandidate : "";
  };

  const getProviderConfig = () => {
    const cfg = vscode.workspace.getConfiguration("sweepNextEdit");
    return {
      enabled: cfg.get<boolean>("enabled", true),
      contextLines: cfg.get<number>("contextLines", 10)
    };
  };

  const predictor = new LlamaCppNextEditPredictor(() => {
    const cfg = vscode.workspace.getConfiguration("sweepNextEdit");
    const configuredPath = cfg.get<string>("modelPath", "").trim();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const modelPath =
      configuredPath.length === 0
        ? findDefaultModelPath()
        : path.isAbsolute(configuredPath)
          ? configuredPath
          : path.join(workspaceFolder, configuredPath);

    if (isLoggingEnabled()) logger.info(`Resolved modelPath=${modelPath || "<empty>"}`);
    return {
      modelPath,
      maxTokens: cfg.get<number>("maxTokens", 512),
      contextSize: 8192
    };
  }, logger);

  const provider = new NextEditInlineProvider(
    predictor,
    getProviderConfig,
    (doc) => store.getPreviousText(doc),
    logger
  );

  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    provider
  );

  context.subscriptions.push(disposable);
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sweepNextEdit.applyWindowPrediction",
      async (args: {
        uri: string;
        docVersion: number;
        startLine: number;
        endLineExclusive: number;
        predictedWindow: string;
      }) => {
        try {
          const uri = vscode.Uri.parse(args.uri);
          const doc = await vscode.workspace.openTextDocument(uri);
          if (doc.version !== args.docVersion) {
            logger.warn(`Skipping apply: document version changed (expected=${args.docVersion}, actual=${doc.version}).`);
            return;
          }

          const start = new vscode.Position(Math.max(0, args.startLine), 0);
          const end =
            args.endLineExclusive < doc.lineCount
              ? new vscode.Position(Math.max(0, args.endLineExclusive), 0)
              : doc.lineAt(doc.lineCount - 1).range.end;

          const range = new vscode.Range(start, end);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(uri, range, args.predictedWindow);

          const ok = await vscode.workspace.applyEdit(edit);
          logger.info(`Applied window prediction (ok=${String(ok)}).`);
        } catch (err) {
          logger.error("Failed to apply window prediction.", err);
        }
      }
    )
  );

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((d) => store.track(d)));

  let triggerTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      store.onDidChangeTextDocument(e);
      const config = getProviderConfig();
      const editor = vscode.window.activeTextEditor;
      if (!config.enabled || !editor || editor.document.uri.toString() !== e.document.uri.toString()) return;

      if (triggerTimer) clearTimeout(triggerTimer);
      const debounceMs = vscode.workspace.getConfiguration("sweepNextEdit").get<number>("triggerDebounceMs", 250);
      triggerTimer = setTimeout(() => {
        if (isLoggingEnabled()) logger.info("Triggering inline suggest.");
        void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger").then(
          () => {},
          (err) => logger.error("Failed to execute inline suggest trigger command.", err)
        );
      }, debounceMs);
    })
  );
}

export function deactivate() {}
