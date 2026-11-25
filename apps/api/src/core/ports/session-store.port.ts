import type { ProviderType } from '@syncsound/shared';
import type { ProviderCredentials } from './music-provider.port.js';

export type OAuthFlowMode = 'popup' | 'redirect';

export interface OAuthStateRecord {
  sessionId: string;
  provider: ProviderType;
  mode: OAuthFlowMode;
  createdAt: number;
}

export interface UserSession {
  id: string;
  createdAt: number;
  providers: Partial<Record<ProviderType, ProviderCredentials>>;
  oauthStates: Partial<Record<ProviderType, string>>;
}

export interface ISessionStore {
  get(sessionId: string): Promise<UserSession | null>;
  create(): Promise<UserSession>;
  setProviderCredentials(
    sessionId: string,
    provider: ProviderType,
    credentials: ProviderCredentials,
  ): Promise<void>;
  removeProviderCredentials(sessionId: string, provider: ProviderType): Promise<void>;
  setOAuthState(sessionId: string, provider: ProviderType, state: string): Promise<void>;
  consumeOAuthState(sessionId: string, provider: ProviderType, state: string): Promise<boolean>;
  createOAuthState(
    sessionId: string,
    provider: ProviderType,
    mode: OAuthFlowMode,
  ): Promise<string>;
  consumeOAuthStateByToken(state: string, provider: ProviderType): Promise<OAuthStateRecord | null>;
}
