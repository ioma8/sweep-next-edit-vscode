import * as assert from "node:assert";
import * as vscode from "vscode";
import type { NextEditPredictor, NextEditRequest } from "../../model/nextEditPredictor";
import { DocumentTextStore } from "../../provider/documentTextStore";
import { NextEditInlineProvider } from "../../provider/nextEditInlineProvider";

class FakePredictor implements NextEditPredictor {
  constructor(private readonly predict: (req: NextEditRequest) => string | Promise<string>) {}
  async predictNextEdit(request: NextEditRequest): Promise<string> {
    return await this.predict(request);
  }
}

suite("Inline provider", () => {
  test("returns a window replacement suggestion when prediction differs", async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: ["0", "1", "2", "3", "4"].join("\n")
    });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(new vscode.Position(2, 1), new vscode.Position(2, 1));

    const store = new DocumentTextStore();
    store.track(doc);

    const predictor = new FakePredictor((req) => {
      assert.strictEqual(req.filePath.endsWith(doc.fileName.split("/").pop() ?? ""), true);
      const cursorOffset = req.currentWindow.indexOf("2") + 1;
      return req.currentWindow.slice(0, cursorOffset) + "X" + req.currentWindow.slice(cursorOffset);
    });

    const provider = new NextEditInlineProvider(
      predictor,
      () => ({ enabled: true, contextLines: 1 }),
      (d) => store.getPreviousText(d)
    );

    const res = await provider.provideInlineCompletionItems(
      doc,
      new vscode.Position(2, 1),
      { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined },
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(res.items.length, 1);
    const item = res.items[0];
    assert.strictEqual(item.insertText, "X");
    assert.deepStrictEqual(item.range, new vscode.Range(new vscode.Position(2, 1), new vscode.Position(2, 1)));
    assert.strictEqual(item.command?.command, "sweepNextEdit.applyWindowPrediction");
  });
});
