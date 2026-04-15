/** SOAP completo em logs: exige ALLOW_DEBUG_SOAP=true; em produção também DEBUG_SOAP_IN_PROD=true */
export function shouldLogSoapDebug(): boolean {
  if (process.env.ALLOW_DEBUG_SOAP !== 'true') return false;
  if (process.env.NODE_ENV === 'production') {
    return process.env.DEBUG_SOAP_IN_PROD === 'true';
  }
  return true;
}

export function appEnvironmentLabel(): string {
  return (process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').trim();
}
