import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Extension smoke test", () => {
  test("extension activates", async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === "sweep-next-edit-vscode");
    assert.ok(ext, "extension should be present");
    await ext.activate();
    assert.ok(ext.isActive, "extension should be active");
  });
});

