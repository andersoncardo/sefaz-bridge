import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CertificateUploadResult, CompanyId } from '../types/index.js';
import { validatePfxExtension, validatePfxForUpload } from '../services/certificate.service.js';
import { getStorageService } from '../services/storage.service.js';
import { AppError } from '../utils/errors.js';
import { maskCnpj } from '../utils/masking.js';

function normalizeOptionalField(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function adminExpiredOverride(request: FastifyRequest): boolean {
  const secret = process.env.ADMIN_CERT_OVERRIDE_SECRET?.trim();
  if (!secret) return false;
  const hdr = String(request.headers['x-cert-override-token'] ?? '').trim();
  if (!hdr) return false;
  try {
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(hdr, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function uploadCompanyCertificate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const companyId = String((request.params as { companyId?: CompanyId }).companyId ?? '');
  if (!companyId) {
    throw new AppError('companyId obrigatório', {
      statusCode: 400,
      code: 'MISSING_COMPANY_ID',
      expose: true,
      category: 'auth',
    });
  }

  if (!request.isMultipart()) {
    throw new AppError('Content-Type deve ser multipart/form-data', {
      statusCode: 415,
      code: 'INVALID_CONTENT_TYPE',
      expose: true,
      category: 'parse',
    });
  }

  let pfxBuffer: Buffer | null = null;
  let password: string | null = null;
  let filename: string | undefined;
  let cnpj: string | undefined;
  let uf: string | undefined;
  let tpAmb: string | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'certificate' && part.fieldname !== 'file') {
        continue;
      }
      filename = part.filename;
      validatePfxExtension(part.filename);
      pfxBuffer = await part.toBuffer();
    } else {
      const field = part.fieldname;
      const value = part.value;
      if (field === 'password' || field === 'passphrase' || field === 'senha') {
        password = String(value);
      } else if (field === 'cnpj') {
        cnpj = normalizeOptionalField(value);
      } else if (field === 'uf') {
        uf = normalizeOptionalField(value);
      } else if (field === 'tpAmb') {
        tpAmb = normalizeOptionalField(value);
      }
    }
  }

  if (!pfxBuffer?.length) {
    throw new AppError('Arquivo PFX não enviado (campo certificate)', {
      statusCode: 400,
      code: 'MISSING_FILE',
      expose: true,
      category: 'parse',
    });
  }
  if (!password) {
    throw new AppError('Senha do certificado não enviada (campo password)', {
      statusCode: 400,
      code: 'MISSING_PASSWORD',
      expose: true,
      category: 'auth',
    });
  }

  validatePfxExtension(filename);

  const declaredDigits = cnpj?.replace(/\D/g, '') ?? '';
  const allowExpired =
    adminExpiredOverride(request) ||
    (process.env.NODE_ENV !== 'production' && process.env.CERT_ALLOW_EXPIRED_DEV === 'true');

  const validated = validatePfxForUpload(pfxBuffer, password, {
    allowExpired,
    declaredCnpjDigits: declaredDigits.length === 14 ? declaredDigits : undefined,
  });

  request.log.info(
    {
      companyId,
      subject: validated.meta.subject,
      issuer: validated.meta.issuer,
      validFrom: validated.meta.validFrom,
      validTo: validated.meta.validTo,
      legacyPfx: validated.meta.normalizedFromLegacyPfx,
      fingerprintSha256: validated.fingerprintSha256,
      cnpjMasked: validated.certCnpj ? maskCnpj(validated.certCnpj) : declaredDigits ? maskCnpj(declaredDigits) : undefined,
    },
    'certificado validado; persistindo no storage remoto'
  );

  await getStorageService().saveCompanyCertificate(companyId, {
    pfxBuffer,
    passphrase: password,
    meta: {
      companyId,
      cnpj: declaredDigits.length === 14 ? declaredDigits : cnpj,
      uf,
      tpAmb,
      subject: validated.meta.subject,
      issuer: validated.meta.issuer,
      validFrom: validated.meta.validFrom,
      validTo: validated.meta.validTo,
      fingerprintSha256: validated.fingerprintSha256,
      certCnpj: validated.certCnpj,
      normalizedFromLegacyPfx: validated.meta.normalizedFromLegacyPfx,
      storedAt: new Date().toISOString(),
    },
  });

  const payload: CertificateUploadResult = {
    success: true,
    companyId,
    certificateStored: true,
    subject: validated.meta.subject,
    issuer: validated.meta.issuer,
    validFrom: validated.meta.validFrom,
    validTo: validated.meta.validTo,
    fingerprintSha256: validated.fingerprintSha256,
    certCnpj: validated.certCnpj,
  };

  await reply.status(201).send(payload);
}
