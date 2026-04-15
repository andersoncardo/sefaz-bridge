import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    const s = process.env.SEFAZ_BRIDGE_SECRET;
    if (!s || s === 'change-me') {
      console.error('Defina SEFAZ_BRIDGE_SECRET com um valor forte em produção.');
      process.exit(1);
    }
  }

  const storagePath = process.env.CERT_STORAGE_PATH ?? './storage/certificates';
  await mkdir(storagePath, { recursive: true, mode: 0o700 });

  const app = await buildApp();
  const port = Number(process.env.PORT ?? '3000');
  const host = '0.0.0.0';

  await app.listen({ port, host });
  app.log.info({ port, host, storagePath }, 'sefaz-bridge iniciado');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
