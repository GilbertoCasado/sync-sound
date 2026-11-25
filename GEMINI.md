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
│           ├── track.types.ts           # Track, TrackMetadata, MatchResult, MatchConfidence
│           ├── playlist.types.ts        # Playlist, PlaylistSummary
│           └── migration.types.ts       # StartMigration*, MigrationProgressEvent, MigrationSummary
├── apps/
│   ├── api/                             # @syncsound/api (Node.js + Fastify + TypeScript + Vitest)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── core/
│   │       │   ├── domain/              # mapping.ts (chaves compostas de cache com targetPlatform)
│   │       │   ├── ports/               # IMusicProvider, IMappingCacheRepository, ISessionStore
│   │       │   ├── services/            # MetadataCleaner, MatchingEngine (próximo passo)
│   │       │   └── use-cases/           # ListPlaylistsUseCase, MigratePlaylistUseCase (próximo passo)
│   │       ├── adapters/
│   │       │   ├── cache/               # InMemoryMappingCacheRepository (+ testes)
│   │       │   ├── session/             # InMemorySessionStore
│   │       │   └── providers/           # ProviderRegistry e futuros Spotify/Deezer/YouTube adapters
│   │       ├── infra/
│   │       │   ├── config/env.ts        # Validação de env via Zod
│   │       │   └── http/app.ts          # Composition Root Fastify + CORS + Cookie + /api/health
│   │       └── server.ts
│   └── web/                             # @syncsound/web (React + Vite + Tailwind CSS)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts               # Proxy /api e /auth -> http://localhost:3333
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       ├── index.html
│       └── src/
│           ├── components/              # ProviderCard.tsx
│           ├── hooks/                   # useMigrationStream.ts (SSE EventSource)
│           ├── services/                # api.ts
│           ├── App.tsx
│           ├── main.tsx
│           └── index.css
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
- **SSE em 2 etapas:** `POST /api/migrations` cria o job (`jobId`, com suporte a `dryRun`) e `GET /api/migrations/:jobId/events` abre o stream SSE para evitar duplicação em reconexões automáticas do `EventSource`.
- **Sessão OAuth:** Tokens de provedores ficam no servidor (`ISessionStore`) associados a cookie `HttpOnly`.
- **Matching:** Normalização Unicode (`NFD`), remoção de ruídos (`Remastered`, `Official Video/Audio`), preservação de marcadores de versão (`Live`, `Ao Vivo`, `Remix`, `Acoustic`, `Instrumental`), Levenshtein ponderado (60% título / 40% artista principal) e tolerância de duração configurável por destino.
- **Testes:** Vitest em `apps/api` (`*.spec.ts`).

## Comandos Úteis
- `npm install` — instala dependências de todos os workspaces
- `npm run dev` — inicia API (`:3333`) e Web (`:5173`)
- `npm run build` — build completo (`shared` → `api` → `web`)
- `npm run typecheck` — checagem TypeScript estrita
- `npm test` — executa testes unitários
