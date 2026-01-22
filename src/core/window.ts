export type LineSpan = { startLine: number; endLineExclusive: number };

export function getWindowLineSpan(params: {
  totalLines: number;
  cursorLine: number;
  contextLines: number;
}): LineSpan {
  const totalLines = Math.max(0, params.totalLines);
  const contextLines = Math.max(0, params.contextLines);
  const cursorLine = Math.min(Math.max(0, params.cursorLine), Math.max(0, totalLines - 1));

  const startLine = Math.max(0, cursorLine - contextLines);
  const endLineExclusive = Math.min(totalLines, cursorLine + contextLines + 1);

  return { startLine, endLineExclusive };
}

export function replaceLineSpan(params: {
  text: string;
  span: LineSpan;
  replacement: string;
}): string {
  const lines = params.text.split("\n");
  const replacementLines = params.replacement.split("\n");

  const startLine = Math.max(0, Math.min(params.span.startLine, lines.length));
  const endLineExclusive = Math.max(startLine, Math.min(params.span.endLineExclusive, lines.length));

  lines.splice(startLine, endLineExclusive - startLine, ...replacementLines);
  return lines.join("\n");
}
