import type { FastifyPluginAsync } from 'fastify';
import {
  getSefazDocument,
  getSefazDocumentContent,
  getSefazDocumentJson,
  getSefazDocumentXml,
  getSefazSyncState,
  listSefazDocuments,
  postSefazSync,
} from '../controllers/sefaz-v1.controller.js';
import { bridgeProtectedGuard } from '../utils/bridge-guard.js';

export const sefazV1Routes: FastifyPluginAsync = async (app) => {
  app.post(
    '/sefaz/sync',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        body: {
          type: 'object',
          required: ['companyId', 'cnpj', 'cUF', 'tpAmb'],
          properties: {
            companyId: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            cnpj: { type: 'string' },
            cUF: { type: 'string', pattern: '^[0-9]{2}$' },
            tpAmb: { type: 'string', enum: ['1', '2'] },
            force: { type: 'boolean' },
          },
        },
      },
    },
    postSefazSync
  );

  app.get(
    '/sefaz/sync-state/:companyId',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        params: {
          type: 'object',
          required: ['companyId'],
          properties: { companyId: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          required: ['tpAmb', 'cnpj'],
          properties: {
            tpAmb: { type: 'string', enum: ['1', '2'] },
            cnpj: { type: 'string' },
          },
        },
      },
    },
    getSefazSyncState
  );

  app.get(
    '/sefaz/documents',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        querystring: {
          type: 'object',
          required: ['companyId', 'tpAmb', 'cnpj'],
          properties: {
            companyId: { type: 'string' },
            tpAmb: { type: 'string', enum: ['1', '2'] },
            cnpj: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            schema: { type: 'string' },
            tipoDocumento: { type: 'string' },
            chaveNFe: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            sort: { type: 'string', enum: ['dataEmissao', 'createdAt'] },
            sortDir: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
      },
    },
    listSefazDocuments
  );

  app.get(
    '/sefaz/documents/:id',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    getSefazDocument
  );

  app.get(
    '/sefaz/documents/:id/xml',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    getSefazDocumentXml
  );

  app.get(
    '/sefaz/documents/:id/json',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    getSefazDocumentJson
  );

  app.get(
    '/sefaz/documents/:id/content',
    {
      preHandler: bridgeProtectedGuard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          required: ['format'],
          properties: {
            format: { type: 'string', enum: ['xml', 'json'] },
          },
        },
      },
    },
    getSefazDocumentContent
  );
};
