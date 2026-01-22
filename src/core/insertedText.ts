import { diffLines } from "diff";

export function computeInsertedText(oldText: string, newText: string): string {
  if (oldText === newText) return "";
  const parts = diffLines(oldText, newText);
  const added = parts
    .filter((p) => p.added)
    .map((p) => p.value)
    .join("");

  return added.replace(/^\n+/, "");
}

