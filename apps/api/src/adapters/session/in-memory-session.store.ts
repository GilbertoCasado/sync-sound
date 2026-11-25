import { randomUUID } from 'node:crypto';
import type { ProviderType } from '@syncsound/shared';
import type { ProviderCredentials } from '../../core/ports/music-provider.port.js';
import type {
  ISessionStore,
  OAuthFlowMode,
  OAuthStateRecord,
  UserSession,
} from '../../core/ports/session-store.port.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class InMemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, UserSession>();
  private readonly oauthStateTokens = new Map<string, OAuthStateRecord>();

  async get(sessionId: string): Promise<UserSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async create(): Promise<UserSession> {
    const session: UserSession = {
      id: randomUUID(),
      createdAt: Date.now(),
      providers: {},
      oauthStates: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async setProviderCredentials(
    sessionId: string,
    provider: ProviderType,
    credentials: ProviderCredentials,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.providers[provider] = credentials;
  }

  async removeProviderCredentials(sessionId: string, provider: ProviderType): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    delete session.providers[provider];
  }

  async setOAuthState(sessionId: string, provider: ProviderType, state: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.oauthStates[provider] = state;
  }

  async consumeOAuthState(
    sessionId: string,
    provider: ProviderType,
    state: string,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    const expected = session.oauthStates[provider];
    delete session.oauthStates[provider];
    return Boolean(expected && expected === state);
  }

  async createOAuthState(
    sessionId: string,
    provider: ProviderType,
    mode: OAuthFlowMode,
  ): Promise<string> {
    const state = randomUUID();
    this.oauthStateTokens.set(state, {
      sessionId,
      provider,
      mode,
      createdAt: Date.now(),
    });
    return state;
  }

  async consumeOAuthStateByToken(
    state: string,
    provider: ProviderType,
  ): Promise<OAuthStateRecord | null> {
    const record = this.oauthStateTokens.get(state);
    this.oauthStateTokens.delete(state);
    if (!record) {
      return null;
    }
    if (record.provider !== provider) {
      return null;
    }
    if (Date.now() - record.createdAt > OAUTH_STATE_TTL_MS) {
      return null;
    }
    return record;
  }
}
