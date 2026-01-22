export type RecentDiffSnippet = { original: string; updated: string };

export function computeRecentDiffSnippet(previousText: string, currentText: string): RecentDiffSnippet | undefined {
  if (previousText === currentText) return undefined;

  const prevLines = previousText.split("\n");
  const currLines = currentText.split("\n");

  let prefix = 0;
  while (prefix < prevLines.length && prefix < currLines.length && prevLines[prefix] === currLines[prefix]) {
    prefix++;
  }

  let prevSuffix = prevLines.length - 1;
  let currSuffix = currLines.length - 1;
  while (prevSuffix >= prefix && currSuffix >= prefix && prevLines[prevSuffix] === currLines[currSuffix]) {
    prevSuffix--;
    currSuffix--;
  }

  const original = prevLines.slice(prefix, prevSuffix + 1).join("\n");
  const updated = currLines.slice(prefix, currSuffix + 1).join("\n");

  return { original, updated };
}

