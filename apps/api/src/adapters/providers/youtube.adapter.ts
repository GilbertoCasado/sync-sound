import type { Playlist, PlaylistSummary, Track } from '@syncsound/shared';
import type {
  CreatedPlaylistResult,
  CreatePlaylistInput,
  IMusicProvider,
  ProviderCredentials,
} from '../../core/ports/music-provider.port.js';
import {
  chunkArray,
  fetchJsonWithRetry,
  parseIso8601DurationMs,
  parsePlaylistId,
  RateLimiter,
  type FetchLike,
} from './http-client.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

interface YouTubePlaylistRaw {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
  contentDetails?: { itemCount?: number };
  status?: { privacyStatus?: string };
}

interface YouTubePlaylistItemRaw {
  snippet?: {
    title?: string;
    videoOwnerChannelTitle?: string;
    channelTitle?: string;
    resourceId?: { videoId?: string };
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
  contentDetails?: { videoId?: string };
}

interface YouTubeVideoRaw {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
  contentDetails?: {
    duration?: string;
  };
}

interface YouTubeSearchItemRaw {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
}

export class YouTubeAdapter implements IMusicProvider {
  readonly platform = 'youtube' as const;
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly fetchFn: FetchLike = fetch,
    minIntervalMs = 50,
  ) {
    this.rateLimiter = new RateLimiter(minIntervalMs);
  }

  async listUserPlaylists(credentials: ProviderCredentials): Promise<PlaylistSummary[]> {
    const playlists: PlaylistSummary[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        part: 'snippet,contentDetails,status',
        mine: 'true',
        maxResults: '50',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const response = await this.request<{
        items?: YouTubePlaylistRaw[];
        nextPageToken?: string;
      }>(`${YOUTUBE_API_BASE}/playlists?${params.toString()}`, credentials.accessToken);

      for (const item of response.items ?? []) {
        playlists.push({
          id: item.id,
          platform: 'youtube',
          name: item.snippet?.title ?? 'Playlist sem título',
          description: item.snippet?.description,
          trackCount: item.contentDetails?.itemCount ?? 0,
          coverUrl:
            item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url,
          ownerName: item.snippet?.channelTitle,
          isPublic: item.status?.privacyStatus === 'public',
        });
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    return playlists;
  }

  async getPlaylistWithTracks(
    rawPlaylistId: string,
    credentials?: ProviderCredentials,
  ): Promise<Playlist> {
    const token = this.requireToken(credentials);
    const playlistId = parsePlaylistId('youtube', rawPlaylistId);

    const playlistMetaResponse = await this.request<{ items?: YouTubePlaylistRaw[] }>(
      `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails,status&id=${encodeURIComponent(playlistId)}`,
      token,
    );
    const playlistMeta = playlistMetaResponse.items?.[0];
    if (!playlistMeta) {
      throw new Error(`Playlist do YouTube não encontrada: ${playlistId}`);
    }

    const rawItems: YouTubePlaylistItemRaw[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: '50',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const response = await this.request<{
        items?: YouTubePlaylistItemRaw[];
        nextPageToken?: string;
      }>(`${YOUTUBE_API_BASE}/playlistItems?${params.toString()}`, token);

      rawItems.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    const videoIds = rawItems
      .map((item) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
      .filter((id): id is string => Boolean(id));

    const durationsByVideoId = await this.fetchVideoDurations(videoIds, token);

    const tracks: Track[] = [];
    for (const item of rawItems) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title;
      if (!videoId || !title || title === 'Deleted video' || title === 'Private video') {
        continue;
      }

      const channel =
        item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? 'YouTube';
      tracks.push({
        id: videoId,
        platform: 'youtube',
        title,
        artists: [channel],
        durationMs: durationsByVideoId.get(videoId) ?? 0,
        externalUrl: `https://music.youtube.com/watch?v=${videoId}`,
        coverUrl: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url,
      });
    }

    return {
      id: playlistMeta.id,
      platform: 'youtube',
      name: playlistMeta.snippet?.title ?? 'Playlist YouTube',
      description: playlistMeta.snippet?.description,
      trackCount: playlistMeta.contentDetails?.itemCount ?? tracks.length,
      coverUrl:
        playlistMeta.snippet?.thumbnails?.medium?.url ??
        playlistMeta.snippet?.thumbnails?.default?.url,
      ownerName: playlistMeta.snippet?.channelTitle,
      isPublic: playlistMeta.status?.privacyStatus === 'public',
      tracks,
    };
  }

  async searchByIsrc(
    _isrc: string,
    _credentials?: ProviderCredentials,
  ): Promise<Track | null> {
    // YouTube Data API v3 não suporta busca confiável por ISRC sem gastar cota de 100 unidades/busca.
    return null;
  }

  async searchTracks(
    query: string,
    limit = 10,
    credentials?: ProviderCredentials,
  ): Promise<Track[]> {
    const token = this.requireToken(credentials);
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      maxResults: String(Math.min(limit, 25)),
      q: query,
    });

    const response = await this.request<{ items?: YouTubeSearchItemRaw[] }>(
      `${YOUTUBE_API_BASE}/search?${params.toString()}`,
      token,
    );

    const items = (response.items ?? []).filter((item) => Boolean(item.id?.videoId));
    const videoIds = items.map((item) => item.id!.videoId!);
    const durationsByVideoId = await this.fetchVideoDurations(videoIds, token);

    return items.map((item) => {
      const videoId = item.id!.videoId!;
      return {
        id: videoId,
        platform: 'youtube',
        title: item.snippet?.title ?? '',
        artists: [item.snippet?.channelTitle ?? 'YouTube'],
        durationMs: durationsByVideoId.get(videoId) ?? 0,
        externalUrl: `https://music.youtube.com/watch?v=${videoId}`,
        coverUrl:
          item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url,
      };
    });
  }

  async createPlaylist(
    input: CreatePlaylistInput,
    credentials: ProviderCredentials,
  ): Promise<CreatedPlaylistResult> {
    const created = await this.request<{ id: string }>(
      `${YOUTUBE_API_BASE}/playlists?part=snippet,status`,
      credentials.accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: {
            title: input.name,
            description: input.description ?? 'Migrada com SyncSound',
          },
          status: {
            privacyStatus: input.isPublic ? 'public' : 'private',
          },
        }),
      },
    );

    return {
      id: created.id,
      url: `https://music.youtube.com/playlist?list=${created.id}`,
    };
  }

  async addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
    credentials: ProviderCredentials,
  ): Promise<void> {
    for (const videoId of trackIds) {
      await this.request<unknown>(
        `${YOUTUBE_API_BASE}/playlistItems?part=snippet`,
        credentials.accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            snippet: {
              playlistId,
              resourceId: {
                kind: 'youtube#video',
                videoId,
              },
            },
          }),
        },
      );
    }
  }

  private async fetchVideoDurations(
    videoIds: string[],
    accessToken: string,
  ): Promise<Map<string, number>> {
    const durations = new Map<string, number>();
    if (videoIds.length === 0) {
      return durations;
    }

    for (const batch of chunkArray(videoIds, 50)) {
      const params = new URLSearchParams({
        part: 'contentDetails,snippet',
        id: batch.join(','),
      });
      const response = await this.request<{ items?: YouTubeVideoRaw[] }>(
        `${YOUTUBE_API_BASE}/videos?${params.toString()}`,
        accessToken,
      );

      for (const video of response.items ?? []) {
        const iso = video.contentDetails?.duration;
        durations.set(video.id, iso ? parseIso8601DurationMs(iso) : 0);
      }
    }

    return durations;
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
      throw new Error('Autenticação Google/YouTube necessária para esta operação.');
    }
    return credentials.accessToken;
  }
}
