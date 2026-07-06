const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args: any[]) => { if (isDev) console.log(...args); },
  error: (...args: any[]) => { console.error(...args); },
  warn: (...args: any[]) => { if (isDev) console.warn(...args); },
  debug: (...args: any[]) => { if (isDev) console.debug(...args); },
  info: (...args: any[]) => { if (isDev) console.info(...args); },
};
