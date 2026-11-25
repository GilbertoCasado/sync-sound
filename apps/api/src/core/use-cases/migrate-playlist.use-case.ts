import type {
  MigrationProgressEvent,
  MigrationSummary,
  StartMigrationRequest,
} from '@syncsound/shared';
import type { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import type { ProviderCredentials } from '../ports/music-provider.port.js';
import type { MatchingEngine } from '../services/matching-engine.service.js';

export interface MigratePlaylistCredentials {
  source?: ProviderCredentials;
  target?: ProviderCredentials;
}

export interface MigratePlaylistInput {
  jobId: string;
  request: StartMigrationRequest;
  credentials: MigratePlaylistCredentials;
  onProgress?: (event: MigrationProgressEvent) => void;
}

export class MigratePlaylistUseCase {
  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly matchingEngine: MatchingEngine,
  ) {}

  async execute(input: MigratePlaylistInput): Promise<MigrationSummary> {
    const { jobId, request, credentials, onProgress } = input;
    const dryRun = Boolean(request.dryRun);
    const includeLowConfidence = request.includeLowConfidence !== false;

    const emit = (event: MigrationProgressEvent) => {
      onProgress?.(event);
    };

    try {
      if (!dryRun && !credentials.target) {
        throw new Error('Autenticação necessária na plataforma de destino para criar a playlist.');
      }

      const sourceProvider = this.providerRegistry.get(request.sourcePlatform);
      const targetProvider = this.providerRegistry.get(request.targetPlatform);

      const sourcePlaylist = await sourceProvider.getPlaylistWithTracks(
        request.sourcePlaylistId,
        credentials.source,
      );

      const playlistName = request.targetPlaylistName?.trim() || sourcePlaylist.name;
      const totalTracks = sourcePlaylist.tracks.length;

      emit({
        type: 'started',
        jobId,
        playlistName,
        totalTracks,
        dryRun,
        timestamp: new Date().toISOString(),
      });

      let matchedExact = 0;
      let matchedHigh = 0;
      let matchedLow = 0;
      let notFound = 0;
      const targetTrackIds: string[] = [];

      for (let index = 0; index < sourcePlaylist.tracks.length; index += 1) {
        const track = sourcePlaylist.tracks[index]!;
        const result = await this.matchingEngine.matchTrack(
          track,
          targetProvider,
          credentials.target,
        );

        if (result.confidence === 'exact') {
          matchedExact += 1;
          if (result.targetTrack) {
            targetTrackIds.push(result.targetTrack.id);
          }
        } else if (result.confidence === 'high') {
          matchedHigh += 1;
          if (result.targetTrack) {
            targetTrackIds.push(result.targetTrack.id);
          }
        } else if (result.confidence === 'low') {
          matchedLow += 1;
          if (includeLowConfidence && result.targetTrack) {
            targetTrackIds.push(result.targetTrack.id);
          }
        } else {
          notFound += 1;
        }

        emit({
          type: 'track_processed',
          jobId,
          index: index + 1,
          totalTracks,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      let targetPlaylistId: string | undefined;
      let targetPlaylistUrl: string | undefined;

      if (!dryRun && credentials.target) {
        const created = await targetProvider.createPlaylist(
          {
            name: playlistName,
            description:
              sourcePlaylist.description ||
              `Migrada de ${request.sourcePlatform} via SyncSound`,
            isPublic: false,
          },
          credentials.target,
        );
        targetPlaylistId = created.id;
        targetPlaylistUrl = created.url;

        if (targetTrackIds.length > 0) {
          await targetProvider.addTracksToPlaylist(
            created.id,
            targetTrackIds,
            credentials.target,
          );
        }
      }

      const summary: MigrationSummary = {
        jobId,
        sourcePlatform: request.sourcePlatform,
        targetPlatform: request.targetPlatform,
        playlistName,
        dryRun,
        totalTracks,
        matchedExact,
        matchedHigh,
        matchedLow,
        notFound,
        targetPlaylistId,
        targetPlaylistUrl,
      };

      emit({
        type: 'completed',
        jobId,
        summary,
        timestamp: new Date().toISOString(),
      });

      return summary;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro inesperado durante a migração.';
      emit({
        type: 'error',
        jobId,
        message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }
}
