import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /api/health', () => {
  it('retorna status ok em modo stateless-in-memory por padrão', async () => {
    const app = await buildApp({
      env: {
        PORT: 3333,
        NODE_ENV: 'test',
        FRONTEND_URL: 'http://localhost:5173',
        SESSION_SECRET: 'test-session-secret-0123456789',
        OAUTH_CONFIG_FILE: '/tmp/syncsound-nonexistent-app-spec-oauth.json',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('syncsound-api');
    expect(body.mode).toBe('stateless-in-memory');

    await app.close();
  });
});
