import type { ProviderAuthStatus, ProviderType } from '@syncsound/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { OAuthService } from '../../../adapters/auth/oauth.service.js';
import type { UserSession } from '../../../core/ports/session-store.port.js';
import { getOrCreateSession } from '../session.helper.js';

const PROVIDERS: ProviderType[] = ['spotify', 'deezer', 'youtube'];
const providerParamSchema = z.object({
  provider: z.enum(['spotify', 'deezer', 'youtube']),
});

const saveOAuthConfigSchema = z.object({
  clientId: z.string().trim().min(1, 'Informe o Client ID da aplicação.'),
  clientSecret: z.string().trim().optional(),
  redirectUri: z
    .string()
    .trim()
    .url('Redirect URI inválida.')
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
      message: 'A Redirect URI deve começar com http:// ou https://.',
    }),
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderPopupResultHtml(params: {
  frontendUrl: string;
  provider: ProviderType;
  status: 'success' | 'error';
  error?: string;
}): string {
  const targetOrigin = new URL(params.frontendUrl).origin;
  const payload = {
    type: 'syncsound:oauth',
    provider: params.provider,
    status: params.status,
    ...(params.error ? { error: params.error } : {}),
  };

  const title =
    params.status === 'success'
      ? `Conexão com ${params.provider} concluída`
      : `Falha ao conectar ${params.provider}`;
  const description =
    params.status === 'success'
      ? 'Autenticação concluída com sucesso. Você já pode fechar esta janela e voltar ao SyncSound.'
      : params.error || 'Não foi possível concluir a autenticação.';

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — SyncSound</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #020617;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        padding: 24px;
      }
      .card {
        max-width: 420px;
        width: 100%;
        border: 1px solid ${params.status === 'success' ? '#10b98166' : '#f43f5e66'};
        background: #0f172a;
        border-radius: 16px;
        padding: 24px;
        text-align: center;
      }
      h1 { font-size: 1.15rem; margin: 0 0 8px; }
      p { font-size: 0.92rem; color: #cbd5e1; margin: 0 0 18px; line-height: 1.45; }
      button {
        background: #6366f1;
        color: #fff;
        border: 0;
        border-radius: 10px;
        padding: 10px 16px;
        font-weight: 600;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <button type="button" onclick="window.close()">Fechar janela</button>
    </main>
    <script>
      (function () {
        var payload = ${serializeForScript(payload)};
        var targetOrigin = ${serializeForScript(targetOrigin)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin);
          }
        } catch (err) {}
        if (payload.status === 'success') {
          setTimeout(function () { window.close(); }, 150);
        }
      })();
    </script>
  </body>
</html>`;
}

async function buildProviderStatus(
  provider: ProviderType,
  session: UserSession,
  oauthService: OAuthService,
): Promise<ProviderAuthStatus> {
  const credentials = session.providers[provider];
  const meta = await oauthService.getStatusMeta(provider);

  return {
    provider,
    connected: Boolean(credentials?.accessToken),
    configured: meta.configured,
    configSource: meta.configSource,
    clientIdPreview: meta.clientIdPreview,
    redirectUri: meta.redirectUri,
    hasSecret: meta.hasSecret,
    supportsPublicRead: provider === 'deezer',
    expiresAt: credentials?.expiresAt
      ? new Date(credentials.expiresAt).toISOString()
      : undefined,
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { env, sessionStore, oauthService } = app.syncsound;

  app.get('/api/auth/status', async (request, reply) => {
    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const statuses = await Promise.all(
      PROVIDERS.map((provider) => buildProviderStatus(provider, session, oauthService)),
    );
    return { providers: statuses };
  });

  app.put('/api/auth/:provider/config', async (request, reply) => {
    if (env.NODE_ENV === 'production' && !env.ALLOW_UI_OAUTH_CONFIG) {
      return reply.status(403).send({
        message: 'Configuração de OAuth pela interface desabilitada em produção.',
      });
    }

    const parsedParams = providerParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const parsedBody = saveOAuthConfigSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({
        message: parsedBody.error.issues[0]?.message ?? 'Dados de configuração inválidos.',
      });
    }

    const { provider } = parsedParams.data;
    const session = await getOrCreateSession(request, reply, sessionStore, env);

    try {
      await oauthService.saveConfig(provider, parsedBody.data);
      const status = await buildProviderStatus(provider, session, oauthService);
      return status;
    } catch (error) {
      return reply.status(400).send({
        message:
          error instanceof Error ? error.message : 'Não foi possível salvar a configuração OAuth.',
      });
    }
  });

  app.delete('/api/auth/:provider/config', async (request, reply) => {
    if (env.NODE_ENV === 'production' && !env.ALLOW_UI_OAUTH_CONFIG) {
      return reply.status(403).send({
        message: 'Configuração de OAuth pela interface desabilitada em produção.',
      });
    }

    const parsedParams = providerParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const { provider } = parsedParams.data;
    const session = await getOrCreateSession(request, reply, sessionStore, env);
    await oauthService.clearConfig(provider);
    return buildProviderStatus(provider, session, oauthService);
  });

  app.get('/auth/:provider/login', async (request, reply) => {
    const parsed = providerParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const { provider } = parsed.data;
    const query = request.query as { mode?: string };
    const mode = query.mode === 'popup' ? 'popup' : 'redirect';

    const configured = await oauthService.isConfigured(provider);
    if (!configured) {
      const msg = `Credenciais OAuth para ${provider} não configuradas.`;
      if (mode === 'popup') {
        return reply
          .type('text/html; charset=utf-8')
          .send(
            renderPopupResultHtml({
              frontendUrl: env.FRONTEND_URL,
              provider,
              status: 'error',
              error: msg,
            }),
          );
      }
      return reply.redirect(`${env.FRONTEND_URL}/?auth_error=${encodeURIComponent(msg)}`);
    }

    const session = await getOrCreateSession(request, reply, sessionStore, env);
    const state = await sessionStore.createOAuthState(session.id, provider, mode);
    const authorizeUrl = await oauthService.getAuthorizeUrl(provider, state);
    return reply.redirect(authorizeUrl);
  });

  app.get('/auth/:provider/callback', async (request, reply) => {
    const parsedParams = providerParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ message: 'Plataforma inválida.' });
    }

    const { provider } = parsedParams.data;
    const query = request.query as { code?: string; state?: string; error?: string };

    const stateRecord = query.state
      ? await sessionStore.consumeOAuthStateByToken(query.state, provider)
      : null;
    const mode = stateRecord?.mode ?? 'redirect';

    const sendError = (message: string) => {
      if (mode === 'popup') {
        return reply
          .type('text/html; charset=utf-8')
          .send(
            renderPopupResultHtml({
              frontendUrl: env.FRONTEND_URL,
              provider,
              status: 'error',
              error: message,
            }),
          );
      }
      return reply.redirect(`${env.FRONTEND_URL}/?auth_error=${encodeURIComponent(message)}`);
    };

    if (query.error) {
      return sendError(`Autorização negada (${provider}): ${query.error}`);
    }

    if (!query.code || !query.state) {
      return sendError('Parâmetros code/state ausentes no callback OAuth.');
    }

    if (!stateRecord) {
      return sendError('Estado OAuth inválido ou expirado.');
    }

    try {
      const credentials = await oauthService.exchangeCode(provider, query.code);
      await sessionStore.setProviderCredentials(stateRecord.sessionId, provider, credentials);

      if (mode === 'popup') {
        return reply
          .type('text/html; charset=utf-8')
          .send(
            renderPopupResultHtml({
              frontendUrl: env.FRONTEND_URL,
              provider,
              status: 'success',
            }),
          );
      }
      return reply.redirect(`${env.FRONTEND_URL}/?connected=${provider}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao trocar código OAuth por token.';
      return sendError(message);
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
