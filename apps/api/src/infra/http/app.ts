import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { FileOAuthConfigStore } from '../../adapters/auth/oauth-config.store.js';
import { OAuthService } from '../../adapters/auth/oauth.service.js';
import { InMemoryMappingCacheRepository } from '../../adapters/cache/in-memory-mapping-cache.repository.js';
import { DeezerAdapter } from '../../adapters/providers/deezer.adapter.js';
import { ProviderRegistry } from '../../adapters/providers/provider-registry.js';
import { SpotifyAdapter } from '../../adapters/providers/spotify.adapter.js';
import { YouTubeAdapter } from '../../adapters/providers/youtube.adapter.js';
import { InMemorySessionStore } from '../../adapters/session/in-memory-session.store.js';
import type { IMappingCacheRepository } from '../../core/ports/mapping-cache.port.js';
import type { ISessionStore } from '../../core/ports/session-store.port.js';
import { MatchingEngine } from '../../core/services/matching-engine.service.js';
import { MetadataCleaner } from '../../core/services/metadata-cleaner.service.js';
import { MigrationJobManager } from '../../core/services/migration-job-manager.service.js';
import { GetPlaylistUseCase } from '../../core/use-cases/get-playlist.use-case.js';
import { ListPlaylistsUseCase } from '../../core/use-cases/list-playlists.use-case.js';
import { MigratePlaylistUseCase } from '../../core/use-cases/migrate-playlist.use-case.js';
import { loadEnv, type AppEnv } from '../config/env.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerMigrationRoutes } from './routes/migrations.routes.js';
import { registerPlaylistRoutes } from './routes/playlists.routes.js';

export interface AppDependencies {
  env?: AppEnv;
  cacheRepository?: IMappingCacheRepository;
  sessionStore?: ISessionStore;
  providerRegistry?: ProviderRegistry;
  oauthConfigStore?: FileOAuthConfigStore;
  oauthService?: OAuthService;
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(new SpotifyAdapter())
    .register(new DeezerAdapter())
    .register(new YouTubeAdapter());
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const env = deps.env ?? loadEnv();
  const cacheRepository = deps.cacheRepository ?? new InMemoryMappingCacheRepository();
  const sessionStore = deps.sessionStore ?? new InMemorySessionStore();
  const providerRegistry = deps.providerRegistry ?? createDefaultProviderRegistry();
  const oauthConfigStore = deps.oauthConfigStore ?? new FileOAuthConfigStore(env, env.OAUTH_CONFIG_FILE);
  const oauthService = deps.oauthService ?? new OAuthService(oauthConfigStore);

  const metadataCleaner = new MetadataCleaner();
  const matchingEngine = new MatchingEngine(cacheRepository, metadataCleaner);
  const listPlaylistsUseCase = new ListPlaylistsUseCase(providerRegistry);
  const getPlaylistUseCase = new GetPlaylistUseCase(providerRegistry);
  const migratePlaylistUseCase = new MigratePlaylistUseCase(providerRegistry, matchingEngine);
  const migrationJobManager = new MigrationJobManager(migratePlaylistUseCase);

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

  app.decorate('syncsound', {
    env,
    cacheRepository,
    sessionStore,
    providerRegistry,
    oauthService,
    listPlaylistsUseCase,
    getPlaylistUseCase,
    migratePlaylistUseCase,
    migrationJobManager,
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

  await registerAuthRoutes(app);
  await registerPlaylistRoutes(app);
  await registerMigrationRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    syncsound: {
      env: AppEnv;
      cacheRepository: IMappingCacheRepository;
      sessionStore: ISessionStore;
      providerRegistry: ProviderRegistry;
      oauthService: OAuthService;
      listPlaylistsUseCase: ListPlaylistsUseCase;
      getPlaylistUseCase: GetPlaylistUseCase;
      migratePlaylistUseCase: MigratePlaylistUseCase;
      migrationJobManager: MigrationJobManager;
    };
  }
}
