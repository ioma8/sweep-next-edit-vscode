export type NextEditRequest = {
  filePath: string;
  originalWindow: string;
  currentWindow: string;
  contextFiles?: Record<string, string>;
  recentDiffs?: Array<{ filePath: string; original: string; updated: string }>;
};

export interface NextEditPredictor {
  predictNextEdit(request: NextEditRequest, signal: AbortSignal): Promise<string>;
}
