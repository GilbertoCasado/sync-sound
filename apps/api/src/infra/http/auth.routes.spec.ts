import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileOAuthConfigStore } from '../../adapters/auth/oauth-config.store.js';
import { OAuthService } from '../../adapters/auth/oauth.service.js';
import { loadEnv } from '../config/env.js';
import { buildApp } from './app.js';

describe('Auth OAuth Config & Popup Routes', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('salva credenciais pela API, abre login popup e conclui callback cross-host sem cookie', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'syncsound-auth-routes-'));
    tempDirs.push(dir);
    const configPath = path.join(dir, '.syncsound.oauth.json');

    const env = loadEnv({
      PORT: '3333',
      NODE_ENV: 'test',
      FRONTEND_URL: 'http://localhost:5173',
      SESSION_SECRET: 'test-session-secret-0123456789',
      OAUTH_CONFIG_FILE: configPath,
    });

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'sp-access-token-123',
          refresh_token: 'sp-refresh-456',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });

    const oauthConfigStore = new FileOAuthConfigStore(env, configPath);
    const oauthService = new OAuthService(oauthConfigStore, fetchMock);
    const app = await buildApp({ env, oauthConfigStore, oauthService });

    // 1. Configura credenciais do Spotify pela rota da UI
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/auth/spotify/config',
      payload: {
        clientId: 'spotify-client-abcdef1234',
        clientSecret: 'super-secret-do-not-leak',
        redirectUri: 'http://127.0.0.1:3333/auth/spotify/callback',
      },
    });

    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json() as Record<string, unknown>;
    expect(putBody.configured).toBe(true);
    expect(putBody.hasSecret).toBe(true);
    expect(putBody.configSource).toBe('local-file');
    expect(putBody.clientIdPreview).toBe('spotif...1234');
    expect(JSON.stringify(putBody)).not.toContain('super-secret-do-not-leak');

    const setCookieHeader = putRes.headers['set-cookie'];
    const cookiePair =
      (Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader)?.split(';')[0] ?? '';
    expect(cookiePair).toContain('syncsound_sid=');

    // 2. Inicia fluxo OAuth em modo popup
    const loginRes = await app.inject({
      method: 'GET',
      url: '/auth/spotify/login?mode=popup',
      headers: { cookie: cookiePair },
    });

    expect(loginRes.statusCode).toBe(302);
    const location = loginRes.headers.location ?? '';
    expect(location).toContain('https://accounts.spotify.com/authorize');
    const authUrl = new URL(location);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    // 3. Simula callback vindo em 127.0.0.1 (sem cookie de localhost)
    const callbackRes = await app.inject({
      method: 'GET',
      url: `/auth/spotify/callback?code=mock-auth-code&state=${encodeURIComponent(state!)}`,
    });

    expect(callbackRes.statusCode).toBe(200);
    expect(callbackRes.headers['content-type']).toContain('text/html');
    expect(callbackRes.payload).toContain('syncsound:oauth');
    expect(callbackRes.payload).toContain('"status":"success"');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 4. Sessão original em localhost passa a estar conectada
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: { cookie: cookiePair },
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json() as {
      providers: Array<{ provider: string; connected: boolean }>;
    };
    expect(statusBody.providers.find((p) => p.provider === 'spotify')?.connected).toBe(true);

    await app.close();
  });
});
