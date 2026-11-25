import type { ProviderType } from '@syncsound/shared';
import type { ProviderCredentials } from './music-provider.port.js';

export interface UserSession {
  id: string;
  createdAt: number;
  providers: Partial<Record<ProviderType, ProviderCredentials>>;
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
}
