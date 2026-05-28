// Tiny prefixed logger. Avoid heavy deps for v1.
const ts = () => new Date().toISOString();
const fmt = (level, args) => [`[${ts()}]`, `[${level}]`, ...args];

export const log = {
  info: (...a) => console.log(...fmt('info', a)),
  warn: (...a) => console.warn(...fmt('warn', a)),
  error: (...a) => console.error(...fmt('error', a)),
  debug: (...a) => {
    if (process.env.DEBUG) console.log(...fmt('debug', a));
  },
};
