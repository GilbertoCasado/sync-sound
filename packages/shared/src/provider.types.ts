export type ProviderType = 'spotify' | 'deezer' | 'youtube';

export interface ProviderAuthStatus {
  provider: ProviderType;
  connected: boolean;
  displayName?: string;
  expiresAt?: string;
}
