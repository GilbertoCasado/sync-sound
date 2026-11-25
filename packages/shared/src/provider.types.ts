export type ProviderType = 'spotify' | 'deezer' | 'youtube';

export interface ProviderAuthStatus {
  provider: ProviderType;
  connected: boolean;
  configured: boolean;
  supportsPublicRead: boolean;
  displayName?: string;
  expiresAt?: string;
}
