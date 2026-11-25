import type { Playlist, PlaylistSummary, ProviderType, Track } from '@syncsound/shared';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryMappingCacheRepository } from '../../adapters/cache/in-memory-mapping-cache.repository.js';
import type { IMusicProvider } from '../ports/music-provider.port.js';
import { MatchingEngine } from './matching-engine.service.js';

function createStubProvider(
  platform: ProviderType,
  overrides: Partial<IMusicProvider> = {},
): IMusicProvider {
  return {
    platform,
    listUserPlaylists: vi.fn(async () => [] as PlaylistSummary[]),
    getPlaylistWithTracks: vi.fn(async (): Promise<Playlist> => ({
      id: 'pl-1',
      platform,
      name: 'Stub Playlist',
      trackCount: 0,
      tracks: [],
    })),
    searchByIsrc: vi.fn(async () => null),
    searchTracks: vi.fn(async () => []),
    createPlaylist: vi.fn(async () => ({ id: 'created-1' })),
    addTracksToPlaylist: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('MatchingEngine', () => {
  it('retorna match instantâneo via cache sem consultar a API de destino', async () => {
    const cache = new InMemoryMappingCacheRepository();
    await cache.setMapping({
      isrc: 'USRC17607839',
      sourcePlatform: 'spotify',
      sourceTrackId: 'sp-1',
      targetPlatform: 'deezer',
      targetTrackId: 'dz-cached',
    });

    const targetProvider = createStubProvider('deezer');
    const engine = new MatchingEngine(cache);

    const result = await engine.matchTrack(
      {
        id: 'sp-1',
        platform: 'spotify',
        title: 'Bohemian Rhapsody',
        artists: ['Queen'],
        durationMs: 354_000,
        isrc: 'USRC17607839',
      },
      targetProvider,
    );

    expect(result.confidence).toBe('exact');
    expect(result.strategy).toBe('cache');
    expect(result.targetTrack?.id).toBe('dz-cached');
    expect(targetProvider.searchByIsrc).not.toHaveBeenCalled();
    expect(targetProvider.searchTracks).not.toHaveBeenCalled();
  });

  it('prioriza busca por ISRC e salva resultado no cache', async () => {
    const cache = new InMemoryMappingCacheRepository();
    const isrcHit: Track = {
      id: 'dz-555',
      platform: 'deezer',
      title: 'Bohemian Rhapsody',
      artists: ['Queen'],
      durationMs: 354_000,
      isrc: 'GBUM71029604',
    };
    const targetProvider = createStubProvider('deezer', {
      searchByIsrc: vi.fn(async () => isrcHit),
    });

    const engine = new MatchingEngine(cache);
    const result = await engine.matchTrack(
      {
        id: 'sp-2',
        platform: 'spotify',
        title: 'Bohemian Rhapsody - Remastered 2011',
        artists: ['Queen'],
        durationMs: 354_320,
        isrc: 'GBUM71029604',
      },
      targetProvider,
    );

    expect(result.confidence).toBe('exact');
    expect(result.strategy).toBe('isrc');
    expect(result.targetTrack?.id).toBe('dz-555');
    expect(
      await cache.getMapping({ targetPlatform: 'deezer', isrc: 'GBUM71029604' }),
    ).toBe('dz-555');
  });

  it('penaliza divergência entre versão de estúdio e versão Live/Ao Vivo', async () => {
    const cache = new InMemoryMappingCacheRepository();
    const liveTrack: Track = {
      id: 'dz-live',
      platform: 'deezer',
      title: 'Tempo Perdido (Ao Vivo)',
      artists: ['Legião Urbana'],
      durationMs: 300_000,
    };
    const studioTrack: Track = {
      id: 'dz-studio',
      platform: 'deezer',
      title: 'Tempo Perdido',
      artists: ['Legião Urbana'],
      durationMs: 302_000,
    };

    const targetProvider = createStubProvider('deezer', {
      searchTracks: vi.fn(async () => [liveTrack, studioTrack]),
    });

    const engine = new MatchingEngine(cache);
    const result = await engine.matchTrack(
      {
        id: 'sp-3',
        platform: 'spotify',
        title: 'Tempo Perdido',
        artists: ['Legiao Urbana'],
        durationMs: 301_000,
      },
      targetProvider,
    );

    expect(result.confidence).toBe('high');
    expect(result.strategy).toBe('fuzzy');
    expect(result.targetTrack?.id).toBe('dz-studio');
    expect(result.score).toBeGreaterThanOrEqual(0.95);
  });

  it('aplica tolerância maior de duração no YouTube e interpreta título "Artista - Música"', async () => {
    const cache = new InMemoryMappingCacheRepository();
    const ytClip: Track = {
      id: 'yt-clip-1',
      platform: 'youtube',
      title: 'Daft Punk - Instant Crush (Official Video)',
      artists: ['Daft Punk - Topic'],
      durationMs: 345_000, // +17s em relação ao áudio de 328s
    };

    const targetProvider = createStubProvider('youtube', {
      searchTracks: vi.fn(async () => [ytClip]),
    });

    const engine = new MatchingEngine(cache);
    const result = await engine.matchTrack(
      {
        id: 'sp-4',
        platform: 'spotify',
        title: 'Instant Crush',
        artists: ['Daft Punk', 'Julian Casablancas'],
        durationMs: 328_000,
      },
      targetProvider,
    );

    expect(result.confidence).toBe('high');
    expect(result.targetTrack?.id).toBe('yt-clip-1');
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it('marca como not_found quando diferença de duração e texto derrubam o score abaixo de 0.65', async () => {
    const cache = new InMemoryMappingCacheRepository();
    const wrongTrack: Track = {
      id: 'dz-wrong',
      platform: 'deezer',
      title: 'Completely Different Song',
      artists: ['Unknown Artist'],
      durationMs: 120_000,
    };

    const targetProvider = createStubProvider('deezer', {
      searchTracks: vi.fn(async () => [wrongTrack]),
    });

    const engine = new MatchingEngine(cache);
    const result = await engine.matchTrack(
      {
        id: 'sp-5',
        platform: 'spotify',
        title: 'Bohemian Rhapsody',
        artists: ['Queen'],
        durationMs: 354_000,
      },
      targetProvider,
    );

    expect(result.confidence).toBe('not_found');
    expect(result.targetTrack).toBeNull();
  });
});
