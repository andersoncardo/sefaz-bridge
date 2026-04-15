import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { requireInternalAuth } from './auth.js';
import { stableStringify } from './stable-json.js';

function hexEqConstTime(a: string, b: string): boolean {
  const aa = a.toLowerCase();
  const bb = b.toLowerCase();
  if (aa.length !== bb.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aa, 'hex'), Buffer.from(bb, 'hex'));
  } catch {
    return false;
  }
}

export async function requireBridgeHmacIfConfigured(request: FastifyRequest): Promise<void> {
  const secret = process.env.BRIDGE_HMAC_SECRET?.trim();
  if (!secret) return;

  const tsRaw = request.headers['x-bridge-timestamp'];
  const sigRaw = request.headers['x-bridge-signature'];
  const tsStr = Array.isArray(tsRaw) ? tsRaw[0] : tsRaw;
  const sig = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;

  if (!tsStr || !sig) {
    throw new AppError('Headers X-Bridge-Timestamp e X-Bridge-Signature obrigatórios quando BRIDGE_HMAC_SECRET está definido', {
      statusCode: 401,
      code: 'HMAC_REQUIRED',
      expose: true,
      category: 'auth',
    });
  }

  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new AppError('X-Bridge-Timestamp inválido', {
      statusCode: 401,
      code: 'HMAC_BAD_TIMESTAMP',
      expose: true,
      category: 'auth',
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const skew = Number(process.env.BRIDGE_HMAC_MAX_SKEW_SEC ?? '300');
  if (Math.abs(now - ts) > skew) {
    throw new AppError('Timestamp fora da janela aceita', {
      statusCode: 401,
      code: 'HMAC_REPLAY_OR_SKEW',
      expose: true,
      category: 'auth',
    });
  }

  const path = request.url.split('?')[0];
  const method = request.method.toUpperCase();
  let bodyFingerprint: string;
  if (method === 'GET' || method === 'HEAD') {
    bodyFingerprint = 'empty';
  } else if (request.isMultipart()) {
    bodyFingerprint = 'multipart:company-certificate-upload';
  } else {
    bodyFingerprint = createHash('sha256').update(stableStringify(request.body)).digest('hex');
  }

  const canonical = `v1:${ts}:${method}:${path}:${bodyFingerprint}`;
  const expectedHex = createHmac('sha256', secret).update(canonical).digest('hex');

  if (!hexEqConstTime(expectedHex, String(sig))) {
    throw new AppError('Assinatura HMAC inválida', {
      statusCode: 403,
      code: 'HMAC_INVALID',
      expose: true,
      category: 'auth',
    });
  }
}

export async function bridgeProtectedGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireInternalAuth(request, reply);
  await requireBridgeHmacIfConfigured(request);
}
