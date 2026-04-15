import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { validateBootstrap } from './config/bootstrap.js';

async function main() {
  validateBootstrap();

  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver === 'local') {
    const baseDir = process.env.CERT_STORAGE_PATH ?? join(process.cwd(), 'storage', 'certificates');
    await mkdir(baseDir, { recursive: true, mode: 0o700 });
  }

  const app = await buildApp();
  const port = Number(process.env.PORT ?? '3000');
  const host = '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(
    {
      port,
      host,
      storageDriver: driver,
      appEnv: process.env.APP_ENV ?? process.env.NODE_ENV,
    },
    'sefaz-bridge iniciado'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
