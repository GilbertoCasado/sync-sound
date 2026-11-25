import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MatchResult,
  MigrationJobStatus,
  MigrationProgressEvent,
  MigrationSummary,
} from '@syncsound/shared';

export interface MigrationStreamState {
  status: MigrationJobStatus | 'idle';
  playlistName: string | null;
  totalTracks: number;
  dryRun: boolean;
  results: MatchResult[];
  summary: MigrationSummary | null;
  connected: boolean;
  error: string | null;
  reset: () => void;
}

/**
 * Consome o stream SSE da etapa 2 (`GET /api/migrations/:jobId/events`).
 * A criação do job acontece separadamente via `POST /api/migrations` para evitar duplicações em reconexões.
 */
export function useMigrationStream(jobId: string | null): MigrationStreamState {
  const [status, setStatus] = useState<MigrationJobStatus | 'idle'>('idle');
  const [playlistName, setPlaylistName] = useState<string | null>(null);
  const [totalTracks, setTotalTracks] = useState(0);
  const [dryRun, setDryRun] = useState(false);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [summary, setSummary] = useState<MigrationSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalReachedRef = useRef(false);

  const reset = useCallback(() => {
    terminalReachedRef.current = false;
    setStatus('idle');
    setPlaylistName(null);
    setTotalTracks(0);
    setDryRun(false);
    setResults([]);
    setSummary(null);
    setConnected(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    terminalReachedRef.current = false;
    setStatus('running');
    setPlaylistName(null);
    setTotalTracks(0);
    setResults([]);
    setSummary(null);
    setError(null);

    const source = new EventSource(`/api/migrations/${encodeURIComponent(jobId)}/events`, {
      withCredentials: true,
    });

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as MigrationProgressEvent;

        if (parsed.type === 'started') {
          setStatus('running');
          setPlaylistName(parsed.playlistName);
          setTotalTracks(parsed.totalTracks);
          setDryRun(parsed.dryRun);
        } else if (parsed.type === 'track_processed') {
          setResults((prev) => [...prev, parsed.result]);
        } else if (parsed.type === 'completed') {
          terminalReachedRef.current = true;
          setStatus('completed');
          setSummary(parsed.summary);
          setConnected(false);
          source.close();
        } else if (parsed.type === 'error') {
          terminalReachedRef.current = true;
          setStatus('failed');
          setError(parsed.message);
          setConnected(false);
          source.close();
        }
      } catch {
        setError('Erro ao interpretar evento de progresso da migração.');
      }
    };

    source.onerror = () => {
      setConnected(false);
      if (!terminalReachedRef.current) {
        setError('Conexão SSE interrompida antes da conclusão do job.');
      }
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [jobId]);

  return {
    status,
    playlistName,
    totalTracks,
    dryRun,
    results,
    summary,
    connected,
    error,
    reset,
  };
}
