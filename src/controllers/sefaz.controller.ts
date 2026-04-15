import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DistribuicaoRequestBody } from '../types/index.js';
import { AppError } from '../utils/errors.js';
import { consultarDistribuicao } from '../services/sefaz-distribuicao.service.js';

function assertDistribuicaoBody(body: unknown): DistribuicaoRequestBody {
  if (!body || typeof body !== 'object') {
    throw new AppError('JSON inválido', {
      statusCode: 400,
      code: 'INVALID_JSON',
      expose: true,
      category: 'parse',
    });
  }
  const b = body as Record<string, unknown>;

  const companyId = b.companyId;
  if (companyId == null || (typeof companyId !== 'string' && typeof companyId !== 'number')) {
    throw new AppError('companyId obrigatório', {
      statusCode: 400,
      code: 'MISSING_COMPANY_ID',
      expose: true,
      category: 'parse',
    });
  }

  const cnpj = String(b.cnpj ?? '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj)) {
    throw new AppError('cnpj inválido (14 dígitos)', {
      statusCode: 400,
      code: 'INVALID_CNPJ',
      expose: true,
      category: 'parse',
    });
  }

  const cUF = String(b.cUF ?? '').trim();
  if (!/^\d{2}$/.test(cUF)) {
    throw new AppError('cUF inválido (2 dígitos)', {
      statusCode: 400,
      code: 'INVALID_CUF',
      expose: true,
      category: 'parse',
    });
  }

  const tpAmb = String(b.tpAmb ?? '').trim();
  if (!/^[12]$/.test(tpAmb)) {
    throw new AppError('tpAmb inválido (1 ou 2)', {
      statusCode: 400,
      code: 'INVALID_TPAMB',
      expose: true,
      category: 'parse',
    });
  }

  const ultNSU = String(b.ultNSU ?? '').trim();
  if (!/^\d{15}$/.test(ultNSU)) {
    throw new AppError('ultNSU inválido (15 dígitos)', {
      statusCode: 400,
      code: 'INVALID_ULTNSU',
      expose: true,
      category: 'parse',
    });
  }

  return { companyId, cnpj, cUF, tpAmb, ultNSU };
}

export async function postDistribuicao(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = assertDistribuicaoBody(request.body);
  const result = await consultarDistribuicao({
    body,
    logger: request.log,
    requestId: request.id,
  });
  await reply.send(result);
}
