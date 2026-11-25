import { randomUUID } from 'node:crypto';
import type { ProviderType } from '@syncsound/shared';
import type { ProviderCredentials } from '../../core/ports/music-provider.port.js';
import type { ISessionStore, UserSession } from '../../core/ports/session-store.port.js';

export class InMemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, UserSession>();

  async get(sessionId: string): Promise<UserSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async create(): Promise<UserSession> {
    const session: UserSession = {
      id: randomUUID(),
      createdAt: Date.now(),
      providers: {},
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
}
