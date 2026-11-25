import type { ProviderType } from '@syncsound/shared';

export interface MappingCacheLookup {
  targetPlatform: ProviderType;
  isrc?: string;
  sourcePlatform?: ProviderType;
  sourceTrackId?: string;
}

export interface TrackMapping {
  isrc?: string;
  sourcePlatform: ProviderType;
  sourceTrackId: string;
  targetPlatform: ProviderType;
  targetTrackId: string;
  similarityScore?: number;
}

export function normalizeIsrc(isrc: string): string {
  return isrc.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function buildIsrcCacheKey(targetPlatform: ProviderType, isrc: string): string {
  return `isrc:${targetPlatform}:${normalizeIsrc(isrc)}`;
}

export function buildTrackCacheKey(
  sourcePlatform: ProviderType,
  sourceTrackId: string,
  targetPlatform: ProviderType,
): string {
  return `track:${sourcePlatform}:${sourceTrackId}:${targetPlatform}`;
}
