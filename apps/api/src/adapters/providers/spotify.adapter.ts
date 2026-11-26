import type { Playlist, PlaylistSummary, Track } from '@syncsound/shared';
import { normalizeIsrc } from '../../core/domain/mapping.js';
import type {
  CreatedPlaylistResult,
  CreatePlaylistInput,
  IMusicProvider,
  ProviderCredentials,
} from '../../core/ports/music-provider.port.js';
import {
  chunkArray,
  fetchJsonWithRetry,
  parsePlaylistId,
  RateLimiter,
  type FetchLike,
} from './http-client.js';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

interface SpotifyImage {
  url: string;
}

interface SpotifyTrackRaw {
  id: string;
  type?: string;
  name: string;
  duration_ms: number;
  artists?: Array<{ name: string }>;
  album?: { name?: string; images?: SpotifyImage[] };
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
}

interface SpotifyPlaylistTrackEntryRaw {
  item?: SpotifyTrackRaw | null;
  track?: SpotifyTrackRaw | null;
}

interface SpotifyPlaylistItemsContainerRaw {
  href?: string;
  total?: number;
  items?: SpotifyPlaylistTrackEntryRaw[];
  next?: string | null;
}

interface SpotifyPlaylistItemRaw {
  id: string;
  name: string;
  description?: string;
  public?: boolean;
  images?: SpotifyImage[];
  owner?: { display_name?: string; id?: string };
  // Spotify Web API (Fev/2026) renomeou `tracks` -> `items`; mantemos ambos por compatibilidade.
  items?: SpotifyPlaylistItemsContainerRaw;
  tracks?: SpotifyPlaylistItemsContainerRaw;
}

export class SpotifyAdapter implements IMusicProvider {
  readonly platform = 'spotify' as const;
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly fetchFn: FetchLike = fetch,
    minIntervalMs = 50,
  ) {
    this.rateLimiter = new RateLimiter(minIntervalMs);
  }

  async listUserPlaylists(credentials: ProviderCredentials): Promise<PlaylistSummary[]> {
    const playlists: PlaylistSummary[] = [];
    let nextUrl: string | null = `${SPOTIFY_API_BASE}/me/playlists?limit=50`;

    while (nextUrl) {
      const page: { items: SpotifyPlaylistItemRaw[]; next: string | null } =
        await this.request<{ items: SpotifyPlaylistItemRaw[]; next: string | null }>(
          nextUrl,
          credentials.accessToken,
        );
      for (const item of page.items) {
        const container = item.items ?? item.tracks;
        playlists.push({
          id: item.id,
          platform: 'spotify',
          name: item.name,
          description: item.description,
          trackCount: container?.total ?? 0,
          coverUrl: item.images?.[0]?.url,
          ownerName: item.owner?.display_name ?? item.owner?.id,
          isPublic: item.public,
        });
      }
      nextUrl = page.next;
    }

    return playlists;
  }

  async getPlaylistWithTracks(
    rawPlaylistId: string,
    credentials?: ProviderCredentials,
  ): Promise<Playlist> {
    const token = this.requireToken(credentials);
    const playlistId = parsePlaylistId('spotify', rawPlaylistId);
    const playlistRaw = await this.request<SpotifyPlaylistItemRaw>(
      `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}`,
      token,
    );

    const container = playlistRaw.items ?? playlistRaw.tracks;
    if (!container) {
      throw new Error(
        'O Spotify não retornou as faixas desta playlist. Desde a atualização da API do Spotify (2026), somente playlists criadas por você ou colaborativas têm as faixas liberadas para leitura.',
      );
    }

    const tracks: Track[] = [];
    let nextUrl: string | null = null;

    if (Array.isArray(container.items)) {
      this.appendEntries(tracks, container.items);
      nextUrl = container.next ?? null;
    } else if (container.href || (container.total ?? 0) > 0) {
      nextUrl =
        container.href ??
        `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}/items?limit=100`;
    }

    while (nextUrl) {
      const page: { items?: SpotifyPlaylistTrackEntryRaw[]; next?: string | null } =
        await this.request<{
          items?: SpotifyPlaylistTrackEntryRaw[];
          next?: string | null;
        }>(nextUrl, token);
      this.appendEntries(tracks, page.items ?? []);
      nextUrl = page.next ?? null;
    }

    return {
      id: playlistRaw.id,
      platform: 'spotify',
      name: playlistRaw.name,
      description: playlistRaw.description,
      trackCount: container.total ?? tracks.length,
      coverUrl: playlistRaw.images?.[0]?.url,
      ownerName: playlistRaw.owner?.display_name ?? playlistRaw.owner?.id,
      isPublic: playlistRaw.public,
      tracks,
    };
  }

  async searchByIsrc(
    isrc: string,
    credentials?: ProviderCredentials,
  ): Promise<Track | null> {
    const token = this.requireToken(credentials);
    const normalized = normalizeIsrc(isrc);
    if (!normalized) {
      return null;
    }

    const url = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(`isrc:${normalized}`)}&type=track&limit=1`;
    const response = await this.request<{ tracks?: { items?: SpotifyTrackRaw[] } }>(url, token);
    const hit = response.tracks?.items?.[0];
    return hit ? this.mapTrack(hit) : null;
  }

  async searchTracks(
    query: string,
    limit = 10,
    credentials?: ProviderCredentials,
  ): Promise<Track[]> {
    const token = this.requireToken(credentials);
    // A partir de Fev/2026 o limite máximo do endpoint /search em Development Mode é 10.
    const clampedLimit = Math.min(Math.max(limit, 1), 10);
    const url = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=track&limit=${clampedLimit}`;
    const response = await this.request<{ tracks?: { items?: SpotifyTrackRaw[] } }>(url, token);
    return (response.tracks?.items ?? []).map((item) => this.mapTrack(item));
  }

  async createPlaylist(
    input: CreatePlaylistInput,
    credentials: ProviderCredentials,
  ): Promise<CreatedPlaylistResult> {
    const created = await this.request<{ id: string; external_urls?: { spotify?: string } }>(
      `${SPOTIFY_API_BASE}/me/playlists`,
      credentials.accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          description: input.description ?? 'Migrada com SyncSound',
          public: input.isPublic ?? false,
        }),
      },
    );

    return {
      id: created.id,
      url: created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${created.id}`,
    };
  }

  async addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
    credentials: ProviderCredentials,
  ): Promise<void> {
    for (const batch of chunkArray(trackIds, 100)) {
      const uris = batch.map((id) =>
        id.startsWith('spotify:track:') ? id : `spotify:track:${id}`,
      );
      await this.request<unknown>(
        `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}/items`,
        credentials.accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris }),
        },
      );
    }
  }

  private appendEntries(target: Track[], entries: SpotifyPlaylistTrackEntryRaw[]): void {
    for (const entry of entries) {
      const raw = entry.item ?? entry.track;
      if (!raw || !raw.id) {
        continue;
      }
      if (raw.type && raw.type !== 'track') {
        continue;
      }
      target.push(this.mapTrack(raw));
    }
  }

  private async request<T>(
    url: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetchJsonWithRetry<T>(
      url,
      { ...init, headers },
      { fetchFn: this.fetchFn, rateLimiter: this.rateLimiter },
    );
  }

  private requireToken(credentials?: ProviderCredentials): string {
    if (!credentials?.accessToken) {
      throw new Error('Autenticação Spotify necessária para esta operação.');
    }
    return credentials.accessToken;
  }

  private mapTrack(raw: SpotifyTrackRaw): Track {
    return {
      id: raw.id,
      platform: 'spotify',
      title: raw.name,
      artists: (raw.artists ?? []).map((artist) => artist.name),
      album: raw.album?.name,
      durationMs: raw.duration_ms,
      isrc: raw.external_ids?.isrc,
      externalUrl: raw.external_urls?.spotify,
      coverUrl: raw.album?.images?.[0]?.url,
    };
  }
}
