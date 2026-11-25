import { describe, expect, it, vi } from 'vitest';
import { YouTubeAdapter } from './youtube.adapter.js';

describe('YouTubeAdapter', () => {
  it('ignora searchByIsrc para economizar cota diária', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = new YouTubeAdapter(fetchMock, 0);

    const hit = await adapter.searchByIsrc('USRC17607839', { accessToken: 'yt-tok' });
    expect(hit).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca vídeos musicais e hidrata durações via videos.list', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/search?')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: { videoId: 'vid-1' },
                snippet: {
                  title: 'Daft Punk - Instant Crush',
                  channelTitle: 'Daft Punk - Topic',
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'vid-1',
              contentDetails: { duration: 'PT5M37S' },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const adapter = new YouTubeAdapter(fetchMock, 0);
    const tracks = await adapter.searchTracks('Daft Punk Instant Crush', 5, {
      accessToken: 'yt-tok',
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.durationMs).toBe(337_000);
    expect(tracks[0]?.platform).toBe('youtube');
  });
});
