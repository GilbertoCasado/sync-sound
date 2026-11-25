import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { InMemoryMappingCacheRepository } from '../../adapters/cache/in-memory-mapping-cache.repository.js';
import { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import { InMemorySessionStore } from '../../adapters/session/in-memory-session.store.js';
import type { IMappingCacheRepository } from '../../core/ports/mapping-cache.port.js';
import type { ISessionStore } from '../../core/ports/session-store.port.js';
import { loadEnv, type AppEnv } from '../config/env.js';

export interface AppDependencies {
  env?: AppEnv;
  cacheRepository?: IMappingCacheRepository;
  sessionStore?: ISessionStore;
  providerRegistry?: ProviderRegistry;
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const env = deps.env ?? loadEnv();
  const cacheRepository = deps.cacheRepository ?? new InMemoryMappingCacheRepository();
  const sessionStore = deps.sessionStore ?? new InMemorySessionStore();
  const providerRegistry = deps.providerRegistry ?? new ProviderRegistry();

  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
  });

  app.get('/api/health', async () => {
    return {
      status: 'ok',
      service: 'syncsound-api',
      mode: env.DATABASE_URL ? 'postgres' : 'stateless-in-memory',
      registeredProviders: providerRegistry.listRegistered(),
      timestamp: new Date().toISOString(),
    };
  });

  // Reference dependencies so composition root is explicit for upcoming routes
  app.decorate('syncsound', {
    env,
    cacheRepository,
    sessionStore,
    providerRegistry,
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    syncsound: {
      env: AppEnv;
      cacheRepository: IMappingCacheRepository;
      sessionStore: ISessionStore;
      providerRegistry: ProviderRegistry;
    };
  }
}
