import type {
  MigrationJobSnapshot,
  MigrationProgressEvent,
  Playlist,
  ProviderType,
  StartMigrationResponse,
} from '@syncsound/shared';
import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import { InMemorySessionStore } from '../../adapters/session/in-memory-session.store.js';
import type { IMusicProvider } from '../../core/ports/music-provider.port.js';
import { buildApp } from './app.js';

function createFakeProvider(
  platform: ProviderType,
  overrides: Partial<IMusicProvider> = {},
): IMusicProvider {
  return {
    platform,
    listUserPlaylists: vi.fn(async () => []),
    getPlaylistWithTracks: vi.fn(async (): Promise<Playlist> => ({
      id: 'pl-1',
      platform,
      name: 'Playlist Teste SSE',
      trackCount: 1,
      tracks: [
        {
          id: 'dz-t1',
          platform,
          title: 'Bohemian Rhapsody',
          artists: ['Queen'],
          durationMs: 354_000,
          isrc: 'GBUM71029604',
        },
      ],
    })),
    searchByIsrc: vi.fn(async () => ({
      id: 'sp-t1',
      platform: 'spotify',
      title: 'Bohemian Rhapsody',
      artists: ['Queen'],
      durationMs: 354_000,
      isrc: 'GBUM71029604',
    })),
    searchTracks: vi.fn(async () => []),
    createPlaylist: vi.fn(async () => ({ id: 'sp-created-1' })),
    addTracksToPlaylist: vi.fn(async () => {}),
    ...overrides,
  };
}

const TEST_ENV = {
  PORT: 3333,
  NODE_ENV: 'test' as const,
  FRONTEND_URL: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-0123456789',
  OAUTH_CONFIG_FILE: '/tmp/syncsound-nonexistent-migrations-spec-oauth.json',
};

describe('API Routes & SSE Streaming', () => {
  it('retorna status inicial de autenticação dos 3 provedores', async () => {
    const app = await buildApp({ env: TEST_ENV });
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      providers: Array<{ provider: string; connected: boolean; supportsPublicRead: boolean }>;
    };
    expect(body.providers).toHaveLength(3);
    expect(body.providers.find((p) => p.provider === 'deezer')?.supportsPublicRead).toBe(true);

    await app.close();
  });

  it('executa migração dryRun em 2 etapas e faz stream SSE sem duplicar execução', async () => {
    const deezer = createFakeProvider('deezer');
    const spotify = createFakeProvider('spotify');
    const registry = new ProviderRegistry().register(deezer).register(spotify);

    const app = await buildApp({ env: TEST_ENV, providerRegistry: registry });

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/migrations',
      payload: {
        sourcePlatform: 'deezer',
        targetPlatform: 'spotify',
        sourcePlaylistId: '908622995',
        dryRun: true,
      },
    });

    expect(startRes.statusCode).toBe(202);
    const started = startRes.json() as StartMigrationResponse;
    expect(started.dryRun).toBe(true);

    // Primeira abertura do stream SSE aguarda a conclusão e fecha após o evento terminal
    const sseRes = await app.inject({
      method: 'GET',
      url: `/api/migrations/${started.jobId}/events`,
      headers: { origin: 'http://localhost:5173' },
    });

    expect(sseRes.statusCode).toBe(200);
    expect(sseRes.headers['content-type']).toContain('text/event-stream');
    expect(sseRes.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const parsedEvents = sseRes.payload
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice(6)) as MigrationProgressEvent);

    expect(parsedEvents.map((e) => e.type)).toEqual([
      'started',
      'track_processed',
      'completed',
    ]);

    // Reconexão ao mesmo jobId deve apenas fazer replay dos eventos sem reler a playlist
    const replayRes = await app.inject({
      method: 'GET',
      url: `/api/migrations/${started.jobId}/events`,
    });
    expect(replayRes.statusCode).toBe(200);
    expect(deezer.getPlaylistWithTracks).toHaveBeenCalledTimes(1);

    const snapshotRes = await app.inject({
      method: 'GET',
      url: `/api/migrations/${started.jobId}`,
    });
    expect(snapshotRes.statusCode).toBe(200);
    const snapshot = snapshotRes.json() as MigrationJobSnapshot;
    expect(snapshot.status).toBe('completed');
    expect(snapshot.summary?.matchedExact).toBe(1);

    await app.close();
  });

  it('bloqueia migração real sem autenticação no destino e permite quando autenticado na sessão', async () => {
    const deezer = createFakeProvider('deezer');
    const spotify = createFakeProvider('spotify');
    const registry = new ProviderRegistry().register(deezer).register(spotify);
    const sessionStore = new InMemorySessionStore();

    const app = await buildApp({
      env: TEST_ENV,
      providerRegistry: registry,
      sessionStore,
    });

    // Sem sessão conectada no Spotify -> 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/migrations',
      payload: {
        sourcePlatform: 'deezer',
        targetPlatform: 'spotify',
        sourcePlaylistId: '908622995',
        dryRun: false,
      },
    });
    expect(unauthRes.statusCode).toBe(401);

    // Captura cookie de sessão criado e injeta credencial Spotify na sessão
    const setCookieHeader = unauthRes.headers['set-cookie'];
    const cookiePair = (Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader)
      ?.split(';')[0] ?? '';

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: { cookie: cookiePair },
    });
    expect(statusRes.statusCode).toBe(200);

    // Obtém o sessionId interno via store para simular OAuth callback concluído
    const sidCookieValue = decodeURIComponent(cookiePair.split('=')[1] ?? '');
    const sessionId = sidCookieValue.split('.')[0]!;
    await sessionStore.setProviderCredentials(sessionId, 'spotify', {
      accessToken: 'sp-live-token',
    });

    const authRes = await app.inject({
      method: 'POST',
      url: '/api/migrations',
      headers: { cookie: cookiePair },
      payload: {
        sourcePlatform: 'deezer',
        targetPlatform: 'spotify',
        sourcePlaylistId: '908622995',
        dryRun: false,
      },
    });
    expect(authRes.statusCode).toBe(202);
    const { jobId } = authRes.json() as StartMigrationResponse;

    await app.inject({
      method: 'GET',
      url: `/api/migrations/${jobId}/events`,
    });

    expect(spotify.createPlaylist).toHaveBeenCalledTimes(1);
    expect(spotify.addTracksToPlaylist).toHaveBeenCalledWith(
      'sp-created-1',
      ['sp-t1'],
      { accessToken: 'sp-live-token' },
    );

    await app.close();
  });
});
