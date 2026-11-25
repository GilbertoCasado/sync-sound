import type {
  OAuthConfigSource,
  ProviderType,
  SaveProviderOAuthConfigRequest,
} from '@syncsound/shared';
import type { ProviderCredentials } from '../../core/ports/music-provider.port.js';
import { fetchJsonWithRetry, type FetchLike } from '../providers/http-client.js';
import {
  FileOAuthConfigStore,
  maskClientId,
  type OAuthProviderConfig,
} from './oauth-config.store.js';

export interface ProviderOAuthStatusMeta {
  configured: boolean;
  configSource: OAuthConfigSource;
  clientIdPreview?: string;
  redirectUri: string;
  hasSecret: boolean;
}

export class OAuthService {
  constructor(
    private readonly configStore: FileOAuthConfigStore,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async getStatusMeta(provider: ProviderType): Promise<ProviderOAuthStatusMeta> {
    const resolved = await this.configStore.getProviderConfig(provider);
    if (!resolved.config) {
      return {
        configured: false,
        configSource: 'none',
        redirectUri: resolved.defaultRedirectUri,
        hasSecret: false,
      };
    }

    return {
      configured: true,
      configSource: resolved.source,
      clientIdPreview: maskClientId(resolved.config.clientId),
      redirectUri: resolved.config.redirectUri,
      hasSecret: Boolean(resolved.config.clientSecret),
    };
  }

  async isConfigured(provider: ProviderType): Promise<boolean> {
    const resolved = await this.configStore.getProviderConfig(provider);
    return Boolean(resolved.config);
  }

  async saveConfig(
    provider: ProviderType,
    input: SaveProviderOAuthConfigRequest,
  ): Promise<ProviderOAuthStatusMeta> {
    await this.configStore.saveProviderConfig(provider, input);
    return this.getStatusMeta(provider);
  }

  async clearConfig(provider: ProviderType): Promise<ProviderOAuthStatusMeta> {
    await this.configStore.deleteProviderConfig(provider);
    return this.getStatusMeta(provider);
  }

  async getAuthorizeUrl(provider: ProviderType, state: string): Promise<string> {
    const config = await this.requireConfig(provider);

    if (provider === 'spotify') {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope:
          'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public',
        state,
      });
      return `https://accounts.spotify.com/authorize?${params.toString()}`;
    }

    if (provider === 'deezer') {
      const params = new URLSearchParams({
        app_id: config.clientId,
        redirect_uri: config.redirectUri,
        perms: 'basic_access,manage_library,offline_access',
        state,
      });
      return `https://connect.deezer.com/oauth/auth.php?${params.toString()}`;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'https://www.googleapis.com/auth/youtube',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(provider: ProviderType, code: string): Promise<ProviderCredentials> {
    const config = await this.requireConfig(provider);

    if (provider === 'spotify') {
      const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
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
        app_id: config.clientId,
        secret: config.clientSecret,
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
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
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

  private async requireConfig(provider: ProviderType): Promise<OAuthProviderConfig> {
    const resolved = await this.configStore.getProviderConfig(provider);
    if (!resolved.config) {
      throw new Error(`Credenciais OAuth para "${provider}" não configuradas.`);
    }
    return resolved.config;
  }
}
