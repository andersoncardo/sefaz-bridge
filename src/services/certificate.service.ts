import forge from 'node-forge';
import { X509Certificate, createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import tls from 'node:tls';
import { AppError } from '../utils/errors.js';

export interface CertificateMetadata {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  normalizedFromLegacyPfx: boolean;
}

export interface TlsIdentity {
  cert: string;
  key: string;
  passphrase?: string;
  source: 'node-pfx' | 'forge-pem';
}

export interface PfxValidationResult {
  meta: CertificateMetadata;
  tls: TlsIdentity;
  fingerprintSha256: string;
  /** CNPJ de 14 dígitos extraído do subject/serial, se encontrado */
  certCnpj?: string;
}

function bufferToForgeBinary(buf: Buffer): string {
  return buf.toString('binary');
}

function extractPkcs12(pfxBuffer: Buffer, passphrase: string): forge.pkcs12.Pkcs12Pfx {
  try {
    const der = forge.util.createBuffer(bufferToForgeBinary(pfxBuffer));
    const asn1 = forge.asn1.fromDer(der);
    return forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  } catch (err) {
    throw new AppError('PFX inválido ou senha incorreta', {
      statusCode: 400,
      code: 'INVALID_PFX',
      expose: true,
      category: 'parse',
      cause: err,
    });
  }
}

function pickCertificate(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate {
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const list = bags[forge.pki.oids.certBag];
  const cert = list?.[0]?.cert;
  if (!cert) {
    throw new AppError('Certificado não encontrado no PFX', {
      statusCode: 400,
      code: 'CERT_BAG_MISSING',
      expose: true,
      category: 'internal',
    });
  }
  return cert;
}

function pickPrivateKey(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.PrivateKey {
  const keyTypes = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag] as const;
  for (const bagType of keyTypes) {
    const bags = p12.getBags({ bagType });
    const list = bags[bagType];
    const key = list?.[0]?.key;
    if (key) return key;
  }
  throw new AppError('Chave privada não encontrada no PFX', {
    statusCode: 400,
    code: 'KEY_BAG_MISSING',
    expose: true,
    category: 'internal',
  });
}

function metadataFromPem(certPem: string): Omit<CertificateMetadata, 'normalizedFromLegacyPfx'> {
  const x509 = new X509Certificate(certPem);
  return {
    subject: x509.subject,
    issuer: x509.issuer,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
  };
}

export function assertPrivateKeyMatchesCertificate(certPem: string, keyPem: string): void {
  try {
    const pub = createPublicKey({ key: certPem, format: 'pem' });
    const priv = createPrivateKey({ key: keyPem, format: 'pem' });
    const sign = createSign('sha256');
    sign.update('sefaz-bridge-cert-bind');
    sign.end();
    const sig = sign.sign(priv);
    const verify = createVerify('sha256');
    verify.update('sefaz-bridge-cert-bind');
    verify.end();
    if (!verify.verify(pub, sig)) {
      throw new AppError('Chave privada não corresponde ao certificado', {
        statusCode: 400,
        code: 'CERT_KEY_MISMATCH',
        expose: true,
        category: 'internal',
      });
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('Falha ao validar par certificado/chave', {
      statusCode: 400,
      code: 'CERT_KEY_CHECK_FAILED',
      expose: true,
      category: 'internal',
      cause: e,
    });
  }
}

export function extractCnpjFromX509(x509: X509Certificate): string | undefined {
  const blobs = [x509.subject, x509.serialNumber];
  for (const blob of blobs) {
    if (!blob) continue;
    const matches = blob.match(/\d{14}/g);
    if (matches?.length) return matches[matches.length - 1];
  }
  return undefined;
}

/**
 * Extrai metadados e material TLS em PEM (compatível com PFX legado via forge).
 */
export function analyzeAndMaterializeTlsIdentity(
  pfxBuffer: Buffer,
  passphrase: string
): { meta: CertificateMetadata; tls: TlsIdentity } {
  const p12 = extractPkcs12(pfxBuffer, passphrase);
  const cert = pickCertificate(p12);
  const key = pickPrivateKey(p12);
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(key);

  let nodeAcceptsPfx = true;
  try {
    tls.createSecureContext({ pfx: pfxBuffer, passphrase });
  } catch {
    nodeAcceptsPfx = false;
  }

  const baseMeta = metadataFromPem(certPem);
  return {
    meta: {
      ...baseMeta,
      normalizedFromLegacyPfx: !nodeAcceptsPfx,
    },
    tls: {
      cert: certPem,
      key: keyPem,
      source: nodeAcceptsPfx ? 'node-pfx' : 'forge-pem',
    },
  };
}

/**
 * Validação completa para upload: senha, par cert/chave, fingerprint, CNPJ, expiração.
 */
export function validatePfxForUpload(
  pfxBuffer: Buffer,
  passphrase: string,
  options: { allowExpired: boolean; declaredCnpjDigits?: string }
): PfxValidationResult {
  const { meta, tls } = analyzeAndMaterializeTlsIdentity(pfxBuffer, passphrase);
  assertPrivateKeyMatchesCertificate(tls.cert, tls.key);

  const x509 = new X509Certificate(tls.cert);
  const fingerprintSha256 = x509.fingerprint256;
  const certCnpj = extractCnpjFromX509(x509);

  const notAfter = new Date(meta.validTo);
  if (notAfter < new Date() && !options.allowExpired) {
    throw new AppError('Certificado expirado', {
      statusCode: 400,
      code: 'CERT_EXPIRED',
      expose: true,
      category: 'parse',
    });
  }

  if (options.declaredCnpjDigits && certCnpj && options.declaredCnpjDigits !== certCnpj) {
    throw new AppError('CNPJ informado não corresponde ao certificado', {
      statusCode: 400,
      code: 'CNPJ_MISMATCH',
      expose: true,
      category: 'internal',
    });
  }

  return { meta, tls, fingerprintSha256, certCnpj };
}

export function validatePfxExtension(filename: string | undefined): void {
  const name = (filename ?? '').toLowerCase();
  if (!name.endsWith('.pfx') && !name.endsWith('.p12')) {
    throw new AppError('Arquivo deve ser .pfx ou .p12', {
      statusCode: 400,
      code: 'INVALID_EXTENSION',
      expose: true,
      category: 'internal',
    });
  }
}
