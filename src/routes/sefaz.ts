import type { FastifyPluginAsync } from 'fastify';
import { requireInternalAuth } from '../utils/auth.js';
import { postDistribuicao } from '../controllers/sefaz.controller.js';

export const sefazRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/sefaz/distribuicao', { preHandler: requireInternalAuth }, postDistribuicao);
};
