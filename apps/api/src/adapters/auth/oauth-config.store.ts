import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  OAuthConfigSource,
  ProviderType,
  SaveProviderOAuthConfigRequest,
} from '@syncsound/shared';
import type { AppEnv } from '../../infra/config/env.js';

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ResolvedProviderConfig {
  config: OAuthProviderConfig | null;
  source: OAuthConfigSource;
  defaultRedirectUri: string;
}

type StoredOAuthFile = Partial<Record<ProviderType, OAuthProviderConfig>>;

export function resolveDefaultOAuthConfigPath(): string {
  const cwd = process.cwd();
  // Em workspaces npm, apps/api pode rodar com cwd em apps/api ou na raiz do monorepo.
  const workspaceRoot = existsSync(path.join(cwd, 'packages', 'shared'))
    ? cwd
    : path.resolve(cwd, '..', '..');
  return path.join(workspaceRoot, '.syncsound.oauth.json');
}

export function maskClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export class FileOAuthConfigStore {
  constructor(
    private readonly env: AppEnv,
    private readonly filePath: string = resolveDefaultOAuthConfigPath(),
  ) {}

  getDefaultRedirectUri(provider: ProviderType): string {
    if (provider === 'spotify') {
      return `http://127.0.0.1:${this.env.PORT}/auth/spotify/callback`;
    }
    if (provider === 'deezer') {
      return `http://localhost:${this.env.PORT}/auth/deezer/callback`;
    }
    return `http://localhost:${this.env.PORT}/auth/youtube/callback`;
  }

  async getProviderConfig(provider: ProviderType): Promise<ResolvedProviderConfig> {
    const defaultRedirectUri = this.getDefaultRedirectUri(provider);
    const stored = await this.readFileStore();
    const localEntry = stored[provider];

    if (
      localEntry &&
      this.isRealValue(localEntry.clientId) &&
      this.isRealValue(localEntry.clientSecret) &&
      this.isRealValue(localEntry.redirectUri)
    ) {
      return {
        config: {
          clientId: localEntry.clientId.trim(),
          clientSecret: localEntry.clientSecret.trim(),
          redirectUri: localEntry.redirectUri.trim(),
        },
        source: 'local-file',
        defaultRedirectUri,
      };
    }

    const envEntry = this.readFromEnv(provider);
    if (envEntry) {
      return {
        config: envEntry,
        source: 'env',
        defaultRedirectUri: envEntry.redirectUri,
      };
    }

    return {
      config: null,
      source: 'none',
      defaultRedirectUri,
    };
  }

  async saveProviderConfig(
    provider: ProviderType,
    input: SaveProviderOAuthConfigRequest,
  ): Promise<OAuthProviderConfig> {
    const clientId = input.clientId.trim();
    const redirectUri = input.redirectUri.trim();
    const incomingSecret = input.clientSecret?.trim() ?? '';

    if (!clientId) {
      throw new Error('Informe o Client ID da aplicação.');
    }
    if (!redirectUri) {
      throw new Error('Informe a Redirect URI da aplicação.');
    }

    const existing = await this.getProviderConfig(provider);
    const clientSecret = incomingSecret || existing.config?.clientSecret || '';
    if (!clientSecret) {
      throw new Error('Informe o Client Secret da aplicação.');
    }

    const stored = await this.readFileStore();
    const nextConfig: OAuthProviderConfig = {
      clientId,
      clientSecret,
      redirectUri,
    };
    stored[provider] = nextConfig;

    await this.writeFileStore(stored);
    return nextConfig;
  }

  async deleteProviderConfig(provider: ProviderType): Promise<void> {
    const stored = await this.readFileStore();
    if (!(provider in stored)) {
      return;
    }
    delete stored[provider];
    await this.writeFileStore(stored);
  }

  private readFromEnv(provider: ProviderType): OAuthProviderConfig | null {
    if (provider === 'spotify') {
      if (
        this.isRealValue(this.env.SPOTIFY_CLIENT_ID) &&
        this.isRealValue(this.env.SPOTIFY_CLIENT_SECRET) &&
        this.isRealValue(this.env.SPOTIFY_REDIRECT_URI)
      ) {
        return {
          clientId: this.env.SPOTIFY_CLIENT_ID!.trim(),
          clientSecret: this.env.SPOTIFY_CLIENT_SECRET!.trim(),
          redirectUri: this.env.SPOTIFY_REDIRECT_URI!.trim(),
        };
      }
      return null;
    }

    if (provider === 'deezer') {
      if (
        this.isRealValue(this.env.DEEZER_APP_ID) &&
        this.isRealValue(this.env.DEEZER_SECRET) &&
        this.isRealValue(this.env.DEEZER_REDIRECT_URI)
      ) {
        return {
          clientId: this.env.DEEZER_APP_ID!.trim(),
          clientSecret: this.env.DEEZER_SECRET!.trim(),
          redirectUri: this.env.DEEZER_REDIRECT_URI!.trim(),
        };
      }
      return null;
    }

    if (
      this.isRealValue(this.env.GOOGLE_CLIENT_ID) &&
      this.isRealValue(this.env.GOOGLE_CLIENT_SECRET) &&
      this.isRealValue(this.env.GOOGLE_REDIRECT_URI)
    ) {
      return {
        clientId: this.env.GOOGLE_CLIENT_ID!.trim(),
        clientSecret: this.env.GOOGLE_CLIENT_SECRET!.trim(),
        redirectUri: this.env.GOOGLE_REDIRECT_URI!.trim(),
      };
    }

    return null;
  }

  private async readFileStore(): Promise<StoredOAuthFile> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as StoredOAuthFile;
      }
      return {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeFileStore(data: StoredOAuthFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await rename(tmpPath, this.filePath);
  }

  private isRealValue(value?: string): boolean {
    if (!value) {
      return false;
    }
    const trimmed = value.trim();
    return Boolean(trimmed) && !trimmed.startsWith('seu_');
  }
}
