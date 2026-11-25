import { describe, expect, it } from 'vitest';
import { InMemoryMappingCacheRepository } from './in-memory-mapping-cache.repository.js';

describe('InMemoryMappingCacheRepository', () => {
  it('isola mapeamentos por plataforma de destino mesmo para o mesmo ISRC', async () => {
    const cache = new InMemoryMappingCacheRepository();

    await cache.setMapping({
      isrc: 'USRC17607839',
      sourcePlatform: 'spotify',
      sourceTrackId: 'sp-track-1',
      targetPlatform: 'deezer',
      targetTrackId: 'dz-999',
    });

    await cache.setMapping({
      isrc: 'USRC17607839',
      sourcePlatform: 'spotify',
      sourceTrackId: 'sp-track-1',
      targetPlatform: 'youtube',
      targetTrackId: 'yt-abc',
    });

    const deezerId = await cache.getMapping({
      targetPlatform: 'deezer',
      isrc: 'usrc-1760-7839',
    });
    const youtubeId = await cache.getMapping({
      targetPlatform: 'youtube',
      isrc: 'USRC17607839',
    });

    expect(deezerId).toBe('dz-999');
    expect(youtubeId).toBe('yt-abc');
  });

  it('faz fallback para sourcePlatform + sourceTrackId quando não há ISRC', async () => {
    const cache = new InMemoryMappingCacheRepository();

    await cache.setMapping({
      sourcePlatform: 'deezer',
      sourceTrackId: 'dz-123',
      targetPlatform: 'spotify',
      targetTrackId: 'sp-777',
    });

    const found = await cache.getMapping({
      sourcePlatform: 'deezer',
      sourceTrackId: 'dz-123',
      targetPlatform: 'spotify',
    });

    expect(found).toBe('sp-777');
  });
});
