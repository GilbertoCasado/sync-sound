import { describe, expect, it, vi } from 'vitest';
import {
  PostgresMappingCacheRepository,
  type SqlQueryRunner,
} from './postgres-mapping-cache.repository.js';

describe('PostgresMappingCacheRepository', () => {
  it('consulta por ISRC + target_platform antes de usar source_track_id', async () => {
    const query = vi.fn<SqlQueryRunner['query']>(async () => ({
      rows: [{ target_track_id: 'dz-42' }],
    }));

    const repo = new PostgresMappingCacheRepository({ query });
    const result = await repo.getMapping({
      targetPlatform: 'deezer',
      isrc: 'br-123-45',
      sourcePlatform: 'spotify',
      sourceTrackId: 'sp-1',
    });

    expect(result).toBe('dz-42');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(['BR12345', 'deezer']);
  });

  it('persiste upsert respeitando constraint única por origem e destino', async () => {
    const query = vi.fn<SqlQueryRunner['query']>(async () => ({ rows: [] }));
    const repo = new PostgresMappingCacheRepository({ query });

    await repo.setMapping({
      isrc: 'USRC17607839',
      sourcePlatform: 'spotify',
      sourceTrackId: 'sp-1',
      targetPlatform: 'youtube',
      targetTrackId: 'yt-1',
      similarityScore: 0.94,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'USRC17607839',
      'spotify',
      'sp-1',
      'youtube',
      'yt-1',
      0.94,
    ]);
  });
});
