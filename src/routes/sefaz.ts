import type { FastifyPluginAsync } from 'fastify';
import { postDistribuicao } from '../controllers/sefaz.controller.js';
import { bridgeProtectedGuard } from '../utils/bridge-guard.js';

export const sefazRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/sefaz/distribuicao', { preHandler: bridgeProtectedGuard }, postDistribuicao);
};
