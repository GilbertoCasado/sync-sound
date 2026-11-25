import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ISessionStore, UserSession } from '../../core/ports/session-store.port.js';
import type { AppEnv } from '../config/env.js';

export const SESSION_COOKIE_NAME = 'syncsound_sid';

export async function getOrCreateSession(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionStore: ISessionStore,
  env: AppEnv,
): Promise<UserSession> {
  const rawCookie = request.cookies[SESSION_COOKIE_NAME];
  if (rawCookie) {
    const unsigned = request.unsignCookie(rawCookie);
    if (unsigned.valid && unsigned.value) {
      const existing = await sessionStore.get(unsigned.value);
      if (existing) {
        return existing;
      }
    }
  }

  const created = await sessionStore.create();
  reply.setCookie(SESSION_COOKIE_NAME, created.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure: env.NODE_ENV === 'production',
  });

  return created;
}
