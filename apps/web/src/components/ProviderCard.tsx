import type { ProviderAuthStatus, ProviderType } from '@syncsound/shared';

interface ProviderMeta {
  label: string;
  accent: string;
  description: string;
}

const PROVIDER_META: Record<ProviderType, ProviderMeta> = {
  spotify: {
    label: 'Spotify',
    accent: 'border-emerald-500/40 bg-emerald-500/10',
    description: 'OAuth 2.0 + leitura e criação de playlists com ISRC.',
  },
  deezer: {
    label: 'Deezer',
    accent: 'border-fuchsia-500/40 bg-fuchsia-500/10',
    description: 'Deezer Connect + leitura pública de playlists e busca por ISRC.',
  },
  youtube: {
    label: 'YouTube Music',
    accent: 'border-rose-500/40 bg-rose-500/10',
    description: 'Google OAuth + cache agressivo para economizar cota diária.',
  },
};

export interface ProviderCardProps {
  status: ProviderAuthStatus;
  onDisconnect: (provider: ProviderType) => Promise<void>;
  busy?: boolean;
}

export function ProviderCard({ status, onDisconnect, busy = false }: ProviderCardProps) {
  const meta = PROVIDER_META[status.provider];

  return (
    <article className={`flex flex-col justify-between rounded-xl border p-5 ${meta.accent}`}>
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">{meta.label}</h2>
          {status.connected ? (
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-200">
              Conectado
            </span>
          ) : (
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
              Desconectado
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-slate-300">{meta.description}</p>
        {status.supportsPublicRead && !status.connected && (
          <p className="mt-2 text-xs text-fuchsia-200/90">
            Leitura pública disponível mesmo sem login OAuth.
          </p>
        )}
        {!status.configured && !status.connected && (
          <p className="mt-2 text-xs text-amber-300/90">
            Credenciais OAuth ainda não configuradas no <code>.env</code>.
          </p>
        )}
      </div>

      <div className="mt-4">
        {status.connected ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDisconnect(status.provider)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Desconectar
          </button>
        ) : status.configured ? (
          <a
            href={`/auth/${status.provider}/login`}
            className="block w-full rounded-lg bg-slate-100 px-3 py-2 text-center text-sm font-semibold text-slate-950 transition hover:bg-white"
          >
            Conectar {meta.label}
          </a>
        ) : (
          <span className="block w-full rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-center text-xs text-slate-400">
            Configure o OAuth no .env para conectar
          </span>
        )}
      </div>
    </article>
  );
}
