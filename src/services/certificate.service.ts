import forge from 'node-forge';
import { X509Certificate } from 'node:crypto';
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
  /** PEM para `https.Agent` (TLS 1.2 + SNI automático pelo stack Node) */
  cert: string;
  key: string;
  passphrase?: string;
  /** Indica se o Node aceitou o PFX nativamente ou se houve necessidade de tratar como legado */
  source: 'node-pfx' | 'forge-pem';
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

/**
 * Extrai metadados e material TLS em PEM (compatível com PFX legado via forge).
 * `normalizedFromLegacyPfx` fica true quando o Node não consegue abrir o PFX nativamente.
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

export function validatePfxExtension(filename: string | undefined): void {
  const name = (filename ?? '').toLowerCase();
  if (!name.endsWith('.pfx') && !name.endsWith('.p12')) {
    throw new AppError('Arquivo deve ser .pfx ou .p12', {
      statusCode: 400,
      code: 'INVALID_EXTENSION',
      expose: true,
    });
  }
}
