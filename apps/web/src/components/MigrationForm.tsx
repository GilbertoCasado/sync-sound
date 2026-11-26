import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  PlaylistSummary,
  ProviderAuthStatus,
  ProviderType,
  StartMigrationRequest,
} from '@syncsound/shared';
import { fetchUserPlaylists } from '../services/api';

const PLATFORM_LABELS: Record<ProviderType, string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  youtube: 'YouTube Music',
};

const PLATFORMS: ProviderType[] = ['deezer', 'spotify', 'youtube'];

function detectPlatformFromInput(raw: string): ProviderType | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/^spotify:playlist:[A-Za-z0-9]+$/i.test(trimmed) || /open\.spotify\.com\/playlist\//i.test(trimmed)) {
    return 'spotify';
  }
  if (/deezer\.com\/(?:[a-z]{2}\/)?playlist\/\d+/i.test(trimmed)) {
    return 'deezer';
  }
  if (/(?:www\.|music\.)?youtube\.com\/.*[?&]list=/i.test(trimmed) || /youtu\.be\/.*[?&]list=/i.test(trimmed)) {
    return 'youtube';
  }
  return null;
}

export interface MigrationFormProps {
  providers: ProviderAuthStatus[];
  isRunning: boolean;
  onConnectProvider: (provider: ProviderType) => void;
  onSubmit: (payload: StartMigrationRequest) => Promise<void>;
}

export function MigrationForm({
  providers,
  isRunning,
  onConnectProvider,
  onSubmit,
}: MigrationFormProps) {
  const [sourcePlatform, setSourcePlatform] = useState<ProviderType>('deezer');
  const [targetPlatform, setTargetPlatform] = useState<ProviderType>('spotify');
  const [sourcePlaylistId, setSourcePlaylistId] = useState('');
  const [targetPlaylistName, setTargetPlaylistName] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [includeLowConfidence, setIncludeLowConfidence] = useState(true);

  const [userPlaylists, setUserPlaylists] = useState<PlaylistSummary[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [autoDetectedHint, setAutoDetectedHint] = useState<string | null>(null);
  const userPickedPlatformsRef = useRef(false);

  const sourceStatus = providers.find((p) => p.provider === sourcePlatform);
  const targetStatus = providers.find((p) => p.provider === targetPlatform);

  useEffect(() => {
    if (userPickedPlatformsRef.current || sourcePlaylistId.trim()) {
      return;
    }
    const connected = providers.filter((p) => p.connected).map((p) => p.provider);
    if (connected.length >= 2 && !connected.includes(sourcePlatform)) {
      setSourcePlatform(connected[0]!);
      setTargetPlatform(connected[1]!);
    }
  }, [providers, sourcePlatform, sourcePlaylistId]);

  useEffect(() => {
    if (!targetStatus?.connected) {
      setDryRun(true);
    }
  }, [targetStatus?.connected]);

  useEffect(() => {
    if (!sourceStatus?.connected) {
      setUserPlaylists([]);
      setPlaylistsError(null);
      return;
    }

    let cancelled = false;
    setLoadingPlaylists(true);
    setPlaylistsError(null);

    fetchUserPlaylists(sourcePlatform)
      .then((list) => {
        if (!cancelled) {
          setUserPlaylists(list);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPlaylistsError(
            err instanceof Error ? err.message : 'Não foi possível carregar suas playlists.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPlaylists(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourcePlatform, sourceStatus?.connected]);

  const handleSwapPlatforms = () => {
    userPickedPlatformsRef.current = true;
    setSourcePlatform(targetPlatform);
    setTargetPlatform(sourcePlatform);
    setAutoDetectedHint(null);
    setFormError(null);
  };

  const handlePlaylistInputChange = (value: string) => {
    setSourcePlaylistId(value);
    setFormError(null);

    if (!value.trim()) {
      setAutoDetectedHint(null);
      return;
    }

    const detected = detectPlatformFromInput(value);
    if (detected && detected !== sourcePlatform) {
      userPickedPlatformsRef.current = true;
      setSourcePlatform(detected);
      if (targetPlatform === detected) {
        const altConnected = providers.find((p) => p.connected && p.provider !== detected)?.provider;
        const altAny = PLATFORMS.find((p) => p !== detected) ?? 'spotify';
        setTargetPlatform(altConnected ?? altAny);
      }
      setAutoDetectedHint(
        `URL do ${PLATFORM_LABELS[detected]} detectada — plataforma de origem ajustada automaticamente.`,
      );
    } else if (!detected) {
      setAutoDetectedHint(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const trimmedPlaylist = sourcePlaylistId.trim();
    if (!trimmedPlaylist) {
      setFormError('Informe o ID ou a URL da playlist de origem.');
      return;
    }

    if (sourcePlatform !== 'deezer' && !sourceStatus?.connected) {
      setFormError(`Conecte sua conta ${PLATFORM_LABELS[sourcePlatform]} para ler esta playlist.`);
      return;
    }

    if (!dryRun && !targetStatus?.connected) {
      setFormError(
        `Conecte sua conta ${PLATFORM_LABELS[targetPlatform]} ou ative o Modo Simulação (dryRun).`,
      );
      return;
    }

    try {
      await onSubmit({
        sourcePlatform,
        targetPlatform,
        sourcePlaylistId: trimmedPlaylist,
        targetPlaylistName: targetPlaylistName.trim() || undefined,
        dryRun,
        includeLowConfidence,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao iniciar a migração.');
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Configurar Migração</h2>
          <p className="text-sm text-slate-400">
            Escolha origem, destino e acompanhe cada faixa convertida em tempo real.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSwapPlatforms}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
        >
          Inverter origem/destino
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="source-platform" className="block text-sm font-medium text-slate-200">
            Plataforma de origem
          </label>
          <select
            id="source-platform"
            value={sourcePlatform}
            onChange={(e) => {
              userPickedPlatformsRef.current = true;
              setAutoDetectedHint(null);
              setSourcePlatform(e.target.value as ProviderType);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {sourceStatus?.connected ? (
              <span className="font-medium text-emerald-300">Conta conectada</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onConnectProvider(sourcePlatform)}
                  className="font-medium text-indigo-300 underline hover:text-indigo-200"
                >
                  Conectar {PLATFORM_LABELS[sourcePlatform]} agora
                </button>
                {sourcePlatform === 'deezer' && (
                  <span className="text-slate-400">(ou use playlist pública sem login)</span>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="target-platform" className="block text-sm font-medium text-slate-200">
            Plataforma de destino
          </label>
          <select
            id="target-platform"
            value={targetPlatform}
            onChange={(e) => {
              userPickedPlatformsRef.current = true;
              setTargetPlatform(e.target.value as ProviderType);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {targetStatus?.connected ? (
              <span className="font-medium text-emerald-300">
                Conta conectada (pronta para criar playlist)
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onConnectProvider(targetPlatform)}
                  className="font-medium text-indigo-300 underline hover:text-indigo-200"
                >
                  Conectar {PLATFORM_LABELS[targetPlatform]} agora
                </button>
                <span className="text-slate-400">(ou simule com dryRun)</span>
              </>
            )}
          </div>
        </div>
      </div>

      {sourceStatus?.connected && (
        <div>
          <label htmlFor="user-playlist-select" className="block text-sm font-medium text-slate-200">
            Suas playlists no {PLATFORM_LABELS[sourcePlatform]}
          </label>
          <select
            id="user-playlist-select"
            value=""
            disabled={loadingPlaylists}
            onChange={(e) => {
              if (e.target.value) {
                setSourcePlaylistId(e.target.value);
              }
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">
              {loadingPlaylists
                ? 'Carregando playlists...'
                : 'Selecione uma playlist ou informe o ID/URL abaixo'}
            </option>
            {userPlaylists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name} ({playlist.trackCount} faixas)
              </option>
            ))}
          </select>
          {playlistsError && <p className="mt-1 text-xs text-amber-300">{playlistsError}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="source-playlist-id" className="block text-sm font-medium text-slate-200">
            ID ou URL da playlist de origem
          </label>
          <input
            id="source-playlist-id"
            type="text"
            value={sourcePlaylistId}
            onChange={(e) => handlePlaylistInputChange(e.target.value)}
            placeholder={
              sourcePlatform === 'deezer'
                ? 'Ex.: 908622995 ou https://www.deezer.com/playlist/908622995'
                : 'Cole a URL ou o ID da playlist'
            }
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          {autoDetectedHint && (
            <p className="mt-1 text-xs text-indigo-300">{autoDetectedHint}</p>
          )}
          {sourcePlatform === 'deezer' && !autoDetectedHint && (
            <p className="mt-1 text-xs text-slate-400">
              Dica: qualquer playlist pública do Deezer funciona mesmo sem OAuth.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="target-playlist-name" className="block text-sm font-medium text-slate-200">
            Nome da playlist no destino (opcional)
          </label>
          <input
            id="target-playlist-name"
            type="text"
            value={targetPlaylistName}
            onChange={(e) => setTargetPlaylistName(e.target.value)}
            placeholder="Mantém o nome original se vazio"
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="dry-run-toggle" className="flex items-start gap-2.5 text-sm text-slate-200">
          <input
            id="dry-run-toggle"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
          />
          <span>
            <strong className="font-medium">Modo Simulação (dryRun)</strong>
            <span className="block text-xs text-slate-400">
              Executa o matching completo sem criar ou alterar playlists reais no destino.
            </span>
          </span>
        </label>

        <label
          htmlFor="include-low-confidence"
          className="flex items-start gap-2.5 text-sm text-slate-200"
        >
          <input
            id="include-low-confidence"
            type="checkbox"
            checked={includeLowConfidence}
            onChange={(e) => setIncludeLowConfidence(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
          />
          <span>
            <strong className="font-medium">Incluir baixa confiança (0.65–0.84)</strong>
            <span className="block text-xs text-slate-400">
              Adiciona faixas sinalizadas para revisão posterior.
            </span>
          </span>
        </label>
      </div>

      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {formError}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={isRunning}
          className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning
            ? 'Processando migração...'
            : dryRun
              ? 'Simular Migração (Dry Run)'
              : 'Iniciar Migração'}
        </button>
      </div>
    </form>
  );
}
