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

const DEEZER_API_BASE = 'https://api.deezer.com';

interface DeezerApiError {
  type?: string;
  message?: string;
  code?: number;
}

interface DeezerTrackRaw {
  id: number | string;
  title: string;
  duration?: number;
  isrc?: string;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover?: string };
  error?: DeezerApiError;
}

interface DeezerPlaylistRaw {
  id: number | string;
  title: string;
  description?: string;
  nb_tracks?: number;
  public?: boolean;
  picture_medium?: string;
  picture?: string;
  creator?: { name?: string };
  tracks?: {
    data?: DeezerTrackRaw[];
    next?: string;
  };
  error?: DeezerApiError;
}

interface DeezerPagedResponse<T> {
  data?: T[];
  next?: string;
  error?: DeezerApiError;
}

export class DeezerAdapter implements IMusicProvider {
  readonly platform = 'deezer' as const;
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly fetchFn: FetchLike = fetch,
    minIntervalMs = 120,
  ) {
    this.rateLimiter = new RateLimiter(minIntervalMs);
  }

  async listUserPlaylists(credentials: ProviderCredentials): Promise<PlaylistSummary[]> {
    const summaries: PlaylistSummary[] = [];
    let nextUrl: string | undefined = this.withAccessToken(
      `${DEEZER_API_BASE}/user/me/playlists?limit=100`,
      credentials.accessToken,
    );

    while (nextUrl) {
      const page: DeezerPagedResponse<DeezerPlaylistRaw> = await this.requestJson<
        DeezerPagedResponse<DeezerPlaylistRaw>
      >(nextUrl);
      for (const item of page.data ?? []) {
        summaries.push({
          id: String(item.id),
          platform: 'deezer',
          name: item.title,
          description: item.description,
          trackCount: item.nb_tracks ?? 0,
          coverUrl: item.picture_medium ?? item.picture,
          ownerName: item.creator?.name,
          isPublic: item.public,
        });
      }
      nextUrl = page.next ? this.withAccessToken(page.next, credentials.accessToken) : undefined;
    }

    return summaries;
  }

  async getPlaylistWithTracks(
    rawPlaylistId: string,
    credentials?: ProviderCredentials,
  ): Promise<Playlist> {
    const playlistId = parsePlaylistId('deezer', rawPlaylistId);
    const playlistUrl = this.withOptionalToken(
      `${DEEZER_API_BASE}/playlist/${encodeURIComponent(playlistId)}`,
      credentials?.accessToken,
    );
    const playlistRaw = await this.requestJson<DeezerPlaylistRaw>(playlistUrl);

    const tracks: Track[] = [];
    for (const rawTrack of playlistRaw.tracks?.data ?? []) {
      tracks.push(this.mapTrack(rawTrack));
    }

    let nextTracksUrl = playlistRaw.tracks?.next
      ? this.withOptionalToken(playlistRaw.tracks.next, credentials?.accessToken)
      : undefined;

    while (nextTracksUrl) {
      const page: DeezerPagedResponse<DeezerTrackRaw> = await this.requestJson<
        DeezerPagedResponse<DeezerTrackRaw>
      >(nextTracksUrl);
      for (const rawTrack of page.data ?? []) {
        tracks.push(this.mapTrack(rawTrack));
      }
      nextTracksUrl = page.next
        ? this.withOptionalToken(page.next, credentials?.accessToken)
        : undefined;
    }

    return {
      id: String(playlistRaw.id),
      platform: 'deezer',
      name: playlistRaw.title,
      description: playlistRaw.description,
      trackCount: playlistRaw.nb_tracks ?? tracks.length,
      coverUrl: playlistRaw.picture_medium ?? playlistRaw.picture,
      ownerName: playlistRaw.creator?.name,
      isPublic: playlistRaw.public,
      tracks,
    };
  }

  async searchByIsrc(
    isrc: string,
    credentials?: ProviderCredentials,
  ): Promise<Track | null> {
    const normalized = normalizeIsrc(isrc);
    if (!normalized) {
      return null;
    }

    const url = this.withOptionalToken(
      `${DEEZER_API_BASE}/track/isrc:${encodeURIComponent(normalized)}`,
      credentials?.accessToken,
    );

    const data = await fetchJsonWithRetry<DeezerTrackRaw>(
      url,
      {},
      { fetchFn: this.fetchFn, rateLimiter: this.rateLimiter },
    );

    if (data.error) {
      // Código 800 = "no data" no Deezer
      if (data.error.code === 800) {
        return null;
      }
      throw new Error(`Erro da API Deezer (${data.error.code ?? 'desconhecido'}): ${data.error.message}`);
    }

    return this.mapTrack(data);
  }

  async searchTracks(
    query: string,
    limit = 10,
    credentials?: ProviderCredentials,
  ): Promise<Track[]> {
    const url = this.withOptionalToken(
      `${DEEZER_API_BASE}/search/track?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 50)}`,
      credentials?.accessToken,
    );
    const response = await this.requestJson<DeezerPagedResponse<DeezerTrackRaw>>(url);
    return (response.data ?? []).map((item) => this.mapTrack(item));
  }

  async createPlaylist(
    input: CreatePlaylistInput,
    credentials: ProviderCredentials,
  ): Promise<CreatedPlaylistResult> {
    const params = new URLSearchParams({
      access_token: credentials.accessToken,
      title: input.name,
    });
    const url = `${DEEZER_API_BASE}/user/me/playlists?${params.toString()}`;
    const created = await this.requestJson<{ id: number | string; error?: DeezerApiError }>(url, {
      method: 'POST',
    });

    const id = String(created.id);
    return {
      id,
      url: `https://www.deezer.com/playlist/${id}`,
    };
  }

  async addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
    credentials: ProviderCredentials,
  ): Promise<void> {
    for (const batch of chunkArray(trackIds, 50)) {
      const params = new URLSearchParams({
        access_token: credentials.accessToken,
        songs: batch.join(','),
      });
      const url = `${DEEZER_API_BASE}/playlist/${encodeURIComponent(playlistId)}/tracks?${params.toString()}`;
      await this.requestJson<unknown>(url, { method: 'POST' });
    }
  }

  private async requestJson<T extends { error?: DeezerApiError } | unknown>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    const payload = await fetchJsonWithRetry<T>(url, init, {
      fetchFn: this.fetchFn,
      rateLimiter: this.rateLimiter,
    });
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object'
    ) {
      const err = payload.error as DeezerApiError;
      throw new Error(`Erro da API Deezer (${err.code ?? 'desconhecido'}): ${err.message ?? 'Falha na requisição'}`);
    }
    return payload;
  }

  private mapTrack(raw: DeezerTrackRaw): Track {
    return {
      id: String(raw.id),
      platform: 'deezer',
      title: raw.title,
      artists: raw.artist?.name ? [raw.artist.name] : ['Artista Desconhecido'],
      album: raw.album?.title,
      durationMs: (raw.duration ?? 0) * 1000,
      isrc: raw.isrc,
      externalUrl: raw.link,
      coverUrl: raw.album?.cover_medium ?? raw.album?.cover,
    };
  }

  private withAccessToken(rawUrl: string, token: string): string {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('access_token', token);
    return parsed.toString();
  }

  private withOptionalToken(rawUrl: string, token?: string): string {
    return token ? this.withAccessToken(rawUrl, token) : rawUrl;
  }
}
