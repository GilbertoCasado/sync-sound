# 🎵 SyncSound - Especificação de Arquitetura e Contexto de Projeto

---

## 1. Visão Geral do Produto

* **Nome do Projeto:** SyncSound (Migrador e Sincronizador Multi-Streaming)
* **Objetivo:** Permitir a migração transparente e de alta fidelidade de playlists e bibliotecas musicais entre diferentes plataformas de streaming de áudio (**Spotify**, **Deezer** e **YouTube Music**).
* **Proposta de Valor:** Quebrar o aprisionamento (*vendor lock-in*) dos serviços de streaming sem depender de ferramentas comerciais pagas ou com limites arbitrários, oferecendo transparência no algoritmo de correspondência (*matching*) e relatório de faixas não encontradas.
* **Modelo Operacional Inicial:** **Stateless / In-Memory**. O sistema roda localmente sem exigir banco de dados ativo de imediato, mas arquitetado com *Repository Pattern* para plugar o **Supabase (PostgreSQL puro)** apenas alterando a injeção de dependência.

---

## 2. Stack Tecnológica (Fullstack TypeScript)

| Camada | Tecnologia | Motivo da Escolha |
| :--- | :--- | :--- |
| **Monorepo / Workspace** | npm / pnpm workspaces | Compartilhamento nativo de tipos (`Track`, `Playlist`, `Provider`) entre frontend e backend. |
| **Backend** | Node.js + Fastify + TypeScript | Baixo consumo de memória RAM (< 50 MB ocioso), alta taxa de I/O assíncrono e suporte nativo simplificado a streams / SSE (*Server-Sent Events*). |
| **Frontend** | React + Vite + Tailwind CSS + shadcn/ui | SPA estática extremamente rápida, sem custos de SSR, fácil de rodar localmente ou hospedar no Cloudflare Pages. |
| **Comunicação em Tempo Real** | Server-Sent Events (SSE) em 2 etapas | `POST /api/migrations` cria o job (`jobId`) e `GET /api/migrations/:jobId/events` transmite o progresso sem risco de duplicação em reconexões do `EventSource`. |
| **Sessão / Tokens OAuth** | Cookie `HttpOnly` + `InMemorySessionStore` | Mantém tokens OAuth de origem/destino seguros no servidor (sem expor em URL ou `localStorage`), compatível com `EventSource` nativo. |
| **Algoritmo de Matching** | `fast-levenshtein` + Comparador Numérico | Distância de edição após normalização Unicode (`NFD`), preservação de tags de versão (`Live`, `Remix`, `Acoustic`) e tolerância de duração ajustável por provedor. |
| **Testes Automatizados** | Vitest | Validação unitária do `MetadataCleaner`, `MatchingEngine` e `MigratePlaylistUseCase` sem consumir cotas de API. |
| **Banco de Dados (Fase 2 / Nuvem)** | PostgreSQL puro via Supabase | Usado estritamente como pool de conexões PostgreSQL padrão (`postgres://...:6543/postgres`) para cache de ISRC e métricas. |

---

## 3. Arquitetura de Software e Extensibilidade

Para manter o sistema **Stateless localmente** e permitir **persistência no PostgreSQL sem alterar regras de negócio**, aplicamos a Arquitetura Hexagonal (Ports & Adapters).

```
                      ┌────────────────────────┐
                      │    Fastify / Routes    │
                      └───────────┬────────────┘
                                  │
                                  ▼
                      ┌────────────────────────┐
                      │ MigratePlaylistUseCase │
                      └─────┬────────────┬─────┘
                            │            │
            ┌───────────────┘            └───────────────┐
            ▼                                            ▼
   [ IMusicProvider ]                          [ IMappingCacheRepository ]
   ├── SpotifyAdapter                          ├── InMemoryMappingCache (Atual - Local)
   ├── DeezerAdapter                           └── SupabaseMappingCache (Futuro - Postgres)
   └── YouTubeMusicAdapter
```

### 3.1 Contrato da Porta de Cache (`IMappingCacheRepository`)

A chave de cache sempre inclui a **plataforma de destino** (`targetPlatform`) para evitar colisões quando a mesma faixa (mesmo ISRC) for migrada para múltiplos serviços diferentes (ex.: Deezer e YouTube Music).

```typescript
export type ProviderType = 'spotify' | 'deezer' | 'youtube';

export interface MappingCacheLookup {
  targetPlatform: ProviderType;
  isrc?: string;
  sourcePlatform?: ProviderType;
  sourceTrackId?: string;
}

export interface TrackMapping {
  isrc?: string;
  sourcePlatform: ProviderType;
  sourceTrackId: string;
  targetPlatform: ProviderType;
  targetTrackId: string;
  similarityScore?: number;
}

export interface IMappingCacheRepository {
  /** Busca se já conhecemos o ID correspondente no serviço de destino (por ISRC+destino ou origem+destino) */
  getMapping(lookup: MappingCacheLookup): Promise<string | null>;
  /** Salva o pareamento para evitar chamadas de busca redundantes no futuro */
  setMapping(mapping: TrackMapping): Promise<void>;
}
```

* **Modo Local (Agora):** A classe `InMemoryMappingCacheRepository` armazena os dados em `Map<string, string>()` indexado por `isrc:${targetPlatform}:${isrc}` e `track:${sourcePlatform}:${sourceTrackId}:${targetPlatform}`.
* **Modo Produção/Supabase (Depois):** Basta implementar `PostgresMappingCacheRepository` executando queries no PostgreSQL e injetá-la no container de serviços.

### 3.2 Fluxo de Sessão OAuth e Streaming SSE (2 Etapas)

1. **Autenticação:** Os tokens OAuth de cada provedor conectado são armazenados no backend em uma `ISessionStore` (`InMemorySessionStore` no modo local), referenciada apenas por um cookie `HttpOnly` (`SameSite=Lax`).
2. **Início da Migração:** `POST /api/migrations` valida a requisição (incluindo suporte a `dryRun: true` para simulação sem escrita), cria um job em memória e retorna `{ jobId }`.
3. **Acompanhamento em Tempo Real:** O cliente abre `EventSource` em `GET /api/migrations/:jobId/events`. Caso a conexão caia e o navegador reconecte automaticamente, o job **não** é reiniciado nem duplica a playlist no destino.

---

## 4. O Pipeline de Matching (Coração do Sistema)

A conversão de faixas entre serviços heterogêneos obedece a uma estratégia em cascata para balancear acurácia e economia de cotas:

```
                  [Faixa de Origem]
                          │
                          ▼
             Possui ISRC identificado?
             ├── (SIM) ──► Consulta Cache Local/Postgres
             │                 ├── (Existe no Cache) ──► [Match Instantâneo 100%]
             │                 └── (Não Existe)
             │                          │
             │                          ▼
             │               Busca por ISRC no Destino
             │                 ├── (Encontrou) ───────► [Salva no Cache] ──► [Match 100%]
             │                 └── (Não Encontrou)
             │                          │
             └── (NÃO) ─────────────────┘
                          │
                          ▼
               Limpeza de Metadados (Regex + Unicode)
  - Normaliza acentos/diacríticos (Unicode NFD) e caixa baixa
  - Remove ruídos: "(Remastered ...)", "[Official Audio/Video]", "Lyric Video", "Radio Edit"
  - Preserva marcadores de versão (Live, Ao Vivo, Remix, Acoustic, Instrumental)
    para evitar confundir gravação de estúdio com ao vivo/remix
  - Normaliza "feat.", "ft.", "&" para vírgulas
                          │
                          ▼
                Busca Textual no Destino
              (Query: "{artista} {título}")
                          │
                          ▼
            Cálculo de Similaridade (Score)
  - Distância Levenshtein em Título (peso 60%)
  - Distância Levenshtein em Artista Principal (peso 40%)
  - Validação de versão (penalidade se divergência Live/Remix/Acoustic)
  - Validação de duração: ±5s (regra forte Spotify/Deezer; penalidade suave/janela
    ampliada no YouTube devido a intros/outros de videoclipes)
                          │
                          ├─ Score >= 0.85 ──► [Match Aceito Automaticamente]
                          ├─ 0.65 <= Score < 0.85 ──► [Match Baixa Confiança / Sinalizado]
                          └─ Score < 0.65  ──► [Faixa Não Encontrada / Requer Ação Manual]
```

---

## 5. Particularidades e Tratamento das APIs

| Plataforma | Autenticação | Suporte a ISRC | Principais Atenções |
| :--- | :--- | :--- | :--- |
| **Spotify** | OAuth 2.0 (PKCE ou Code Grant) | Excelente (`external_ids.isrc`) | Rate limits por IP/Client ID. Respostas com paginação de 50 ou 100 itens. |
| **Deezer** | OAuth 2.0 (Deezer Connect) | Excelente (endpoint `/track/:id`) | Limite de ~50 requisições a cada 5 segundos. Necessário throttle leve entre buscas. |
| **YouTube Music** | Google OAuth 2.0 (YouTube Data v3) | Indireto / Baixo | **Cota crítica:** 10.000 unidades diárias gratuitas. Uma busca textual gasta 100 unidades (máximo de 100 buscas/dia sem cache). O cache de mapeamento é vital aqui. |

---

## 6. Estrutura de Pastas do Monorepo

```text
syncsound/
├── packages/
│   └── shared/                      # Tipos compartilhados entre Front e Back
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── track.types.ts       # Track, TrackMetadata, MatchResult
│           ├── playlist.types.ts    # Playlist, PlaylistSummary
│           └── migration.types.ts   # MigrationProgressEvent, ProviderType
│
├── apps/
│   ├── api/                         # Backend Fastify
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── core/
│   │       │   ├── domain/          # Regras puras e entidades
│   │       │   ├── ports/           # Interfaces (IMusicProvider, IMappingCacheRepository)
│   │       │   ├── services/        # MatchingEngine, MetadataCleaner
│   │       │   └── use-cases/       # MigratePlaylistUseCase, ListPlaylistsUseCase
│   │       ├── adapters/
│   │       │   ├── providers/       # SpotifyAdapter, DeezerAdapter, YouTubeAdapter
│   │       │   └── cache/           # InMemoryCache (Default), PostgresCache (Extensão)
│   │       ├── infra/
│   │       │   └── http/            # Rotas Fastify, SSE Handlers, Plugins de CORS
│   │       └── server.ts
│   │
│   └── web/                         # Frontend React + Vite
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── src/
│           ├── components/          # Seletor de provedor, cards de playlist, log de progresso
│           ├── hooks/               # useMigrationStream (leitor de EventSource SSE)
│           ├── services/            # Clientes HTTP para a API local
│           └── App.tsx
│
├── .env.example
├── package.json                     # Scripts de inicialização conjunta (npm run dev)
└── README.md
```

---

## 7. Schema Relacional (Preparado para PostgreSQL / Supabase)

Quando a persistência for ativada no Supabase, este será o esquema DDL a ser executado:

```sql
-- Habilita extensão para UUIDs se necessário
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cache universal de mapeamento entre músicas
CREATE TABLE track_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    isrc VARCHAR(32),
    source_platform VARCHAR(20) NOT NULL,
    source_track_id VARCHAR(128) NOT NULL,
    target_platform VARCHAR(20) NOT NULL,
    target_track_id VARCHAR(128) NOT NULL,
    similarity_score NUMERIC(3, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_mapping UNIQUE (source_platform, source_track_id, target_platform)
);

CREATE INDEX idx_track_mappings_isrc_target
    ON track_mappings (isrc, target_platform)
    WHERE isrc IS NOT NULL;

-- Histórico de migrações (Opcional, para logs e relatórios)
CREATE TABLE migration_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_platform VARCHAR(20) NOT NULL,
    target_platform VARCHAR(20) NOT NULL,
    playlist_name VARCHAR(255) NOT NULL,
    total_tracks INT NOT NULL,
    matched_tracks INT DEFAULT 0,
    failed_tracks INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'RUNNING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE
);
```

---

## 8. Variáveis de Ambiente Iniciais (`.env.example`)

```env
# Backend Server
PORT=3333
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Spotify Developer App
SPOTIFY_CLIENT_ID=seu_client_id_aqui
SPOTIFY_CLIENT_SECRET=seu_client_secret_aqui
SPOTIFY_REDIRECT_URI=http://localhost:3333/auth/spotify/callback

# Deezer Developer App
DEEZER_APP_ID=seu_app_id_aqui
DEEZER_SECRET=seu_secret_aqui
DEEZER_REDIRECT_URI=http://localhost:3333/auth/deezer/callback

# Google / YouTube Data API v3
GOOGLE_CLIENT_ID=seu_google_client_id_aqui
GOOGLE_CLIENT_SECRET=seu_google_client_secret_aqui
GOOGLE_REDIRECT_URI=http://localhost:3333/auth/youtube/callback

# Banco de Dados (Deixe vazio enquanto rodar 100% Stateless local)
DATABASE_URL=
```

---

## 9. Plano de Execução Imediato

1. **Passo 1:** Inicializar o workspace monorepo (`shared`, `apps/api`, `apps/web`).
2. **Passo 2:** Criar os contratos tipados (`IMusicProvider`, `Track`, `Playlist`) no pacote `shared`.
3. **Passo 3:** Implementar o algoritmo isolado de normalização de strings e cálculo de similaridade (Fuzzy + Levenshtein).
4. **Passo 4:** Criar o primeiro adapter de leitura e teste local (ex: carregar playlist do Spotify e simular conversão para o Deezer).