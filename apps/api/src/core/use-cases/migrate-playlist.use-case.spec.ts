import type { MigrationProgressEvent, Playlist, ProviderType, Track } from '@syncsound/shared';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryMappingCacheRepository } from '../../adapters/cache/in-memory-mapping-cache.repository.js';
import { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import type { IMusicProvider } from '../ports/music-provider.port.js';
import { MatchingEngine } from '../services/matching-engine.service.js';
import { MigratePlaylistUseCase } from './migrate-playlist.use-case.js';

function makeProvider(
  platform: ProviderType,
  overrides: Partial<IMusicProvider> = {},
): IMusicProvider {
  return {
    platform,
    listUserPlaylists: vi.fn(async () => []),
    getPlaylistWithTracks: vi.fn(async (): Promise<Playlist> => ({
      id: 'src-pl',
      platform,
      name: 'Rock Clássico',
      trackCount: 0,
      tracks: [],
    })),
    searchByIsrc: vi.fn(async () => null),
    searchTracks: vi.fn(async () => []),
    createPlaylist: vi.fn(async () => ({ id: 'new-pl', url: 'https://example.com/pl/new-pl' })),
    addTracksToPlaylist: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('MigratePlaylistUseCase', () => {
  it('simula migração em modo dryRun sem exigir credenciais nem criar playlist no destino', async () => {
    const tracks: Track[] = [
      {
        id: 'dz-1',
        platform: 'deezer',
        title: 'Bohemian Rhapsody',
        artists: ['Queen'],
        durationMs: 354_000,
        isrc: 'GBUM71029604',
      },
      {
        id: 'dz-2',
        platform: 'deezer',
        title: 'Música Inexistente',
        artists: ['Artista Desconhecido'],
        durationMs: 200_000,
      },
    ];

    const source = makeProvider('deezer', {
      getPlaylistWithTracks: vi.fn(async () => ({
        id: 'dz-pl-1',
        platform: 'deezer',
        name: 'Minha Playlist',
        trackCount: tracks.length,
        tracks,
      })),
    });

    const target = makeProvider('spotify', {
      searchByIsrc: vi.fn(async (isrc) =>
        isrc === 'GBUM71029604'
          ? {
              id: 'sp-1',
              platform: 'spotify',
              title: 'Bohemian Rhapsody',
              artists: ['Queen'],
              durationMs: 354_000,
              isrc,
            }
          : null,
      ),
    });

    const registry = new ProviderRegistry().register(source).register(target);
    const engine = new MatchingEngine(new InMemoryMappingCacheRepository());
    const useCase = new MigratePlaylistUseCase(registry, engine);

    const events: MigrationProgressEvent[] = [];
    const summary = await useCase.execute({
      jobId: 'job-dry-1',
      request: {
        sourcePlatform: 'deezer',
        targetPlatform: 'spotify',
        sourcePlaylistId: 'dz-pl-1',
        dryRun: true,
      },
      credentials: {},
      onProgress: (ev) => events.push(ev),
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.matchedExact).toBe(1);
    expect(summary.notFound).toBe(1);
    expect(summary.targetPlaylistId).toBeUndefined();
    expect(target.createPlaylist).not.toHaveBeenCalled();
    expect(target.addTracksToPlaylist).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual([
      'started',
      'track_processed',
      'track_processed',
      'completed',
    ]);
  });

  it('cria playlist e adiciona faixas correspondentes quando dryRun=false', async () => {
    const source = makeProvider('spotify', {
      getPlaylistWithTracks: vi.fn(async () => ({
        id: 'sp-pl-1',
        platform: 'spotify',
        name: 'Favoritas',
        trackCount: 1,
        tracks: [
          {
            id: 'sp-t1',
            platform: 'spotify',
            title: 'Tempo Perdido',
            artists: ['Legião Urbana'],
            durationMs: 300_000,
            isrc: 'BRBMG8600001',
          },
        ],
      })),
    });

    const target = makeProvider('deezer', {
      searchByIsrc: vi.fn(async () => ({
        id: 'dz-t1',
        platform: 'deezer',
        title: 'Tempo Perdido',
        artists: ['Legião Urbana'],
        durationMs: 300_000,
        isrc: 'BRBMG8600001',
      })),
    });

    const registry = new ProviderRegistry().register(source).register(target);
    const useCase = new MigratePlaylistUseCase(
      registry,
      new MatchingEngine(new InMemoryMappingCacheRepository()),
    );

    const summary = await useCase.execute({
      jobId: 'job-real-1',
      request: {
        sourcePlatform: 'spotify',
        targetPlatform: 'deezer',
        sourcePlaylistId: 'sp-pl-1',
        targetPlaylistName: 'Favoritas (Deezer)',
        dryRun: false,
      },
      credentials: {
        source: { accessToken: 'sp-token' },
        target: { accessToken: 'dz-token' },
      },
    });

    expect(summary.targetPlaylistId).toBe('new-pl');
    expect(target.createPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Favoritas (Deezer)' }),
      { accessToken: 'dz-token' },
    );
    expect(target.addTracksToPlaylist).toHaveBeenCalledWith('new-pl', ['dz-t1'], {
      accessToken: 'dz-token',
    });
  });

  it('falha imediatamente se dryRun=false e destino não estiver autenticado', async () => {
    const registry = new ProviderRegistry()
      .register(makeProvider('deezer'))
      .register(makeProvider('spotify'));
    const useCase = new MigratePlaylistUseCase(
      registry,
      new MatchingEngine(new InMemoryMappingCacheRepository()),
    );

    await expect(
      useCase.execute({
        jobId: 'job-err',
        request: {
          sourcePlatform: 'deezer',
          targetPlatform: 'spotify',
          sourcePlaylistId: '123',
          dryRun: false,
        },
        credentials: {},
      }),
    ).rejects.toThrow(/Autenticação necessária/i);
  });
});
