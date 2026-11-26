import { describe, expect, it, vi } from 'vitest';
import { SpotifyAdapter } from './spotify.adapter.js';

describe('SpotifyAdapter', () => {
  it('lista playlists lendo contagem via items.total (schema 2026) ou tracks.total', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'pl-2026',
              name: 'Playlist 2026',
              items: { total: 42 },
            },
            {
              id: 'pl-legacy',
              name: 'Playlist Legada',
              tracks: { total: 10 },
            },
          ],
          next: null,
        }),
        { status: 200 },
      );
    });

    const adapter = new SpotifyAdapter(fetchMock, 0);
    const playlists = await adapter.listUserPlaylists({ accessToken: 'sp-token' });

    expect(playlists).toHaveLength(2);
    expect(playlists[0]?.trackCount).toBe(42);
    expect(playlists[1]?.trackCount).toBe(10);
  });

  it('lê faixas no schema 2026 (items.items[].item), pagina next e ignora episódios', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/playlists/pl-1')) {
        return new Response(
          JSON.stringify({
            id: 'pl-1',
            name: 'Rock BR',
            items: {
              total: 2,
              items: [
                {
                  item: {
                    id: 'sp-t1',
                    type: 'track',
                    name: 'Tempo Perdido',
                    duration_ms: 300_000,
                    artists: [{ name: 'Legião Urbana' }],
                    external_ids: { isrc: 'BRBMG8600001' },
                  },
                },
                {
                  item: {
                    id: 'ep-1',
                    type: 'episode',
                    name: 'Podcast Episódio',
                    duration_ms: 900_000,
                  },
                },
              ],
              next: 'https://api.spotify.com/v1/playlists/pl-1/items?offset=2',
            },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          items: [
            {
              item: {
                id: 'sp-t2',
                type: 'track',
                name: 'Pais e Filhos',
                duration_ms: 306_000,
                artists: [{ name: 'Legião Urbana' }],
              },
            },
          ],
          next: null,
        }),
        { status: 200 },
      );
    });

    const adapter = new SpotifyAdapter(fetchMock, 0);
    const playlist = await adapter.getPlaylistWithTracks('pl-1', { accessToken: 'sp-token' });

    expect(playlist.trackCount).toBe(2);
    expect(playlist.tracks).toHaveLength(2);
    expect(playlist.tracks.map((t) => t.id)).toEqual(['sp-t1', 'sp-t2']);
  });

  it('informa erro claro quando Spotify omite items/tracks em playlist de terceiros', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          id: 'pl-public-other',
          name: 'Top Brasil',
        }),
        { status: 200 },
      );
    });

    const adapter = new SpotifyAdapter(fetchMock, 0);
    await expect(
      adapter.getPlaylistWithTracks('pl-public-other', { accessToken: 'sp-token' }),
    ).rejects.toThrow(/somente playlists criadas por você ou colaborativas/i);
  });

  it('busca faixa por ISRC e limita searchTracks a no máximo 10 resultados', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push(url);
      expect((init?.headers as Headers).get('Authorization')).toBe('Bearer sp-token');

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
      isrc: 'GBUM71029604',
    });

    await adapter.searchTracks('Queen Bohemian Rhapsody', 25, { accessToken: 'sp-token' });
    expect(calls[1]).toContain('limit=10');
  });

  it('cria playlist via /me/playlists e adiciona faixas via /playlists/{id}/items', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/me/playlists')) {
        return new Response(JSON.stringify({ id: 'pl-created' }), { status: 200 });
      }
      return new Response(JSON.stringify({ snapshot_id: 'snap-1' }), { status: 200 });
    });

    const adapter = new SpotifyAdapter(fetchMock, 0);
    const created = await adapter.createPlaylist({ name: 'Sync Playlist' }, { accessToken: 'tok' });
    await adapter.addTracksToPlaylist(created.id, ['t1', 't2'], { accessToken: 'tok' });

    expect(created.id).toBe('pl-created');
    expect(calls).toEqual([
      'https://api.spotify.com/v1/me/playlists',
      'https://api.spotify.com/v1/playlists/pl-created/items',
    ]);
  });
});
