import * as assert from "node:assert";
import { buildPrompt } from "../../core/prompt";
import { computeRecentDiffSnippet } from "../../core/recentDiff";
import { toUnifiedDiff } from "../../core/unifiedDiff";
import { getWindowLineSpan, replaceLineSpan } from "../../core/window";

suite("Core utilities", () => {
  test("getWindowLineSpan clamps to file bounds", () => {
    assert.deepStrictEqual(
      getWindowLineSpan({ totalLines: 5, cursorLine: 0, contextLines: 2 }),
      { startLine: 0, endLineExclusive: 3 }
    );

    assert.deepStrictEqual(
      getWindowLineSpan({ totalLines: 5, cursorLine: 4, contextLines: 2 }),
      { startLine: 2, endLineExclusive: 5 }
    );
  });

  test("buildPrompt matches Sweep training format", () => {
    const prompt = buildPrompt({
      filePath: "src/main.ts",
      originalContent: "a\nb\n",
      currentContent: "a\nb\nc\n"
    });

    assert.strictEqual(
      prompt,
      [
        "<|file_sep|>original/src/main.ts",
        "a\nb\n",
        "<|file_sep|>current/src/main.ts",
        "a\nb\nc\n",
        "<|file_sep|>updated/src/main.ts"
      ].join("\n")
    );
  });

  test("buildPrompt includes context files and recent diffs in format order", () => {
    const prompt = buildPrompt({
      contextFiles: { "b.txt": "B", "a.txt": "A" },
      recentDiffs: [{ filePath: "x.ts", original: "old", updated: "new" }],
      filePath: "main.ts",
      originalContent: "orig",
      currentContent: "curr"
    });

    assert.strictEqual(
      prompt,
      [
        "<|file_sep|>a.txt",
        "A",
        "<|file_sep|>b.txt",
        "B",
        "<|file_sep|>x.ts.diff",
        "original:",
        "old",
        "updated:",
        "new",
        "<|file_sep|>original/main.ts",
        "orig",
        "<|file_sep|>current/main.ts",
        "curr",
        "<|file_sep|>updated/main.ts"
      ].join("\n")
    );
  });

  test("replaceLineSpan replaces an inclusive line window", () => {
    const text = ["0", "1", "2", "3", "4"].join("\n");
    const updated = replaceLineSpan({
      text,
      span: { startLine: 1, endLineExclusive: 4 },
      replacement: ["A", "B", "C"].join("\n")
    });

    assert.strictEqual(updated, ["0", "A", "B", "C", "4"].join("\n"));
  });

  test("computeRecentDiffSnippet returns minimal changed line block", () => {
    const prev = ["a", "b", "c", "d"].join("\n");
    const curr = ["a", "b", "X", "d"].join("\n");
    assert.deepStrictEqual(computeRecentDiffSnippet(prev, curr), { original: "c", updated: "X" });
  });

  test("computeRecentDiffSnippet handles insertion", () => {
    const prev = ["a", "b", "d"].join("\n");
    const curr = ["a", "b", "c", "d"].join("\n");
    assert.deepStrictEqual(computeRecentDiffSnippet(prev, curr), { original: "", updated: "c" });
  });

  test("computeRecentDiffSnippet handles deletion", () => {
    const prev = ["a", "b", "c", "d"].join("\n");
    const curr = ["a", "b", "d"].join("\n");
    assert.deepStrictEqual(computeRecentDiffSnippet(prev, curr), { original: "c", updated: "" });
  });

  test("toUnifiedDiff produces a minimal unified diff", () => {
    const oldText = ["a", "b", "c", "d"].join("\n") + "\n";
    const newText = ["a", "b", "X", "d"].join("\n") + "\n";
    const diff = toUnifiedDiff({ oldText, newText, context: 1 });
    assert.ok(diff.includes("@@"), "diff should include a hunk header");
    assert.ok(diff.includes("-c"), "diff should include removed line");
    assert.ok(diff.includes("+X"), "diff should include added line");
  });
});
