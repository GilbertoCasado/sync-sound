import type { TrackMetadata } from '@syncsound/shared';

export type VersionTag =
  | 'live'
  | 'remix'
  | 'acoustic'
  | 'instrumental'
  | 'cover'
  | 'sped_up';

export interface CleanedTitle {
  raw: string;
  searchTitle: string;
  normalized: string;
  versionTags: VersionTag[];
  featuredArtists: string[];
}

export interface CleanedArtists {
  primary: string;
  displayPrimary: string;
  all: string[];
}

const VERSION_PATTERNS: Array<{ tag: VersionTag; regex: RegExp }> = [
  { tag: 'live', regex: /\b(live|ao\s+vivo|en\s+vivo|unplugged)\b/i },
  { tag: 'remix', regex: /\b(remix|rmx|club\s+mix|dub\s+mix|vip\s+mix|rework)\b/i },
  { tag: 'acoustic', regex: /\b(acoustic|acustico|acustica)\b/i },
  { tag: 'instrumental', regex: /\b(instrumental|karaoke)\b/i },
  { tag: 'cover', regex: /\b(cover|tribute)\b/i },
  { tag: 'sped_up', regex: /\b(sped\s+up|slowed|nightcore|8d\s+audio)\b/i },
];

const NOISE_BRACKET_KEYWORDS =
  /\b(remaster(?:ed)?|official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visualizer)|lyric\s+video|lyrics|audio|visualizer|mv|m\/v|hd|4k|hq|full\s+song|radio\s+edit|single\s+version|album\s+version|original\s+mix|deluxe(?:\s+edition)?|anniversary(?:\s+edition)?|expanded(?:\s+edition)?|bonus\s+track|explicit|clean\s+version|mono|stereo)\b/i;

const DASH_NOISE_SUFFIX =
  /\s+[-–—]\s+(?:\d{4}\s+)?(?:remaster(?:ed)?(?:\s+\d{4})?|radio\s+edit|single\s+version|album\s+version|original\s+mix|official\s+(?:music\s+)?(?:video|audio)|lyric\s+video|explicit|bonus\s+track)\b.*$/i;

const BRACKET_VERSION_TERMS =
  /\b(live|ao\s+vivo|en\s+vivo|unplugged|remix|rmx|club\s+mix|dub\s+mix|vip\s+mix|rework|acoustic|acustico|acustica|instrumental|karaoke|cover|tribute|sped\s+up|slowed|nightcore|8d\s+audio)\b/i;

const DASH_VERSION_SUFFIX =
  /\s+[-–—]\s+(?:live(?:\s+at\s+.*)?|ao\s+vivo(?:\s+.*)?|en\s+vivo(?:\s+.*)?|unplugged|.*?\b(?:remix|rmx|club\s+mix|dub\s+mix|vip\s+mix|rework)\b.*|acoustic|acustico|acustica|instrumental|karaoke|sped\s+up|slowed(?:\s+\+\s+reverb)?|nightcore)$/i;

export class MetadataCleaner {
  /**
   * Normaliza texto com decomposição Unicode NFD, remove diacríticos,
   * converte para minúsculas e padroniza conectores e pontuações.
   */
  normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[&+]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extrai marcadores semânticos de versão que não devem ser ignorados no matching.
   */
  extractVersionTags(rawTitle: string): VersionTag[] {
    const normalizedForTags = rawTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const tags = new Set<VersionTag>();
    for (const { tag, regex } of VERSION_PATTERNS) {
      if (regex.test(normalizedForTags)) {
        tags.add(tag);
      }
    }

    return Array.from(tags).sort();
  }

  cleanTitle(rawTitle: string): CleanedTitle {
    const versionTags = this.extractVersionTags(rawTitle);
    const featuredArtists: string[] = [];

    let working = rawTitle.trim();

    // Extrai participações entre parênteses ou colchetes: (feat. X), [ft. Y]
    working = working.replace(
      /[\(\[]\s*(?:feat\.?|ft\.?|featuring|with|part\.?)\s+([^\)\]]+)[\)\]]/gi,
      (_match, featured: string) => {
        featuredArtists.push(...this.splitArtistString(featured));
        return ' ';
      },
    );

    // Extrai participações no final da string: "Song feat. X"
    working = working.replace(/\s+(?:feat\.?|ft\.?|featuring|part\.?)\s+(.+)$/gi, (_m, featured: string) => {
      featuredArtists.push(...this.splitArtistString(featured));
      return ' ';
    });

    // Remove colchetes/parênteses puramente de ruído, preservando marcadores de versão
    working = working.replace(/[\(\[]([^\)\]]+)[\)\]]/g, (full, inner: string) => {
      const innerNormalized = inner
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (BRACKET_VERSION_TERMS.test(innerNormalized)) {
        return full;
      }
      if (NOISE_BRACKET_KEYWORDS.test(innerNormalized) || /^\d{4}$/.test(innerNormalized.trim())) {
        return ' ';
      }
      return full;
    });

    // Remove sufixos após travessão/hífen que indicam remasterização ou edição promocional
    working = working.replace(DASH_NOISE_SUFFIX, ' ');
    const searchTitle = working.replace(/\s+/g, ' ').trim();

    // Para comparação base, remove também os marcadores explícitos de versão já capturados em versionTags
    let baseTitle = searchTitle.replace(/[\(\[]([^\)\]]+)[\)\]]/g, (full, inner: string) => {
      const innerNormalized = inner
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return BRACKET_VERSION_TERMS.test(innerNormalized) ? ' ' : full;
    });

    const baseNormCheck = baseTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (DASH_VERSION_SUFFIX.test(baseNormCheck)) {
      baseTitle = baseNormCheck.replace(DASH_VERSION_SUFFIX, ' ');
    }

    const normalized = this.normalizeText(baseTitle);

    return {
      raw: rawTitle,
      searchTitle: searchTitle || rawTitle.trim(),
      normalized,
      versionTags,
      featuredArtists: this.dedupeStrings(featuredArtists),
    };
  }

  cleanArtists(artists: string[], extraFeatured: string[] = []): CleanedArtists {
    const cleanedEntries: string[] = [];

    for (const rawArtist of artists) {
      const sanitized = rawArtist
        .replace(/\s*-\s*topic$/i, '')
        .replace(/\s*vevo$/i, '')
        .trim();
      if (!sanitized) {
        continue;
      }
      cleanedEntries.push(...this.splitArtistString(sanitized));
    }

    for (const feat of extraFeatured) {
      const sanitized = feat.trim();
      if (sanitized) {
        cleanedEntries.push(...this.splitArtistString(sanitized));
      }
    }

    const displayPrimary = cleanedEntries[0] ?? artists[0]?.trim() ?? '';
    const primary = this.normalizeText(displayPrimary);
    const all = this.dedupeStrings(
      cleanedEntries.map((entry) => this.normalizeText(entry)).filter(Boolean),
    );

    return {
      primary,
      displayPrimary,
      all: all.length > 0 ? all : primary ? [primary] : [],
    };
  }

  buildSearchQuery(track: TrackMetadata): string {
    const cleanedTitle = this.cleanTitle(track.title);
    const cleanedArtists = this.cleanArtists(track.artists, cleanedTitle.featuredArtists);

    const parts = [cleanedArtists.displayPrimary, cleanedTitle.searchTitle].filter(Boolean);
    const normalizedSearch = this.normalizeText(cleanedTitle.searchTitle);

    const searchableVersionTags: Array<'live' | 'remix' | 'acoustic' | 'instrumental'> = [
      'live',
      'remix',
      'acoustic',
      'instrumental',
    ];

    for (const tag of searchableVersionTags) {
      if (cleanedTitle.versionTags.includes(tag) && !normalizedSearch.includes(tag)) {
        parts.push(tag);
      }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private splitArtistString(input: string): string[] {
    return input
      .split(/\s*(?:,|;|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private dedupeStrings(items: string[]): string[] {
    return Array.from(new Set(items));
  }
}
