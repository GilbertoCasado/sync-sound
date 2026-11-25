import { useEffect, useState } from 'react';
import type { MigrationProgressEvent } from '@syncsound/shared';

export interface MigrationStreamState {
  events: MigrationProgressEvent[];
  connected: boolean;
  error: string | null;
}

/**
 * Consome o stream SSE da etapa 2 (`GET /api/migrations/:jobId/events`).
 * A criação do job acontece separadamente via `POST /api/migrations` para evitar duplicações em reconexões.
 */
export function useMigrationStream(jobId: string | null): MigrationStreamState {
  const [events, setEvents] = useState<MigrationProgressEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      return;
    }

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
        setEvents((prev) => [...prev, parsed]);
        if (parsed.type === 'completed' || parsed.type === 'error') {
          source.close();
          setConnected(false);
        }
      } catch {
        setError('Erro ao interpretar evento de progresso da migração.');
      }
    };

    source.onerror = () => {
      setConnected(false);
      setError('Conexão SSE interrompida.');
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [jobId]);

  return { events, connected, error };
}
