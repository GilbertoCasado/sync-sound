import {
  buildIsrcCacheKey,
  buildTrackCacheKey,
  type MappingCacheLookup,
  type TrackMapping,
} from '../../core/domain/mapping.js';
import type { IMappingCacheRepository } from '../../core/ports/mapping-cache.port.js';

export class InMemoryMappingCacheRepository implements IMappingCacheRepository {
  private readonly store = new Map<string, string>();

  async getMapping(lookup: MappingCacheLookup): Promise<string | null> {
    if (lookup.isrc) {
      const byIsrc = this.store.get(buildIsrcCacheKey(lookup.targetPlatform, lookup.isrc));
      if (byIsrc) {
        return byIsrc;
      }
    }

    if (lookup.sourcePlatform && lookup.sourceTrackId) {
      const byTrack = this.store.get(
        buildTrackCacheKey(lookup.sourcePlatform, lookup.sourceTrackId, lookup.targetPlatform),
      );
      if (byTrack) {
        return byTrack;
      }
    }

    return null;
  }

  async setMapping(mapping: TrackMapping): Promise<void> {
    const trackKey = buildTrackCacheKey(
      mapping.sourcePlatform,
      mapping.sourceTrackId,
      mapping.targetPlatform,
    );
    this.store.set(trackKey, mapping.targetTrackId);

    if (mapping.isrc) {
      const isrcKey = buildIsrcCacheKey(mapping.targetPlatform, mapping.isrc);
      this.store.set(isrcKey, mapping.targetTrackId);
    }
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
