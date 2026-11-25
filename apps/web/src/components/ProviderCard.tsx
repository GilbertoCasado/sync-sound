import type { ProviderType } from '@syncsound/shared';

interface ProviderMeta {
  id: ProviderType;
  label: string;
  accent: string;
  description: string;
}

const PROVIDER_META: Record<ProviderType, ProviderMeta> = {
  spotify: {
    id: 'spotify',
    label: 'Spotify',
    accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    description: 'OAuth 2.0 + suporte completo a ISRC',
  },
  deezer: {
    id: 'deezer',
    label: 'Deezer',
    accent: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
    description: 'Deezer Connect + busca por ISRC com throttle',
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube Music',
    accent: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    description: 'Google OAuth + cache agressivo para economia de cota',
  },
};

export function ProviderCard({ provider }: { provider: ProviderType }) {
  const meta = PROVIDER_META[provider];

  return (
    <article className={`rounded-xl border p-5 transition-colors ${meta.accent}`}>
      <h2 className="text-lg font-semibold text-slate-100">{meta.label}</h2>
      <p className="mt-1 text-sm text-slate-300">{meta.description}</p>
    </article>
  );
}
