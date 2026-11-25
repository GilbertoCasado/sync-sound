import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOrCreateSession } from '../session.helper.js';

const startMigrationSchema = z.object({
  sourcePlatform: z.enum(['spotify', 'deezer', 'youtube']),
  targetPlatform: z.enum(['spotify', 'deezer', 'youtube']),
  sourcePlaylistId: z.string().trim().min(1, 'Informe o ID ou URL da playlist de origem.'),
  targetPlaylistName: z.string().trim().optional(),
  dryRun: z.boolean().optional().default(false),
  includeLowConfidence: z.boolean().optional().default(true),
});

export async function registerMigrationRoutes(app: FastifyInstance): Promise<void> {
  const { env, sessionStore, migrationJobManager } = app.syncsound;

  app.post('/api/migrations', async (request, reply) => {
    const parsed = startMigrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.issues[0]?.message ?? 'Dados de migração inválidos.',
      });
    }

    const payload = parsed.data;
    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const sourceCredentials = session.providers[payload.sourcePlatform];
    const targetCredentials = session.providers[payload.targetPlatform];

    if (payload.sourcePlatform !== 'deezer' && !sourceCredentials) {
      return reply.status(401).send({
        message: `Conecte sua conta ${payload.sourcePlatform} para ler a playlist de origem.`,
      });
    }

    if (!payload.dryRun && !targetCredentials) {
      return reply.status(401).send({
        message: `Conecte sua conta ${payload.targetPlatform} ou ative o modo simulação (dryRun).`,
      });
    }

    const job = migrationJobManager.startJob(payload, {
      source: sourceCredentials,
      target: targetCredentials,
    });

    return reply.status(202).send(job);
  });

  app.get('/api/migrations/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const snapshot = migrationJobManager.getJob(jobId);

    if (!snapshot) {
      return reply.status(404).send({ message: 'Job de migração não encontrado.' });
    }

    return snapshot;
  });

  app.get('/api/migrations/:jobId/events', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const snapshot = migrationJobManager.getJob(jobId);

    if (!snapshot) {
      return reply.status(404).send({ message: 'Job de migração não encontrado.' });
    }

    reply.hijack();

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    };

    if (request.headers.origin === env.FRONTEND_URL) {
      headers['Access-Control-Allow-Origin'] = env.FRONTEND_URL;
      headers['Access-Control-Allow-Credentials'] = 'true';
      headers.Vary = 'Origin';
    }

    reply.raw.writeHead(200, headers);

    let closed = false;
    let pingTimer: NodeJS.Timeout | undefined;
    let unsubscribe: (() => void) | null = null;

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (pingTimer) {
        clearInterval(pingTimer);
      }
      unsubscribe?.();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    };

    unsubscribe = migrationJobManager.subscribe(jobId, (event) => {
      if (closed) {
        return;
      }
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'completed' || event.type === 'error') {
        closeStream();
      }
    });

    if (!closed) {
      pingTimer = setInterval(() => {
        if (!closed) {
          reply.raw.write(': ping\n\n');
        }
      }, 15_000);
    }

    request.raw.on('close', closeStream);
  });
}
