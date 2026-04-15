import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    bridgeAuth?: true;
  }
}

export function getExpectedSecret(): string {
  const secret = process.env.SEFAZ_BRIDGE_SECRET;
  if (!secret || secret === 'change-me') {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('SEFAZ_BRIDGE_SECRET não configurado de forma segura', {
        statusCode: 500,
        code: 'MISSING_BRIDGE_SECRET',
        expose: false,
      });
    }
  }
  return secret ?? 'dev-only-secret';
}

export async function requireInternalAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new AppError('Não autorizado', { statusCode: 401, code: 'UNAUTHORIZED', expose: true });
  }
  const token = auth.slice('Bearer '.length).trim();
  const expected = getExpectedSecret();
  if (!token || token !== expected) {
    throw new AppError('Token inválido', { statusCode: 403, code: 'FORBIDDEN', expose: true });
  }
  request.bridgeAuth = true;
}
