import type { FastifyPluginAsync } from 'fastify';
import { uploadCompanyCertificate } from '../controllers/company.controller.js';
import { bridgeProtectedGuard } from '../utils/bridge-guard.js';

export const companiesRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/companies/:companyId/certificate',
    {
      preHandler: bridgeProtectedGuard,
      config: {
        rateLimit: {
          max: Number(process.env.RATE_LIMIT_CERT_MAX ?? '30'),
          timeWindow: process.env.RATE_LIMIT_CERT_WINDOW ?? '15 minutes',
        },
      },
    },
    uploadCompanyCertificate
  );
};
