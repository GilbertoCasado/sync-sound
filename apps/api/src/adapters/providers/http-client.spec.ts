import { describe, expect, it, vi } from 'vitest';
import {
  fetchJsonWithRetry,
  parseIso8601DurationMs,
  parsePlaylistId,
} from './http-client.js';

describe('http-client utilities', () => {
  it('extrai IDs de playlists a partir de URLs e URIs de Spotify, Deezer e YouTube', () => {
    expect(
      parsePlaylistId('spotify', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'),
    ).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(parsePlaylistId('spotify', 'spotify:playlist:12345ABC')).toBe('12345ABC');

    expect(parsePlaylistId('deezer', 'https://www.deezer.com/br/playlist/908622995')).toBe(
      '908622995',
    );
    expect(parsePlaylistId('deezer', '908622995')).toBe('908622995');

    expect(
      parsePlaylistId('youtube', 'https://music.youtube.com/playlist?list=PL12345_abc-XYZ&si=1'),
    ).toBe('PL12345_abc-XYZ');
  });

  it('converte duração ISO 8601 do YouTube para milissegundos', () => {
    expect(parseIso8601DurationMs('PT4M13S')).toBe(253_000);
    expect(parseIso8601DurationMs('PT1H2M3S')).toBe(3_723_000);
    expect(parseIso8601DurationMs('invalid')).toBe(0);
  });

  it('faz retry em HTTP 429 e retorna payload JSON quando a tentativa seguinte funciona', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    const data = await fetchJsonWithRetry<{ ok: boolean }>(
      'https://api.example.com/test',
      {},
      { fetchFn: fetchMock, baseDelayMs: 1 },
    );

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
