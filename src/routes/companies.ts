import type { FastifyPluginAsync } from 'fastify';
import { requireInternalAuth } from '../utils/auth.js';
import { uploadCompanyCertificate } from '../controllers/company.controller.js';

export const companiesRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/companies/:companyId/certificate',
    { preHandler: requireInternalAuth },
    uploadCompanyCertificate
  );
};
