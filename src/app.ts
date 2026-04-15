import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { companiesRoutes } from './routes/companies.js';
import { healthRoutes } from './routes/health.js';
import { sefazRoutes } from './routes/sefaz.js';
import { isAppError } from './utils/errors.js';
import { rootLogger } from './utils/logger.js';

export async function buildApp() {
  const app = Fastify({
    logger: rootLogger,
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.addHook('onRequest', async (req) => {
    req.log.info({ method: req.method, url: req.url, reqId: req.id }, 'requisição iniciada');
  });

  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        method: req.method,
        url: req.url,
        reqId: req.id,
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime,
      },
      'requisição finalizada'
    );
  });

  app.setErrorHandler((err, req, reply) => {
    if (reply.sent) return;

    if (isAppError(err)) {
      void reply.status(err.statusCode).send({
        success: false,
        error: err.message,
        code: err.code,
      });
      return;
    }

    req.log.error({ err }, 'erro não tratado');
    void reply.status(500).send({
      success: false,
      error: 'Erro interno',
      code: 'INTERNAL_ERROR',
    });
  });

  await app.register(healthRoutes);
  await app.register(companiesRoutes);
  await app.register(sefazRoutes);

  return app;
}
