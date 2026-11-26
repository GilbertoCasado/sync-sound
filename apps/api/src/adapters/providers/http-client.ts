import type { ProviderType } from '@syncsound/shared';

export type FetchLike = typeof fetch;

export class HttpApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly bodyText?: string,
  ) {
    super(message);
    this.name = 'HttpApiError';
  }
}

export class RateLimiter {
  private lastRunAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.minIntervalMs <= 0) {
      return task();
    }

    const run = this.queue.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, this.lastRunAt + this.minIntervalMs - now);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.lastRunAt = Date.now();
      return task();
    });

    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }
}

export interface FetchRetryOptions {
  fetchFn?: FetchLike;
  maxRetries?: number;
  baseDelayMs?: number;
  rateLimiter?: RateLimiter;
}

export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<T> {
  const fetchFn = options.fetchFn ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;

  const executeAttempt = async (): Promise<Response> => {
    if (options.rateLimiter) {
      return options.rateLimiter.schedule(() => fetchFn(url, init));
    }
    return fetchFn(url, init);
  };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await executeAttempt();

    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (shouldRetry && attempt < maxRetries) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const delayMs = Number.isFinite(retryAfterSec)
        ? Math.max(0, retryAfterSec * 1000)
        : baseDelayMs * 2 ** attempt;
      await sleep(delayMs);
      continue;
    }

    const bodyText = await response.text().catch(() => '');
    throw new HttpApiError(
      `HTTP ${response.status} ao chamar ${sanitizeUrlForLog(url)}: ${bodyText || response.statusText}`,
      response.status,
      bodyText,
    );
  }

  throw new Error(`Falha ao chamar ${sanitizeUrlForLog(url)} após ${maxRetries + 1} tentativas.`);
}

const PROVIDER_LABELS: Record<ProviderType, string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  youtube: 'YouTube Music',
};

export function detectPlatformFromPlaylistUrl(rawInput: string): ProviderType | null {
  const trimmed = rawInput.trim();
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

export function parsePlaylistId(platform: ProviderType, rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('O identificador ou URL da playlist não pode ser vazio.');
  }

  const detected = detectPlatformFromPlaylistUrl(trimmed);
  if (detected && detected !== platform) {
    throw new Error(
      `A URL informada é do ${PROVIDER_LABELS[detected]}, mas a plataforma de origem selecionada é ${PROVIDER_LABELS[platform]}. Altere a plataforma de origem.`,
    );
  }

  if (platform === 'spotify') {
    const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
    if (uriMatch?.[1]) {
      return uriMatch[1];
    }
    const urlMatch = trimmed.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
    if (urlMatch?.[1]) {
      return urlMatch[1];
    }
    return trimmed;
  }

  if (platform === 'deezer') {
    const urlMatch = trimmed.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
    const extracted = urlMatch?.[1] ?? trimmed;
    if (!/^\d+$/.test(extracted)) {
      throw new Error(
        'ID de playlist do Deezer inválido. Informe um ID numérico ou URL válida do Deezer.',
      );
    }
    return extracted;
  }

  const ytMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (ytMatch?.[1]) {
    return ytMatch[1];
  }
  return trimmed;
}

export function parseIso8601DurationMs(iso: string): number {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) {
    return 0;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('access_token')) {
      parsed.searchParams.set('access_token', '***');
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
