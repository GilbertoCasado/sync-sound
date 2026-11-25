import type {
  MigrationJobSnapshot,
  Playlist,
  PlaylistSummary,
  ProviderAuthStatus,
  ProviderType,
  StartMigrationRequest,
  StartMigrationResponse,
} from '@syncsound/shared';

export interface HealthResponse {
  status: string;
  service: string;
  mode: 'stateless-in-memory' | 'postgres';
  registeredProviders: ProviderType[];
  timestamp: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? `Requisição falhou com status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchApiHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health');
}

export async function fetchAuthStatus(): Promise<ProviderAuthStatus[]> {
  const data = await requestJson<{ providers: ProviderAuthStatus[] }>('/api/auth/status');
  return data.providers;
}

export async function disconnectProvider(provider: ProviderType): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/auth/${provider}/disconnect`, {
    method: 'POST',
  });
}

export async function fetchUserPlaylists(provider: ProviderType): Promise<PlaylistSummary[]> {
  const data = await requestJson<{ playlists: PlaylistSummary[] }>(
    `/api/providers/${provider}/playlists`,
  );
  return data.playlists;
}

export async function fetchPlaylistDetails(
  provider: ProviderType,
  playlistId: string,
): Promise<Playlist> {
  const data = await requestJson<{ playlist: Playlist }>(
    `/api/providers/${provider}/playlists/${encodeURIComponent(playlistId)}`,
  );
  return data.playlist;
}

export async function startMigration(
  payload: StartMigrationRequest,
): Promise<StartMigrationResponse> {
  return requestJson<StartMigrationResponse>('/api/migrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchMigrationJob(jobId: string): Promise<MigrationJobSnapshot> {
  return requestJson<MigrationJobSnapshot>(`/api/migrations/${encodeURIComponent(jobId)}`);
}
