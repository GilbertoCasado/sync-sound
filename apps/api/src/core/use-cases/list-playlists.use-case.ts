import type { PlaylistSummary, ProviderType } from '@syncsound/shared';
import type { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import type { ProviderCredentials } from '../ports/music-provider.port.js';

export class ListPlaylistsUseCase {
  constructor(private readonly providerRegistry: ProviderRegistry) {}

  async execute(
    platform: ProviderType,
    credentials: ProviderCredentials,
  ): Promise<PlaylistSummary[]> {
    const provider = this.providerRegistry.get(platform);
    return provider.listUserPlaylists(credentials);
  }
}
