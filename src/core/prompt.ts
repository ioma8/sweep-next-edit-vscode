export type RecentDiff = { filePath: string; original: string; updated: string };

export function buildPrompt(params: {
  contextFiles?: Record<string, string>;
  recentDiffs?: RecentDiff[];
  filePath: string;
  originalContent: string;
  currentContent: string;
}): string {
  const promptParts: string[] = [];

  const contextFiles = params.contextFiles ?? {};
  const recentDiffs = params.recentDiffs ?? [];

  for (const [path, content] of Object.entries(contextFiles).sort(([a], [b]) => a.localeCompare(b))) {
    promptParts.push(`<|file_sep|>${path}`);
    promptParts.push(content);
  }

  for (const diff of recentDiffs) {
    promptParts.push(`<|file_sep|>${diff.filePath}.diff`);
    promptParts.push("original:");
    promptParts.push(diff.original);
    promptParts.push("updated:");
    promptParts.push(diff.updated);
  }

  promptParts.push(`<|file_sep|>original/${params.filePath}`);
  promptParts.push(params.originalContent);
  promptParts.push(`<|file_sep|>current/${params.filePath}`);
  promptParts.push(params.currentContent);
  promptParts.push(`<|file_sep|>updated/${params.filePath}`);

  return promptParts.join("\n");
}
