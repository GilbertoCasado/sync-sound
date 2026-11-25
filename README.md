# 🎵 SyncSound

Migrador e sincronizador multi-streaming de playlists entre **Spotify**, **Deezer** e **YouTube Music**, construído com **Arquitetura Hexagonal (Ports & Adapters)**, motor de matching transparente (Cache → ISRC → Fuzzy/Levenshtein) e acompanhamento em tempo real via **Server-Sent Events (SSE)**.

## Principais Recursos

- **Matching em cascata transparente:**
  1. **Cache** por plataforma de destino (`isrc:<target>:<isrc>` / `track:<source>:<id>:<target>`).
  2. **Busca exata por ISRC** (Spotify e Deezer).
  3. **Normalização & Fuzzy (`fast-levenshtein`):** decomposição Unicode `NFD`, remoção de ruídos (`Remastered`, `Official Video/Audio`), preservação semântica de versões (`Live`, `Ao Vivo`, `Remix`, `Acoustic`, `Instrumental`), peso **60% título / 40% artista principal** e tolerância de duração ajustada por plataforma (±5s no Spotify/Deezer; janela ampliada no YouTube).
- **SSE em 2 etapas:** `POST /api/migrations` cria o job em background e `GET /api/migrations/:jobId/events` transmite e faz *replay* de eventos sem risco de duplicação em reconexões do `EventSource`.
- **Modo Simulação (`dryRun`):** analisa toda a playlist, exibe scores/motivos faixa a faixa e exporta relatórios (CSV de não encontradas e JSON completo) sem alterar a conta de destino.
- **Pronto para PostgreSQL / Supabase (Fase 2):** `PostgresMappingCacheRepository` e DDL em [apps/api/src/infra/db/schema.sql](./apps/api/src/infra/db/schema.sql) já implementados sobre a porta `IMappingCacheRepository`.

## Estrutura do Monorepo

```text
sync-sound/
├── packages/
│   └── shared/          # @syncsound/shared — contratos tipados compartilhados
├── apps/
│   ├── api/             # @syncsound/api — Fastify, OAuth 2.0, MatchingEngine, SSE, Vitest
│   └── web/             # @syncsound/web — React, Vite, Tailwind CSS
├── sync-sound-context.md
└── .env.example
```

## Como executar localmente

Pré-requisitos: **Node.js >= 20** e **npm**.

```bash
# 1. Instalar dependências do monorepo
npm install

# 2. Copiar variáveis de ambiente (preencha as chaves OAuth se quiser autenticar contas)
cp .env.example .env

# 3. Subir API (porta 3333) e Web (porta 5173) em paralelo
npm run dev
```

Acesse `http://localhost:5173`.

### Testando sem configurar chaves OAuth
- O **Deezer** suporta leitura pública de playlists e busca no catálogo sem login OAuth.
- Mesmo sem configurar `.env`, você pode testar o fluxo completo da interface selecionando **Deezer** como origem com uma URL/ID de playlist pública e mantendo **Modo Simulação (`dryRun`)** ativado (ex.: para simular contra catálogo público Deezer → Deezer, ou executando a suíte automatizada com `npm test`).

## Configurando OAuth 2.0 (pela Interface ou `.env`)

Você pode configurar e conectar cada plataforma **diretamente pela janela da interface web** (clicando em **Conectar** ou **Configurar** em qualquer card ou no formulário de migração):

- A janela de conexão exibe o passo a passo, link direto para o portal Developer oficial, botão para copiar a **Redirect URI** e salva os dados localmente em `.syncsound.oauth.json` (arquivo ignorado pelo Git) sem precisar editar `.env` nem reiniciar o servidor.
- Ao clicar em **Salvar e abrir janela de login**, o login oficial é aberto em uma janela popup que fecha automaticamente e atualiza o status na tela via `postMessage`.

Se preferir configurar via `.env`, utilize os valores abaixo:

| Plataforma | Redirect URI padrão | Variáveis no `.env` |
| :--- | :--- | :--- |
| **Spotify** | `http://127.0.0.1:3333/auth/spotify/callback` | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` |
| **Deezer** | `http://localhost:3333/auth/deezer/callback` | `DEEZER_APP_ID`, `DEEZER_SECRET`, `DEEZER_REDIRECT_URI` |
| **YouTube Music** | `http://localhost:3333/auth/youtube/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |

> **Atenção (Spotify):** o Spotify exige endereço loopback IPv4 (`127.0.0.1`, não `localhost`) nas Redirect URIs locais.

## Endpoints da API (`apps/api`)

- `GET /api/health` — status e modo de execução (`stateless-in-memory` ou `postgres`)
- `GET /api/auth/status` — estado de conexão e configuração OAuth por provedor
- `PUT /api/auth/:provider/config` & `DELETE /api/auth/:provider/config` — salva/remove credenciais OAuth locais pela UI
- `GET /auth/:provider/login` (`?mode=popup`) & `GET /auth/:provider/callback` — fluxo OAuth 2.0 com state CSRF de uso único em sessão `HttpOnly`
- `POST /api/auth/:provider/disconnect` — desconecta um provedor da sessão
- `GET /api/providers/:provider/playlists` — lista playlists do usuário autenticado
- `GET /api/providers/:provider/playlists/:playlistId` — detalha playlist e faixas
- `POST /api/migrations` — cria um job de migração (`dryRun`, `includeLowConfidence`) e retorna `{ jobId }`
- `GET /api/migrations/:jobId` — snapshot completo do job
- `GET /api/migrations/:jobId/events` — stream SSE em tempo real com *replay* de eventos

## Scripts principais

| Comando | Descrição |
| :--- | :--- |
| `npm run dev` | Inicia `apps/api` e `apps/web` em paralelo |
| `npm run build` | Compila `shared`, `api` e `web` |
| `npm run typecheck` | Executa checagem estrita de tipos em todo o monorepo |
| `npm test` | Roda a suíte de testes unitários e de integração com Vitest |

## Documentação Complementar

Consulte [sync-sound-context.md](./sync-sound-context.md) para a especificação arquitetural completa.
