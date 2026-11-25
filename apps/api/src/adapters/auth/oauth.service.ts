import type { ProviderType } from '@syncsound/shared';
import type { ProviderCredentials } from '../../core/ports/music-provider.port.js';
import type { AppEnv } from '../../infra/config/env.js';
import { fetchJsonWithRetry, type FetchLike } from '../providers/http-client.js';

export class OAuthService {
  constructor(
    private readonly env: AppEnv,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  isConfigured(provider: ProviderType): boolean {
    if (provider === 'spotify') {
      return (
        this.isRealValue(this.env.SPOTIFY_CLIENT_ID) &&
        this.isRealValue(this.env.SPOTIFY_CLIENT_SECRET) &&
        this.isRealValue(this.env.SPOTIFY_REDIRECT_URI)
      );
    }

    if (provider === 'deezer') {
      return (
        this.isRealValue(this.env.DEEZER_APP_ID) &&
        this.isRealValue(this.env.DEEZER_SECRET) &&
        this.isRealValue(this.env.DEEZER_REDIRECT_URI)
      );
    }

    return (
      this.isRealValue(this.env.GOOGLE_CLIENT_ID) &&
      this.isRealValue(this.env.GOOGLE_CLIENT_SECRET) &&
      this.isRealValue(this.env.GOOGLE_REDIRECT_URI)
    );
  }

  getAuthorizeUrl(provider: ProviderType, state: string): string {
    if (!this.isConfigured(provider)) {
      throw new Error(`Credenciais OAuth para "${provider}" não configuradas no .env.`);
    }

    if (provider === 'spotify') {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: this.env.SPOTIFY_CLIENT_ID!,
        redirect_uri: this.env.SPOTIFY_REDIRECT_URI!,
        scope: 'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public',
        state,
      });
      return `https://accounts.spotify.com/authorize?${params.toString()}`;
    }

    if (provider === 'deezer') {
      const params = new URLSearchParams({
        app_id: this.env.DEEZER_APP_ID!,
        redirect_uri: this.env.DEEZER_REDIRECT_URI!,
        perms: 'basic_access,manage_library,offline_access',
        state,
      });
      return `https://connect.deezer.com/oauth/auth.php?${params.toString()}`;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.env.GOOGLE_CLIENT_ID!,
      redirect_uri: this.env.GOOGLE_REDIRECT_URI!,
      scope: 'https://www.googleapis.com/auth/youtube',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(provider: ProviderType, code: string): Promise<ProviderCredentials> {
    if (!this.isConfigured(provider)) {
      throw new Error(`Credenciais OAuth para "${provider}" não configuradas no .env.`);
    }

    if (provider === 'spotify') {
      const basicAuth = Buffer.from(
        `${this.env.SPOTIFY_CLIENT_ID}:${this.env.SPOTIFY_CLIENT_SECRET}`,
      ).toString('base64');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.env.SPOTIFY_REDIRECT_URI!,
      });

      const tokenResponse = await fetchJsonWithRetry<{
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      }>(
        'https://accounts.spotify.com/api/token',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        },
        { fetchFn: this.fetchFn },
      );

      return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: tokenResponse.expires_in
          ? Date.now() + tokenResponse.expires_in * 1000
          : undefined,
      };
    }

    if (provider === 'deezer') {
      const params = new URLSearchParams({
        app_id: this.env.DEEZER_APP_ID!,
        secret: this.env.DEEZER_SECRET!,
        code,
        output: 'json',
      });

      const tokenResponse = await fetchJsonWithRetry<{
        access_token?: string;
        expires?: number;
        error?: string;
      }>(
        `https://connect.deezer.com/oauth/access_token.php?${params.toString()}`,
        { method: 'GET' },
        { fetchFn: this.fetchFn },
      );

      if (!tokenResponse.access_token) {
        throw new Error(tokenResponse.error ?? 'Falha ao obter access_token do Deezer.');
      }

      return {
        accessToken: tokenResponse.access_token,
        expiresAt:
          tokenResponse.expires && tokenResponse.expires > 0
            ? Date.now() + tokenResponse.expires * 1000
            : undefined,
      };
    }

    const googleBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.env.GOOGLE_CLIENT_ID!,
      client_secret: this.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: this.env.GOOGLE_REDIRECT_URI!,
    });

    const tokenResponse = await fetchJsonWithRetry<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: googleBody.toString(),
      },
      { fetchFn: this.fetchFn },
    );

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_in
        ? Date.now() + tokenResponse.expires_in * 1000
        : undefined,
    };
  }

  private isRealValue(value?: string): boolean {
    if (!value) {
      return false;
    }
    const trimmed = value.trim();
    return Boolean(trimmed) && !trimmed.startsWith('seu_');
  }
}
