import { describe, expect, it, vi } from 'vitest';
import { DeezerAdapter } from './deezer.adapter.js';

describe('DeezerAdapter', () => {
  it('lê playlist pública e pagina faixas sem exigir OAuth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/playlist/908622995')) {
        return new Response(
          JSON.stringify({
            id: 908622995,
            title: 'Deezer Top',
            nb_tracks: 2,
            tracks: {
              data: [
                {
                  id: 11,
                  title: 'Track 1',
                  duration: 210,
                  artist: { name: 'Artist 1' },
                },
              ],
              next: 'https://api.deezer.com/playlist/908622995/tracks?index=1',
            },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          data: [
            {
              id: 22,
              title: 'Track 2',
              duration: 185,
              isrc: 'BR1234567890',
              artist: { name: 'Artist 2' },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const adapter = new DeezerAdapter(fetchMock, 0);
    const playlist = await adapter.getPlaylistWithTracks(
      'https://www.deezer.com/br/playlist/908622995',
    );

    expect(playlist.name).toBe('Deezer Top');
    expect(playlist.tracks).toHaveLength(2);
    expect(playlist.tracks[0]?.durationMs).toBe(210_000);
    expect(playlist.tracks[1]?.isrc).toBe('BR1234567890');
  });

  it('retorna null quando Deezer responde erro 800 na busca por ISRC', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { type: 'DataException', message: 'no data', code: 800 } }), {
          status: 200,
        }),
    );

    const adapter = new DeezerAdapter(fetchMock, 0);
    const track = await adapter.searchByIsrc('USRC17607839');
    expect(track).toBeNull();
  });
});
