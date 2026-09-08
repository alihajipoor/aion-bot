const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

let threshold: number = LEVELS.info;
export function setLogLevel(l: Level) { threshold = LEVELS[l] ?? LEVELS.info; }

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  extra === undefined ? out(line) : out(line, extra);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => emit('debug', scope, m, e),
    info:  (m: string, e?: unknown) => emit('info',  scope, m, e),
    warn:  (m: string, e?: unknown) => emit('warn',  scope, m, e),
    error: (m: string, e?: unknown) => emit('error', scope, m, e),
  };
}
