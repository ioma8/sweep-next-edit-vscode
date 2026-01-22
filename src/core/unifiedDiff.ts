import { createTwoFilesPatch } from "diff";

export function toUnifiedDiff(params: {
  oldText: string;
  newText: string;
  oldFileName?: string;
  newFileName?: string;
  context?: number;
}): string {
  const patch = createTwoFilesPatch(
    params.oldFileName ?? "current",
    params.newFileName ?? "updated",
    params.oldText,
    params.newText,
    undefined,
    undefined,
    { context: params.context ?? 2 }
  );

  const lines = patch.split("\n");
  const content = lines.slice(2).join("\n").trimEnd();
  return content;
}

