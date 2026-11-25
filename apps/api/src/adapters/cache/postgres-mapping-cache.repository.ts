import {
  normalizeIsrc,
  type MappingCacheLookup,
  type TrackMapping,
} from '../../core/domain/mapping.js';
import type { IMappingCacheRepository } from '../../core/ports/mapping-cache.port.js';

export interface SqlQueryRunner {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

interface TargetTrackRow extends Record<string, unknown> {
  target_track_id: string;
}

export class PostgresMappingCacheRepository implements IMappingCacheRepository {
  constructor(private readonly db: SqlQueryRunner) {}

  async getMapping(lookup: MappingCacheLookup): Promise<string | null> {
    if (lookup.isrc) {
      const normalized = normalizeIsrc(lookup.isrc);
      if (normalized) {
        const result = await this.db.query<TargetTrackRow>(
          `SELECT target_track_id
           FROM track_mappings
           WHERE isrc = $1 AND target_platform = $2
           LIMIT 1`,
          [normalized, lookup.targetPlatform],
        );
        if (result.rows[0]?.target_track_id) {
          return result.rows[0].target_track_id;
        }
      }
    }

    if (lookup.sourcePlatform && lookup.sourceTrackId) {
      const result = await this.db.query<TargetTrackRow>(
        `SELECT target_track_id
         FROM track_mappings
         WHERE source_platform = $1
           AND source_track_id = $2
           AND target_platform = $3
         LIMIT 1`,
        [lookup.sourcePlatform, lookup.sourceTrackId, lookup.targetPlatform],
      );
      if (result.rows[0]?.target_track_id) {
        return result.rows[0].target_track_id;
      }
    }

    return null;
  }

  async setMapping(mapping: TrackMapping): Promise<void> {
    const normalizedIsrc = mapping.isrc ? normalizeIsrc(mapping.isrc) : null;

    await this.db.query(
      `INSERT INTO track_mappings (
         isrc,
         source_platform,
         source_track_id,
         target_platform,
         target_track_id,
         similarity_score
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_platform, source_track_id, target_platform)
       DO UPDATE SET
         target_track_id = EXCLUDED.target_track_id,
         isrc = COALESCE(EXCLUDED.isrc, track_mappings.isrc),
         similarity_score = COALESCE(EXCLUDED.similarity_score, track_mappings.similarity_score)`,
      [
        normalizedIsrc,
        mapping.sourcePlatform,
        mapping.sourceTrackId,
        mapping.targetPlatform,
        mapping.targetTrackId,
        mapping.similarityScore ?? null,
      ],
    );
  }
}
