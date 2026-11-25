import type { ProviderType } from './provider.types.js';
import type { Track } from './track.types.js';

export interface PlaylistSummary {
  id: string;
  platform: ProviderType;
  name: string;
  description?: string;
  trackCount: number;
  coverUrl?: string;
  ownerName?: string;
  isPublic?: boolean;
}

export interface Playlist extends PlaylistSummary {
  tracks: Track[];
}
