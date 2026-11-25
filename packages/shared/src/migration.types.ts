import type { ProviderType } from './provider.types.js';
import type { MatchResult } from './track.types.js';

export type MigrationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface StartMigrationRequest {
  sourcePlatform: ProviderType;
  targetPlatform: ProviderType;
  sourcePlaylistId: string;
  targetPlaylistName?: string;
  dryRun?: boolean;
}

export interface StartMigrationResponse {
  jobId: string;
  status: MigrationJobStatus;
  dryRun: boolean;
}

export interface MigrationSummary {
  jobId: string;
  sourcePlatform: ProviderType;
  targetPlatform: ProviderType;
  playlistName: string;
  dryRun: boolean;
  totalTracks: number;
  matchedExact: number;
  matchedHigh: number;
  matchedLow: number;
  notFound: number;
  targetPlaylistId?: string;
  targetPlaylistUrl?: string;
}

export type MigrationProgressEvent =
  | {
      type: 'started';
      jobId: string;
      playlistName: string;
      totalTracks: number;
      dryRun: boolean;
      timestamp: string;
    }
  | {
      type: 'track_processed';
      jobId: string;
      index: number;
      totalTracks: number;
      result: MatchResult;
      timestamp: string;
    }
  | {
      type: 'completed';
      jobId: string;
      summary: MigrationSummary;
      timestamp: string;
    }
  | {
      type: 'error';
      jobId: string;
      message: string;
      timestamp: string;
    };
