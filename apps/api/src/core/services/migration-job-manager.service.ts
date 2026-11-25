import { randomUUID } from 'node:crypto';
import type {
  MigrationJobSnapshot,
  MigrationProgressEvent,
  StartMigrationRequest,
  StartMigrationResponse,
} from '@syncsound/shared';
import type {
  MigratePlaylistCredentials,
  MigratePlaylistUseCase,
} from '../use-cases/migrate-playlist.use-case.js';

export type MigrationEventListener = (event: MigrationProgressEvent) => void;

interface JobEntry {
  snapshot: MigrationJobSnapshot;
  listeners: Set<MigrationEventListener>;
}

export class MigrationJobManager {
  private readonly jobs = new Map<string, JobEntry>();

  constructor(private readonly migratePlaylistUseCase: MigratePlaylistUseCase) {}

  startJob(
    request: StartMigrationRequest,
    credentials: MigratePlaylistCredentials,
  ): StartMigrationResponse {
    const jobId = randomUUID();
    const dryRun = Boolean(request.dryRun);

    const snapshot: MigrationJobSnapshot = {
      jobId,
      status: 'running',
      sourcePlatform: request.sourcePlatform,
      targetPlatform: request.targetPlatform,
      sourcePlaylistId: request.sourcePlaylistId,
      dryRun,
      totalTracks: 0,
      processedTracks: 0,
      events: [],
      createdAt: new Date().toISOString(),
    };

    const entry: JobEntry = {
      snapshot,
      listeners: new Set(),
    };
    this.jobs.set(jobId, entry);

    void this.runJob(entry, request, credentials);

    return {
      jobId,
      status: 'running',
      dryRun,
    };
  }

  getJob(jobId: string): MigrationJobSnapshot | null {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      return null;
    }
    return {
      ...entry.snapshot,
      events: [...entry.snapshot.events],
    };
  }

  subscribe(jobId: string, listener: MigrationEventListener): (() => void) | null {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      return null;
    }

    for (const existingEvent of entry.snapshot.events) {
      listener(existingEvent);
    }

    if (entry.snapshot.status === 'running' || entry.snapshot.status === 'queued') {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    }

    return () => {};
  }

  private async runJob(
    entry: JobEntry,
    request: StartMigrationRequest,
    credentials: MigratePlaylistCredentials,
  ): Promise<void> {
    try {
      await this.migratePlaylistUseCase.execute({
        jobId: entry.snapshot.jobId,
        request,
        credentials,
        onProgress: (event) => {
          entry.snapshot.events.push(event);

          if (event.type === 'started') {
            entry.snapshot.playlistName = event.playlistName;
            entry.snapshot.totalTracks = event.totalTracks;
          } else if (event.type === 'track_processed') {
            entry.snapshot.processedTracks = event.index;
          } else if (event.type === 'completed') {
            entry.snapshot.status = 'completed';
            entry.snapshot.summary = event.summary;
            entry.snapshot.finishedAt = event.timestamp;
          } else if (event.type === 'error') {
            entry.snapshot.status = 'failed';
            entry.snapshot.error = event.message;
            entry.snapshot.finishedAt = event.timestamp;
          }

          for (const listener of entry.listeners) {
            listener(event);
          }

          if (event.type === 'completed' || event.type === 'error') {
            entry.listeners.clear();
          }
        },
      });
    } catch (error) {
      if (entry.snapshot.status === 'running') {
        entry.snapshot.status = 'failed';
        entry.snapshot.error =
          error instanceof Error ? error.message : 'Erro desconhecido ao executar migração.';
        entry.snapshot.finishedAt = new Date().toISOString();
      }
      entry.listeners.clear();
    }
  }
}
