import { useEffect, useState } from 'react';
import type { ProviderType } from '@syncsound/shared';
import { ProviderCard } from './components/ProviderCard';
import { fetchApiHealth, type HealthResponse } from './services/api';

const PROVIDERS: ProviderType[] = ['spotify', 'deezer', 'youtube'];

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    fetchApiHealth()
      .then(setHealth)
      .catch((err: unknown) => {
        setHealthError(err instanceof Error ? err.message : 'API indisponível');
      });
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <header className="space-y-3">
        <span className="inline-flex items-center rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
          SyncSound • Monorepo Fullstack TypeScript
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Migre suas playlists sem vendor lock-in
        </h1>
        <p className="max-w-2xl text-slate-400">
          Sincronização transparente entre Spotify, Deezer e YouTube Music com matching por ISRC,
          similaridade fuzzy e progresso em tempo real via Server-Sent Events.
        </p>
      </header>

      <section className="mt-10 grid gap-4 sm:grid-cols-3" aria-label="Plataformas suportadas">
        {PROVIDERS.map((provider) => (
          <ProviderCard key={provider} provider={provider} />
        ))}
      </section>

      <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-slate-300">Status da API local</span>
          {health ? (
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
              Online ({health.mode})
            </span>
          ) : healthError ? (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
              Offline — rode npm run dev
            </span>
          ) : (
            <span className="text-xs text-slate-400">Verificando...</span>
          )}
        </div>
      </section>
    </main>
  );
}
