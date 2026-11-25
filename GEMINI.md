# SyncSound — Contexto do Projeto para Agentes

## Visão Geral
**SyncSound** é um migrador e sincronizador multi-streaming de playlists entre **Spotify**, **Deezer** e **YouTube Music**, construído como um monorepo Fullstack TypeScript usando **npm workspaces**.

A especificação completa do produto e do pipeline de matching está em `sync-sound-context.md`.

## Estrutura do Monorepo

```text
sync-sound/
├── packages/
│   └── shared/                          # @syncsound/shared (contratos e tipos compartilhados)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── provider.types.ts        # ProviderType, ProviderAuthStatus
│           ├── track.types.ts           # Track, TrackMetadata, MatchResult, MatchConfidence, MatchStrategy
│           ├── playlist.types.ts        # Playlist, PlaylistSummary
│           └── migration.types.ts       # StartMigration*, MigrationProgressEvent, MigrationSummary, MigrationJobSnapshot
├── apps/
│   ├── api/                             # @syncsound/api (Node.js + Fastify + TypeScript + Vitest)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── types/
│   │       │   └── fast-levenshtein.d.ts
│   │       ├── core/
│   │       │   ├── domain/              # mapping.ts (chaves compostas de cache com targetPlatform)
│   │       │   ├── ports/               # IMusicProvider, IMappingCacheRepository, ISessionStore
│   │       │   ├── services/            # MetadataCleaner, MatchingEngine, MigrationJobManager (+ specs)
│   │       │   └── use-cases/           # ListPlaylistsUseCase, GetPlaylistUseCase, MigratePlaylistUseCase (+ specs)
│   │       ├── adapters/
│   │       │   ├── auth/                # OAuthService (Spotify, Deezer, Google/YouTube)
│   │       │   ├── cache/               # InMemoryMappingCacheRepository, PostgresMappingCacheRepository (+ specs)
│   │       │   ├── session/             # InMemorySessionStore (com tokens + CSRF OAuth states)
│   │       │   └── providers/           # ProviderRegistry, http-client (RateLimiter + retry), SpotifyAdapter, DeezerAdapter, YouTubeAdapter (+ specs)
│   │       ├── infra/
│   │       │   ├── config/env.ts        # Validação de env via Zod
│   │       │   ├── db/schema.sql        # DDL PostgreSQL/Supabase (track_mappings + migration_jobs)
│   │       │   └── http/
│   │       │       ├── app.ts           # Composition Root Fastify + CORS + Cookie + /api/health
│   │       │       ├── session.helper.ts
│   │       │       ├── migrations.routes.spec.ts
│   │       │       └── routes/          # auth.routes.ts, playlists.routes.ts, migrations.routes.ts
│   │       └── server.ts
│   └── web/                             # @syncsound/web (React + Vite + Tailwind CSS)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts               # Proxy /api e /auth -> http://localhost:3333
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       ├── index.html
│       └── src/
│           ├── components/              # ProviderCard.tsx, MigrationForm.tsx, MigrationProgressPanel.tsx
│           ├── hooks/                   # useMigrationStream.ts (SSE EventSource com replay seguro)
│           ├── services/                # api.ts
│           ├── App.tsx
│           ├── main.tsx
│           └── index.css                # Tailwind + estilos acessíveis para <progress>
├── package.json                         # Scripts raiz do monorepo
├── tsconfig.base.json                   # TypeScript strict compartilhado
├── .env.example
├── .gitignore
├── README.md
├── GEMINI.md
└── sync-sound-context.md
```

## Convenções e Decisões Arquiteturais
- **Arquitetura Hexagonal (Ports & Adapters):** `apps/api/src/core/` nunca importa Fastify, HTTP ou drivers de banco.
- **Chave composta de cache:** `IMappingCacheRepository` sempre inclui `targetPlatform` (`isrc:<target>:<isrc>` e `track:<source>:<id>:<target>`) para evitar colisões entre plataformas de destino.
- **SSE em 2 etapas:** `POST /api/migrations` cria o job (`jobId`, com suporte a `dryRun` e `includeLowConfidence`) e `GET /api/migrations/:jobId/events` abre o stream SSE com replay completo de eventos para evitar duplicação em reconexões automáticas do `EventSource`.
- **Sessão OAuth:** Tokens de provedores e `oauthStates` CSRF ficam no servidor (`ISessionStore`) associados a cookie assinado `HttpOnly` (`syncsound_sid`).
- **Matching:** Normalização Unicode (`NFD`), remoção de ruídos (`Remastered`, `Official Video/Audio`, `feat.`), preservação de marcadores de versão (`Live`, `Ao Vivo`, `Remix`, `Acoustic`, `Instrumental`), interpretação de títulos `"Artista - Música"`, Levenshtein ponderado (60% título / 40% artista principal) e tolerância de duração configurável por destino (±5s Spotify/Deezer, janela ampliada no YouTube).
- **Testes:** Vitest em `apps/api` (`*.spec.ts`) cobrindo domínio, casos de uso, adapters HTTP com mocks e rotas Fastify + SSE.

## Comandos Úteis
- `npm install` — instala dependências de todos os workspaces
- `npm run dev` — inicia API (`:3333`) e Web (`:5173`)
- `npm run build` — build completo (`shared` → `api` → `web`)
- `npm run typecheck` — checagem TypeScript estrita
- `npm test` — executa testes unitários e de integração
