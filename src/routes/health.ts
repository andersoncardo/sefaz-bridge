import type { FastifyPluginAsync } from 'fastify';
import { getStorageService } from '../services/storage.service.js';
import { appEnvironmentLabel } from '../utils/runtime-flags.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (request, reply) => {
    const uptime = process.uptime();
    let storageCheck: { ok: boolean; driver: string; message?: string };
    try {
      storageCheck = await getStorageService().healthCheck();
    } catch (e) {
      storageCheck = {
        ok: false,
        driver: process.env.STORAGE_DRIVER ?? 'local',
        message: e instanceof Error ? e.message : 'health storage falhou',
      };
      request.log.error({ err: e }, 'healthcheck: storage indisponível');
    }

    const payload = {
      ok: storageCheck.ok,
      uptime_seconds: Math.round(uptime),
      app_env: appEnvironmentLabel(),
      storage: storageCheck,
      version: process.env.npm_package_version ?? '1.0.0',
    };

    if (!storageCheck.ok) {
      await reply.status(503).send(payload);
      return;
    }

    return payload;
  });
};
