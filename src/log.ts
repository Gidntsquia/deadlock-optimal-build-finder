// Structured logging: one JSON line per event to console, so a browser check
// (or a human with devtools open) can grep and parse it. No PII, no secrets.
type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  const method = level === 'debug' ? 'log' : level;
  // eslint-disable-next-line no-console
  console[method as 'log' | 'info' | 'warn' | 'error'](line);
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => emit('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data),
};
