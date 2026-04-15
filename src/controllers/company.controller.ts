import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CertificateUploadResult, CompanyId } from '../types/index.js';
import { analyzeAndMaterializeTlsIdentity, validatePfxExtension } from '../services/certificate.service.js';
import { getStorageService } from '../services/storage.service.js';
import { AppError } from '../utils/errors.js';

function normalizeOptionalField(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

export async function uploadCompanyCertificate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const companyId = String((request.params as { companyId?: CompanyId }).companyId ?? '');
  if (!companyId) {
    throw new AppError('companyId obrigatório', { statusCode: 400, code: 'MISSING_COMPANY_ID', expose: true });
  }

  if (!request.isMultipart()) {
    throw new AppError('Content-Type deve ser multipart/form-data', {
      statusCode: 415,
      code: 'INVALID_CONTENT_TYPE',
      expose: true,
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
    });
  }
  if (!password) {
    throw new AppError('Senha do certificado não enviada (campo password)', {
      statusCode: 400,
      code: 'MISSING_PASSWORD',
      expose: true,
    });
  }

  validatePfxExtension(filename);

  const { meta } = analyzeAndMaterializeTlsIdentity(pfxBuffer, password);

  request.log.info(
    {
      companyId,
      subject: meta.subject,
      issuer: meta.issuer,
      validFrom: meta.validFrom,
      validTo: meta.validTo,
      legacyPfx: meta.normalizedFromLegacyPfx,
    },
    'Certificado validado; persistindo no storage'
  );

  await getStorageService().saveCompanyCertificate(companyId, {
    pfxBuffer,
    passphrase: password,
    meta: {
      companyId,
      cnpj,
      uf,
      tpAmb,
      subject: meta.subject,
      issuer: meta.issuer,
      validFrom: meta.validFrom,
      validTo: meta.validTo,
      normalizedFromLegacyPfx: meta.normalizedFromLegacyPfx,
      storedAt: new Date().toISOString(),
    },
  });

  const payload: CertificateUploadResult = {
    success: true,
    companyId,
    certificateStored: true,
    subject: meta.subject,
    issuer: meta.issuer,
    validFrom: meta.validFrom,
    validTo: meta.validTo,
  };

  await reply.status(201).send(payload);
}
