import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../infra/config/env.js';
import { FileOAuthConfigStore, maskClientId } from './oauth-config.store.js';

describe('FileOAuthConfigStore', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  async function createTempFilePath(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'syncsound-oauth-'));
    tempDirs.push(dir);
    return path.join(dir, '.syncsound.oauth.json');
  }

  it('retorna fallback do .env quando arquivo local não existe e usa 127.0.0.1 padrão para Spotify', async () => {
    const filePath = await createTempFilePath();
    const env = loadEnv({
      PORT: '3333',
      NODE_ENV: 'test',
      SPOTIFY_CLIENT_ID: 'env-sp-client-id',
      SPOTIFY_CLIENT_SECRET: 'env-sp-secret',
      SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3333/auth/spotify/callback',
    });

    const store = new FileOAuthConfigStore(env, filePath);
    const spotify = await store.getProviderConfig('spotify');
    const youtube = await store.getProviderConfig('youtube');

    expect(spotify.source).toBe('env');
    expect(spotify.config?.clientId).toBe('env-sp-client-id');
    expect(youtube.source).toBe('none');
    expect(youtube.defaultRedirectUri).toBe('http://localhost:3333/auth/youtube/callback');
    expect(store.getDefaultRedirectUri('spotify')).toBe(
      'http://127.0.0.1:3333/auth/spotify/callback',
    );
  });

  it('salva em arquivo local, preserva secret ao editar sem secret e permite remover override', async () => {
    const filePath = await createTempFilePath();
    const env = loadEnv({ PORT: '3333', NODE_ENV: 'test' });
    const store = new FileOAuthConfigStore(env, filePath);

    await store.saveProviderConfig('youtube', {
      clientId: 'google-client-1234567890',
      clientSecret: 'super-secret-value',
      redirectUri: 'http://localhost:3333/auth/youtube/callback',
    });

    const first = await store.getProviderConfig('youtube');
    expect(first.source).toBe('local-file');
    expect(first.config?.clientSecret).toBe('super-secret-value');
    expect(maskClientId(first.config!.clientId)).toBe('google...7890');

    // Atualiza clientId omitindo clientSecret -> mantém secret salvo
    await store.saveProviderConfig('youtube', {
      clientId: 'google-client-updated',
      redirectUri: 'http://localhost:3333/auth/youtube/callback',
    });

    const updated = await store.getProviderConfig('youtube');
    expect(updated.config?.clientId).toBe('google-client-updated');
    expect(updated.config?.clientSecret).toBe('super-secret-value');

    await store.deleteProviderConfig('youtube');
    const cleared = await store.getProviderConfig('youtube');
    expect(cleared.source).toBe('none');
    expect(cleared.config).toBeNull();
  });

  it('exige Client Secret quando ainda não há nenhum salvo', async () => {
    const filePath = await createTempFilePath();
    const env = loadEnv({ PORT: '3333', NODE_ENV: 'test' });
    const store = new FileOAuthConfigStore(env, filePath);

    await expect(
      store.saveProviderConfig('deezer', {
        clientId: 'dz-app-id',
        redirectUri: 'http://localhost:3333/auth/deezer/callback',
      }),
    ).rejects.toThrow(/Client Secret/i);
  });
});
