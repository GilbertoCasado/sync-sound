import type { Playlist, ProviderType } from '@syncsound/shared';
import type { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import type { ProviderCredentials } from '../ports/music-provider.port.js';

export class GetPlaylistUseCase {
  constructor(private readonly providerRegistry: ProviderRegistry) {}

  async execute(
    platform: ProviderType,
    playlistId: string,
    credentials?: ProviderCredentials,
  ): Promise<Playlist> {
    const provider = this.providerRegistry.get(platform);
    return provider.getPlaylistWithTracks(playlistId, credentials);
  }
}
