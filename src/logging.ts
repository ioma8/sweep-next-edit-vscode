export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, err?: unknown) => void;
};

export function createNoopLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}

