import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const rootLogger = pino({
  level,
  base: { service: 'sefaz-bridge' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
