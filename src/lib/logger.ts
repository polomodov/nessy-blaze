type LogMethod = (...args: unknown[]) => void;

export interface ScopedLogger {
  log: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

function createScopedLogger(scopeName: string): ScopedLogger {
  const prefix = `[${scopeName}]`;

  return {
    log: (...args) => console.log(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args),
  };
}

export const log = {
  scope(scopeName: string): ScopedLogger {
    return createScopedLogger(scopeName);
  },
};
