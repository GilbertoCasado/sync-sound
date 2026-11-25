# 🎵 SyncSound

Migrador e sincronizador multi-streaming de playlists entre **Spotify**, **Deezer** e **YouTube Music**, com arquitetura hexagonal (*Ports & Adapters*), pipeline de matching transparente (ISRC + Fuzzy/Levenshtein) e progresso em tempo real via **Server-Sent Events (SSE)**.

## Arquitetura

Monorepo Fullstack TypeScript gerenciado com **npm workspaces**:

```text
sync-sound/
├── packages/
│   └── shared/          # @syncsound/shared — contratos tipados (Track, Playlist, MigrationProgressEvent)
├── apps/
│   ├── api/             # @syncsound/api — Fastify + Arquitetura Hexagonal + Vitest
│   └── web/             # @syncsound/web — React + Vite + Tailwind CSS
├── sync-sound-context.md
└── .env.example
```

- **Modo Inicial:** 100% *Stateless / In-Memory* (`InMemoryMappingCacheRepository` e `InMemorySessionStore`).
- **Fase 2 (PostgreSQL / Supabase):** Basta implementar `PostgresMappingCacheRepository` sobre o contrato `IMappingCacheRepository` sem alterar regras de negócio.

## Como executar localmente

Pré-requisitos: **Node.js >= 20** e **npm**.

```bash
# 1. Instalar dependências do monorepo
npm install

# 2. Copiar variáveis de ambiente (opcional para o modo inicial)
cp .env.example .env

# 3. Subir API (porta 3333) e Web (porta 5173) em paralelo
npm run dev
```

## Scripts principais

| Comando | Descrição |
| :--- | :--- |
| `npm run dev` | Inicia `apps/api` e `apps/web` em paralelo |
| `npm run build` | Compila `shared`, `api` e `web` |
| `npm run typecheck` | Executa checagem estrita de tipos em todo o monorepo |
| `npm test` | Roda a suíte de testes unitários com Vitest |

## Documentação de Arquitetura

Consulte [sync-sound-context.md](./sync-sound-context.md) para a especificação completa do pipeline de matching, particularidades das APIs e schema SQL preparado para PostgreSQL/Supabase.
