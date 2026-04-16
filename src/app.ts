import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { companiesRoutes } from './routes/companies.js';
import { healthRoutes } from './routes/health.js';
import { sefazRoutes } from './routes/sefaz.js';
import { sefazV1Routes } from './routes/sefaz-v1.routes.js';
import { isAppError } from './utils/errors.js';
import { fastifyLoggerOptions } from './utils/logger.js';

export async function buildApp() {
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const app = Fastify({
    logger: fastifyLoggerOptions,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      if (typeof h === 'string' && h.trim()) return h.trim();
      if (Array.isArray(h) && h[0]?.trim()) return h[0].trim();
      return randomUUID();
    },
    requestIdHeader: 'x-request-id',
  });

  if (corsOrigins.length > 0) {
    await app.register(cors, { origin: corsOrigins, credentials: true });
  }

  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? '180'),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    keyGenerator: (request) => request.ip,
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.addHook('onRequest', async (req) => {
    req.log.info(
      { method: req.method, url: req.url, reqId: req.id, ip: req.ip },
      'requisição iniciada'
    );
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

    const errCode = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (errCode === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      req.log.warn({ err, reqId: req.id }, 'corpo JSON inválido (Content-Type application/json)');
      void reply.status(400).send({
        success: false,
        error:
          'JSON inválido no corpo da requisição. Se `companyId` for texto (ex.: UUID), no Postman/raw JSON use aspas: "companyId": "{{seu_uuid}}", e não companyId sem aspas.',
        code: 'INVALID_JSON_BODY',
        category: 'parse',
      });
      return;
    }

    if (isAppError(err)) {
      void reply.status(err.statusCode).send({
        success: false,
        error: err.message,
        code: err.code,
        category: err.category,
      });
      return;
    }

    req.log.error({ err }, 'erro não tratado');
    void reply.status(500).send({
      success: false,
      error: 'Erro interno',
      code: 'INTERNAL_ERROR',
      category: 'internal',
    });
  });

  await app.register(healthRoutes);
  await app.register(companiesRoutes);
  await app.register(sefazRoutes);
  await app.register(sefazV1Routes, { prefix: '/api/v1' });

  return app;
}
