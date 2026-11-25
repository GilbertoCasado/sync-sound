export type ProviderType = 'spotify' | 'deezer' | 'youtube';

export type OAuthConfigSource = 'env' | 'local-file' | 'none';

export interface ProviderAuthStatus {
  provider: ProviderType;
  connected: boolean;
  configured: boolean;
  configSource?: OAuthConfigSource;
  clientIdPreview?: string;
  redirectUri: string;
  hasSecret: boolean;
  supportsPublicRead: boolean;
  displayName?: string;
  expiresAt?: string;
}

export interface SaveProviderOAuthConfigRequest {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}
