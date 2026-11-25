import { describe, expect, it } from 'vitest';
import { MetadataCleaner } from './metadata-cleaner.service.js';

describe('MetadataCleaner', () => {
  const cleaner = new MetadataCleaner();

  it('normaliza acentos Unicode e pontuação preservando termos base', () => {
    expect(cleaner.normalizeText('Legião Urbana & Paralamas!')).toBe('legiao urbana paralamas');
    expect(cleaner.normalizeText('Café Tacvba — Eres')).toBe('cafe tacvba eres');
  });

  it('remove ruídos como Remastered, Official Video e extrai participações', () => {
    const cleaned = cleaner.cleanTitle(
      'Bohemian Rhapsody (2011 Remastered) [Official Music Video] (feat. Elton John)',
    );

    expect(cleaned.searchTitle).toBe('Bohemian Rhapsody');
    expect(cleaned.normalized).toBe('bohemian rhapsody');
    expect(cleaned.versionTags).toEqual([]);
    expect(cleaned.featuredArtists).toEqual(['Elton John']);
  });

  it('preserva marcadores de versão como Ao Vivo, Live, Remix e Acoustic', () => {
    const aoVivo = cleaner.cleanTitle('Tempo Perdido (Ao Vivo)');
    const live = cleaner.cleanTitle('Tempo Perdido - Live');
    const remix = cleaner.cleanTitle('Midnight City [Eric Prydz Private Remix]');

    expect(aoVivo.versionTags).toEqual(['live']);
    expect(live.versionTags).toEqual(['live']);
    expect(aoVivo.normalized).toBe('tempo perdido');
    expect(live.normalized).toBe('tempo perdido');
    expect(remix.versionTags).toEqual(['remix']);
  });

  it('limpa sufixos do YouTube (- Topic / VEVO) nos artistas e monta query limpa', () => {
    const artists = cleaner.cleanArtists(['Daft Punk - Topic', 'Pharrell Williams']);
    expect(artists.displayPrimary).toBe('Daft Punk');
    expect(artists.primary).toBe('daft punk');

    const query = cleaner.buildSearchQuery({
      title: 'Tempo Perdido (Ao Vivo) [Official Video]',
      artists: ['Legião Urbana - Topic'],
      durationMs: 300_000,
    });

    expect(query).toBe('Legião Urbana Tempo Perdido (Ao Vivo) live');
  });
});
