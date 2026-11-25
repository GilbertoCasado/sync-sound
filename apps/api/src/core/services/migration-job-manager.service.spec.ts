import type { MigrationProgressEvent, Playlist, ProviderType } from '@syncsound/shared';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryMappingCacheRepository } from '../../adapters/cache/in-memory-mapping-cache.repository.js';
import { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import type { IMusicProvider } from '../ports/music-provider.port.js';
import { MigratePlaylistUseCase } from '../use-cases/migrate-playlist.use-case.js';
import { MatchingEngine } from './matching-engine.service.js';
import { MigrationJobManager } from './migration-job-manager.service.js';

function stubProvider(
  platform: ProviderType,
  overrides: Partial<IMusicProvider> = {},
): IMusicProvider {
  return {
    platform,
    listUserPlaylists: vi.fn(async () => []),
    getPlaylistWithTracks: vi.fn(async (): Promise<Playlist> => ({
      id: 'pl-1',
      platform,
      name: 'Teste Replay',
      trackCount: 1,
      tracks: [
        {
          id: 't-1',
          platform,
          title: 'Song A',
          artists: ['Artist A'],
          durationMs: 180_000,
          isrc: 'ISRC001',
        },
      ],
    })),
    searchByIsrc: vi.fn(async () => ({
      id: 'target-t-1',
      platform: 'spotify',
      title: 'Song A',
      artists: ['Artist A'],
      durationMs: 180_000,
      isrc: 'ISRC001',
    })),
    searchTracks: vi.fn(async () => []),
    createPlaylist: vi.fn(async () => ({ id: 'new-pl' })),
    addTracksToPlaylist: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('MigrationJobManager', () => {
  it('executa job em background e faz replay completo dos eventos em novas inscrições SSE', async () => {
    const source = stubProvider('deezer');
    const target = stubProvider('spotify');
    const registry = new ProviderRegistry().register(source).register(target);
    const useCase = new MigratePlaylistUseCase(
      registry,
      new MatchingEngine(new InMemoryMappingCacheRepository()),
    );
    const manager = new MigrationJobManager(useCase);

    const started = manager.startJob(
      {
        sourcePlatform: 'deezer',
        targetPlatform: 'spotify',
        sourcePlaylistId: 'pl-1',
        dryRun: true,
      },
      {},
    );

    expect(started.status).toBe('running');

    // Aguarda conclusão assíncrona
    await vi.waitFor(() => {
      expect(manager.getJob(started.jobId)?.status).toBe('completed');
    });

    // Segunda inscrição após o término deve receber todos os eventos sem reexecutar o provider
    const replayed: MigrationProgressEvent[] = [];
    const unsub = manager.subscribe(started.jobId, (ev) => replayed.push(ev));
    expect(unsub).not.toBeNull();
    unsub?.();

    expect(replayed.map((e) => e.type)).toEqual([
      'started',
      'track_processed',
      'completed',
    ]);
    expect(source.getPlaylistWithTracks).toHaveBeenCalledTimes(1);
  });
});
