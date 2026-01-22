import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { DocumentTextStore } from "./provider/documentTextStore";
import { LlamaCppNextEditPredictor } from "./model/llamaCppNextEditPredictor";
import type { Logger } from "./logging";
import { SuggestionController } from "./suggestion/suggestionController";

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
  void predictor.init();

  context.subscriptions.push(output);
  void vscode.commands.executeCommand("setContext", "sweepNextEdit.suggestionActive", false);

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((d) => store.track(d)));

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      store.onDidChangeTextDocument(e);
    })
  );

  const controller = new SuggestionController(predictor, logger, (doc) => store.getPreviousText(doc));
  controller.start();
  context.subscriptions.push(controller);

  context.subscriptions.push(
    vscode.commands.registerCommand("sweepNextEdit.acceptSuggestion", async () => {
      await controller.acceptSuggestion();
    })
  );
}

export function deactivate() {}
