import type { Playlist, PlaylistSummary, ProviderType, Track } from '@syncsound/shared';

export interface ProviderCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  isPublic?: boolean;
}

export interface CreatedPlaylistResult {
  id: string;
  url?: string;
}

export interface IMusicProvider {
  readonly platform: ProviderType;

  listUserPlaylists(credentials: ProviderCredentials): Promise<PlaylistSummary[]>;

  getPlaylistWithTracks(
    playlistId: string,
    credentials?: ProviderCredentials,
  ): Promise<Playlist>;

  searchByIsrc(
    isrc: string,
    credentials?: ProviderCredentials,
  ): Promise<Track | null>;

  searchTracks(
    query: string,
    limit?: number,
    credentials?: ProviderCredentials,
  ): Promise<Track[]>;

  createPlaylist(
    input: CreatePlaylistInput,
    credentials: ProviderCredentials,
  ): Promise<CreatedPlaylistResult>;

  addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
    credentials: ProviderCredentials,
  ): Promise<void>;
}
