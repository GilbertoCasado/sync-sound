import { useCallback, useEffect, useState } from 'react';
import type {
  ProviderAuthStatus,
  ProviderType,
  StartMigrationRequest,
} from '@syncsound/shared';
import { MigrationForm } from './components/MigrationForm';
import { MigrationProgressPanel } from './components/MigrationProgressPanel';
import { ProviderCard } from './components/ProviderCard';
import { useMigrationStream } from './hooks/useMigrationStream';
import {
  disconnectProvider,
  fetchApiHealth,
  fetchAuthStatus,
  startMigration,
  type HealthResponse,
} from './services/api';

const FALLBACK_STATUSES: ProviderAuthStatus[] = [
  { provider: 'spotify', connected: false, configured: false, supportsPublicRead: false },
  { provider: 'deezer', connected: false, configured: false, supportsPublicRead: true },
  { provider: 'youtube', connected: false, configured: false, supportsPublicRead: false },
];

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderAuthStatus[]>(FALLBACK_STATUSES);
  const [busyProvider, setBusyProvider] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const stream = useMigrationStream(activeJobId);

  const refreshStatus = useCallback(async () => {
    try {
      const [healthData, authStatuses] = await Promise.all([
        fetchApiHealth(),
        fetchAuthStatus(),
      ]);
      setHealth(healthData);
      setHealthError(null);
      setProviders(authStatuses);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'API indisponível');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const authError = params.get('auth_error');

    if (connected) {
      setBanner({
        kind: 'success',
        text: `Conta ${connected} conectada com sucesso na sessão.`,
      });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (authError) {
      setBanner({
        kind: 'error',
        text: authError,
      });
      window.history.replaceState({}, '', window.location.pathname);
    }

    void refreshStatus();
  }, [refreshStatus]);

  const handleDisconnect = async (provider: ProviderType) => {
    setBusyProvider(true);
    try {
      await disconnectProvider(provider);
      await refreshStatus();
    } finally {
      setBusyProvider(false);
    }
  };

  const handleStartMigration = async (payload: StartMigrationRequest) => {
    const started = await startMigration(payload);
    setActiveJobId(started.jobId);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="space-y-2">
          <span className="inline-flex items-center rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
            SyncSound • Migrador Multi-Streaming
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Migre suas playlists sem vendor lock-in
          </h1>
          <p className="max-w-2xl text-sm text-slate-400 sm:text-base">
            Matching transparente por ISRC + distância Levenshtein com preservação de versões e
            acompanhamento em tempo real via Server-Sent Events.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5 text-xs">
          {health ? (
            <span className="font-medium text-emerald-300">API Online ({health.mode})</span>
          ) : healthError ? (
            <span className="font-medium text-amber-300">API Offline — rode npm run dev</span>
          ) : (
            <span className="text-slate-400">Verificando API...</span>
          )}
        </div>
      </header>

      <main className="mt-8 flex-1 space-y-8">
        {banner && (
          <div
            role="status"
            className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${
              banner.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            <span>{banner.text}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs underline opacity-80 hover:opacity-100"
            >
              Fechar
            </button>
          </div>
        )}

        <section aria-label="Contas conectadas" className="grid gap-4 sm:grid-cols-3">
          {providers.map((status) => (
            <ProviderCard
              key={status.provider}
              status={status}
              busy={busyProvider}
              onDisconnect={handleDisconnect}
            />
          ))}
        </section>

        <MigrationForm
          providers={providers}
          isRunning={stream.status === 'running'}
          onSubmit={handleStartMigration}
        />

        <MigrationProgressPanel stream={stream} />
      </main>

      <footer className="mt-12 border-t border-slate-800/80 pt-6 text-xs text-slate-500">
        SyncSound — Arquitetura Hexagonal (Ports & Adapters) • Stateless / In-Memory local com
        extensão pronta para PostgreSQL / Supabase.
      </footer>
    </div>
  );
}
