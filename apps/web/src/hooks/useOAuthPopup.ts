import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderType } from '@syncsound/shared';

interface OAuthPopupMessage {
  type?: string;
  provider?: ProviderType;
  status?: 'success' | 'error';
  error?: string;
}

export interface UseOAuthPopupOptions {
  onSuccess: (provider: ProviderType) => void;
  onError: (message: string) => void;
}

export function useOAuthPopup({ onSuccess, onError }: UseOAuthPopupOptions) {
  const [connectingProvider, setConnectingProvider] = useState<ProviderType | null>(null);
  const popupRef = useRef<Window | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  useEffect(() => {
    const allowedOrigins = new Set<string>([
      window.location.origin,
      'http://localhost:3333',
      'http://127.0.0.1:3333',
    ]);

    const handleMessage = (event: MessageEvent<OAuthPopupMessage>) => {
      if (!allowedOrigins.has(event.origin)) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== 'syncsound:oauth' || !data.provider) {
        return;
      }

      popupRef.current = null;
      setConnectingProvider(null);

      if (data.status === 'success') {
        onSuccessRef.current(data.provider);
      } else {
        onErrorRef.current(data.error || `Falha ao autenticar com ${data.provider}.`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    if (!connectingProvider) {
      return;
    }

    const timer = window.setInterval(() => {
      const popup = popupRef.current;
      if (popup && popup.closed) {
        popupRef.current = null;
        setConnectingProvider(null);
      }
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [connectingProvider]);

  const openLoginPopup = useCallback((provider: ProviderType) => {
    const width = 540;
    const height = 720;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

    const popup = window.open(
      `/auth/${provider}/login?mode=popup`,
      `syncsound-oauth-${provider}`,
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no`,
    );

    if (!popup) {
      // Fallback seguro quando o navegador bloqueia popups
      window.location.assign(`/auth/${provider}/login`);
      return;
    }

    popupRef.current = popup;
    setConnectingProvider(provider);
    popup.focus();
  }, []);

  return {
    connectingProvider,
    openLoginPopup,
  };
}
