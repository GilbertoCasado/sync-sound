import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOrCreateSession } from '../session.helper.js';

const providerParamsSchema = z.object({
  provider: z.enum(['spotify', 'deezer', 'youtube']),
});

const playlistParamsSchema = z.object({
  provider: z.enum(['spotify', 'deezer', 'youtube']),
  playlistId: z.string().trim().min(1),
});

export async function registerPlaylistRoutes(app: FastifyInstance): Promise<void> {
  const { env, sessionStore, listPlaylistsUseCase, getPlaylistUseCase } = app.syncsound;

  app.get('/api/providers/:provider/playlists', async (request, reply) => {
    const parsed = providerParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const { provider } = parsed.data;
    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const credentials = session.providers[provider];

    if (!credentials) {
      return reply.status(401).send({
        message: `Conecte sua conta ${provider} para listar suas playlists.`,
      });
    }

    const playlists = await listPlaylistsUseCase.execute(provider, credentials);
    return { playlists };
  });

  app.get('/api/providers/:provider/playlists/:playlistId', async (request, reply) => {
    const parsed = playlistParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Parâmetros de playlist inválidos.' });
    }

    const { provider, playlistId } = parsed.data;
    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const credentials = session.providers[provider];

    if (!credentials && provider !== 'deezer') {
      return reply.status(401).send({
        message: `Conecte sua conta ${provider} para acessar esta playlist.`,
      });
    }

    const playlist = await getPlaylistUseCase.execute(provider, playlistId, credentials);
    return { playlist };
  });
}
