import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProviderAuthStatus, ProviderType } from '@syncsound/shared';
import { deleteProviderOAuthConfig, saveProviderOAuthConfig } from '../services/api';

interface ProviderGuide {
  label: string;
  portalName: string;
  portalUrl: string;
  steps: string[];
  extraHint?: string;
}

const PROVIDER_GUIDES: Record<ProviderType, ProviderGuide> = {
  spotify: {
    label: 'Spotify',
    portalName: 'Spotify Developer Dashboard',
    portalUrl: 'https://developer.spotify.com/dashboard',
    steps: [
      'Acesse o Spotify Developer Dashboard e clique em "Create app".',
      'Em "Redirect URIs", adicione exatamente a URL abaixo (o Spotify exige 127.0.0.1 para loopback).',
      'Copie o Client ID e o Client Secret gerados e cole nos campos abaixo.',
    ],
    extraHint: 'Use sempre 127.0.0.1 (não localhost) na Redirect URI do Spotify.',
  },
  youtube: {
    label: 'YouTube Music',
    portalName: 'Google Cloud Console',
    portalUrl: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'Crie ou selecione um projeto no Google Cloud e ative a "YouTube Data API v3".',
      'Em Credenciais, crie um "ID do cliente OAuth" do tipo "Aplicativo da Web".',
      'Adicione a Redirect URI abaixo em "URIs de redirecionamento autorizados" e cole ID/Secret.',
    ],
  },
  deezer: {
    label: 'Deezer',
    portalName: 'Deezer for Developers',
    portalUrl: 'https://developers.deezer.com/myapps',
    steps: [
      'Acesse Deezer for Developers e crie uma nova aplicação.',
      'Informe a Redirect URI abaixo nas configurações de domínio/redirect da aplicação.',
      'Copie o Application ID (Client ID) e o Secret Key abaixo.',
    ],
    extraHint:
      'Para apenas ler playlists públicas do Deezer como origem, não é necessário configurar OAuth.',
  },
};

export interface ProviderConnectModalProps {
  status: ProviderAuthStatus | null;
  onClose: () => void;
  onSaved: (updated: ProviderAuthStatus, openLoginAfterSave: boolean) => void;
}

export function ProviderConnectModal({ status, onClose, onSaved }: ProviderConnectModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (status) {
      setClientId('');
      setClientSecret('');
      setRedirectUri(status.redirectUri);
      setCopied(false);
      setError(null);
      dialog.setAttribute('closedby', 'any');
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [status]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const handleClose = () => {
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    // Fallback progressivo para navegadores sem suporte a closedby="any"
    let cleanupOutside: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close();
        }
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      cleanupOutside = () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupOutside?.();
    };
  }, [onClose]);

  const handleCopyRedirect = async () => {
    if (!redirectUri) {
      return;
    }
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const persistConfig = async (openLoginAfterSave: boolean) => {
    if (!status) {
      return;
    }
    setError(null);

    if (!clientId.trim()) {
      setError('Informe o Client ID da aplicação.');
      return;
    }
    if (!clientSecret.trim() && !status.hasSecret) {
      setError('Informe o Client Secret da aplicação.');
      return;
    }

    setSaving(true);
    try {
      const updated = await saveProviderOAuthConfig(status.provider, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
        redirectUri: redirectUri.trim(),
      });
      onSaved(updated, openLoginAfterSave);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configuração OAuth.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void persistConfig(true);
  };

  const handleClearLocal = async () => {
    if (!status) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await deleteProviderOAuthConfig(status.provider);
      onSaved(updated, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao limpar credenciais locais.');
    } finally {
      setSaving(false);
    }
  };

  const guide = status ? PROVIDER_GUIDES[status.provider] : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="oauth-modal-title"
      className="syncsound-dialog w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl"
    >
      {status && guide && (
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h1 id="oauth-modal-title" className="text-xl font-bold text-white">
                Conectar {guide.label}
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                Salvo localmente em <code>.syncsound.oauth.json</code> (ignorado pelo Git).
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Fechar janela"
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              ✕
            </button>
          </div>

          <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                Passo a passo rápido
              </h2>
              <a
                href={guide.portalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-indigo-400 underline hover:text-indigo-300"
              >
                Abrir {guide.portalName} ↗
              </a>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-xs text-slate-300">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {guide.extraHint && <p className="text-xs text-amber-300/90">{guide.extraHint}</p>}
          </section>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="oauth-redirect-uri" className="block text-sm font-medium text-slate-200">
                Redirect URI
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="oauth-redirect-uri"
                  type="url"
                  required
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleCopyRedirect()}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="oauth-client-id" className="block text-sm font-medium text-slate-200">
                Client ID
              </label>
              <input
                id="oauth-client-id"
                type="text"
                autoFocus
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={
                  status.clientIdPreview
                    ? `Atual: ${status.clientIdPreview} (informe para atualizar)`
                    : 'Cole o Client ID do seu app'
                }
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="oauth-client-secret"
                className="block text-sm font-medium text-slate-200"
              >
                Client Secret
              </label>
              <input
                id="oauth-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  status.hasSecret
                    ? '•••••••••••• (deixe vazio para manter o salvo)'
                    : 'Cole o Client Secret do seu app'
                }
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
              >
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {status.configSource === 'local-file' ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleClearLocal()}
                  className="text-xs text-rose-300 underline hover:text-rose-200 disabled:opacity-50"
                >
                  Remover salvo localmente
                </button>
              ) : (
                <span />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => dialogRef.current?.close()}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void persistConfig(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                >
                  Apenas salvar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar e abrir janela de login'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </dialog>
  );
}
