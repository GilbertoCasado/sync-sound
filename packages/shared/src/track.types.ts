import type { ProviderType } from './provider.types.js';

export interface TrackMetadata {
  title: string;
  artists: string[];
  album?: string;
  durationMs: number;
  isrc?: string;
}

export interface Track extends TrackMetadata {
  id: string;
  platform: ProviderType;
  externalUrl?: string;
  coverUrl?: string;
}

export type MatchConfidence = 'exact' | 'high' | 'low' | 'not_found';

export type MatchStrategy = 'cache' | 'isrc' | 'fuzzy' | 'none';

export interface MatchResult {
  sourceTrack: Track;
  targetTrack: Track | null;
  confidence: MatchConfidence;
  strategy: MatchStrategy;
  score: number;
  reason?: string;
}
