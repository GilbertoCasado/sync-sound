import { randomUUID } from 'node:crypto';
import type { ProviderAuthStatus, ProviderType } from '@syncsound/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOrCreateSession } from '../session.helper.js';

const PROVIDERS: ProviderType[] = ['spotify', 'deezer', 'youtube'];
const providerParamSchema = z.object({
  provider: z.enum(['spotify', 'deezer', 'youtube']),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { env, sessionStore, oauthService } = app.syncsound;

  app.get('/api/auth/status', async (request, reply) => {
    const session = await getOrCreateSession(request, reply, sessionStore, env);

    const statuses: ProviderAuthStatus[] = PROVIDERS.map((provider) => {
      const credentials = session.providers[provider];
      return {
        provider,
        connected: Boolean(credentials?.accessToken),
        configured: oauthService.isConfigured(provider),
        supportsPublicRead: provider === 'deezer',
        expiresAt: credentials?.expiresAt
          ? new Date(credentials.expiresAt).toISOString()
          : undefined,
      };
    });

    return { providers: statuses };
  });

  app.get('/auth/:provider/login', async (request, reply) => {
    const parsed = providerParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const { provider } = parsed.data;
    if (!oauthService.isConfigured(provider)) {
      const errorMsg = encodeURIComponent(
        `Credenciais OAuth para ${provider} não configuradas no .env.`,
      );
      return reply.redirect(`${env.FRONTEND_URL}/?auth_error=${errorMsg}`);
    }

    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const state = randomUUID();
    await sessionStore.setOAuthState(session.id, provider, state);

    const authorizeUrl = oauthService.getAuthorizeUrl(provider, state);
    return reply.redirect(authorizeUrl);
  });

  app.get('/auth/:provider/callback', async (request, reply) => {
    const parsedParams = providerParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const { provider } = parsedParams.data;
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      return reply.redirect(
        `${env.FRONTEND_URL}/?auth_error=${encodeURIComponent(`Autorização negada (${provider}): ${query.error}`)}`,
      );
    }

    if (!query.code || !query.state) {
      return reply.redirect(
        `${env.FRONTEND_URL}/?auth_error=${encodeURIComponent('Parâmetros code/state ausentes no callback OAuth.')}`,
      );
    }

    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const validState = await sessionStore.consumeOAuthState(session.id, provider, query.state);
    if (!validState) {
      return reply.redirect(
        `${env.FRONTEND_URL}/?auth_error=${encodeURIComponent('Estado OAuth inválido ou expirado.')}`,
      );
    }

    try {
      const credentials = await oauthService.exchangeCode(provider, query.code);
      await sessionStore.setProviderCredentials(session.id, provider, credentials);
      return reply.redirect(`${env.FRONTEND_URL}/?connected=${provider}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao trocar código OAuth por token.';
      return reply.redirect(
        `${env.FRONTEND_URL}/?auth_error=${encodeURIComponent(message)}`,
      );
    }
  });

  app.post('/api/auth/:provider/disconnect', async (request, reply) => {
    const parsed = providerParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const session = await getOrCreateSession(request, reply, sessionStore, env);
    await sessionStore.removeProviderCredentials(session.id, parsed.data.provider);
    return { ok: true, provider: parsed.data.provider };
  });
}
