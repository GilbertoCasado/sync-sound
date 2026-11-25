import { describe, expect, it, vi } from 'vitest';
import { SpotifyAdapter } from './spotify.adapter.js';

describe('SpotifyAdapter', () => {
  it('busca faixa por ISRC e mapeia metadados corretamente', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect((init?.headers as Headers).get('Authorization')).toBe('Bearer sp-token');
      expect(url).toContain('isrc%3AGBUM71029604');

      return new Response(
        JSON.stringify({
          tracks: {
            items: [
              {
                id: 'sp-track-1',
                name: 'Bohemian Rhapsody',
                duration_ms: 354_947,
                artists: [{ name: 'Queen' }],
                album: { name: 'A Night at the Opera' },
                external_ids: { isrc: 'GBUM71029604' },
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const adapter = new SpotifyAdapter(fetchMock, 0);
    const track = await adapter.searchByIsrc('gb-um7-1029604', { accessToken: 'sp-token' });

    expect(track).toMatchObject({
      id: 'sp-track-1',
      platform: 'spotify',
      title: 'Bohemian Rhapsody',
      artists: ['Queen'],
      durationMs: 354_947,
      isrc: 'GBUM71029604',
    });
  });

  it('cria playlist e envia faixas em lotes de URIs Spotify', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
      }
      if (url.endsWith('/users/user-1/playlists')) {
        return new Response(JSON.stringify({ id: 'pl-created' }), { status: 200 });
      }
      return new Response(JSON.stringify({ snapshot_id: 'snap-1' }), { status: 200 });
    });

    const adapter = new SpotifyAdapter(fetchMock, 0);
    const created = await adapter.createPlaylist({ name: 'Sync Playlist' }, { accessToken: 'tok' });
    await adapter.addTracksToPlaylist(created.id, ['t1', 't2'], { accessToken: 'tok' });

    expect(created.id).toBe('pl-created');
    expect(calls).toHaveLength(3);
  });
});
