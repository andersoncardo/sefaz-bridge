/** Mascara CNPJ para logs (mantém 2 dígitos iniciais e 2 finais). */
export function maskCnpj(cnpjDigits: string): string {
  const d = cnpjDigits.replace(/\D/g, '');
  if (d.length !== 14) return '***';
  return `${d.slice(0, 2)}.***.***/****-${d.slice(12)}`;
}
