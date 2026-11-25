import type { ProviderType } from '@syncsound/shared';
import type { IMusicProvider } from '../../core/ports/music-provider.port.js';

export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, IMusicProvider>();

  register(provider: IMusicProvider): this {
    this.providers.set(provider.platform, provider);
    return this;
  }

  get(platform: ProviderType): IMusicProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`Provider "${platform}" is not registered.`);
    }
    return provider;
  }

  listRegistered(): ProviderType[] {
    return Array.from(this.providers.keys());
  }
}
