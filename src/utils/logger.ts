import pino from 'pino';
import type { LoggerOptions } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

/** Opções Pino compatíveis com `Fastify({ logger })` no Fastify 5 (não passe instância Pino pronta). */
export const fastifyLoggerOptions: LoggerOptions = {
  level,
  base: { service: 'sefaz-bridge' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};
