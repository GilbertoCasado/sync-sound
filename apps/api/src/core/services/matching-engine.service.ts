import type { MatchResult, Track, TrackMetadata } from '@syncsound/shared';
import levenshtein from 'fast-levenshtein';
import type { IMappingCacheRepository } from '../ports/mapping-cache.port.js';
import type { IMusicProvider, ProviderCredentials } from '../ports/music-provider.port.js';
import { MetadataCleaner, type VersionTag } from './metadata-cleaner.service.js';

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const LOW_CONFIDENCE_THRESHOLD = 0.65;
export const TITLE_WEIGHT = 0.6;
export const ARTIST_WEIGHT = 0.4;

export interface CandidateScore {
  score: number;
  reason: string;
}

export class MatchingEngine {
  constructor(
    private readonly cacheRepository: IMappingCacheRepository,
    private readonly cleaner: MetadataCleaner = new MetadataCleaner(),
  ) {}

  stringSimilarity(a: string, b: string): number {
    if (a === b) {
      return 1;
    }
    if (!a || !b) {
      return 0;
    }
    const distance = levenshtein.get(a, b);
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : Math.max(0, 1 - distance / maxLen);
  }

  scoreCandidate(source: TrackMetadata, candidate: Track): CandidateScore {
    const sourceTitle = this.cleaner.cleanTitle(source.title);
    const sourceArtists = this.cleaner.cleanArtists(source.artists, sourceTitle.featuredArtists);

    const candidateTitle = this.cleaner.cleanTitle(candidate.title);
    const candidateArtists = this.cleaner.cleanArtists(
      candidate.artists,
      candidateTitle.featuredArtists,
    );

    let bestBaseScore = this.computeWeightedTextScore(
      sourceTitle.normalized,
      sourceArtists,
      candidateTitle.normalized,
      candidateArtists,
    );
    let effectiveCandidateVersionTags = candidateTitle.versionTags;

    // Vídeos do YouTube frequentemente trazem título no formato "Artista - Música"
    const separatorMatch = candidate.title.match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (separatorMatch) {
      const left = separatorMatch[1] ?? '';
      const right = separatorMatch[2] ?? '';

      const leftAsArtistTitle = this.cleaner.cleanTitle(right);
      const leftAsArtist = this.cleaner.cleanArtists([left], leftAsArtistTitle.featuredArtists);
      const scoreArtistFirst = this.computeWeightedTextScore(
        sourceTitle.normalized,
        sourceArtists,
        leftAsArtistTitle.normalized,
        leftAsArtist,
      );

      const rightAsArtistTitle = this.cleaner.cleanTitle(left);
      const rightAsArtist = this.cleaner.cleanArtists([right], rightAsArtistTitle.featuredArtists);
      const scoreTitleFirst = this.computeWeightedTextScore(
        sourceTitle.normalized,
        sourceArtists,
        rightAsArtistTitle.normalized,
        rightAsArtist,
      );

      if (scoreArtistFirst > bestBaseScore) {
        bestBaseScore = scoreArtistFirst;
        effectiveCandidateVersionTags = leftAsArtistTitle.versionTags;
      }
      if (scoreTitleFirst > bestBaseScore) {
        bestBaseScore = scoreTitleFirst;
        effectiveCandidateVersionTags = rightAsArtistTitle.versionTags;
      }
    }

    const reasons: string[] = [];
    let score = bestBaseScore;

    if (this.hasVersionMismatch(sourceTitle.versionTags, effectiveCandidateVersionTags)) {
      score -= 0.25;
      reasons.push('divergência de versão');
    }

    if (source.durationMs > 0 && candidate.durationMs > 0) {
      const diffMs = Math.abs(source.durationMs - candidate.durationMs);
      const durationPenalty = this.calculateDurationPenalty(diffMs, candidate.platform);
      if (durationPenalty > 0) {
        score -= durationPenalty;
        reasons.push(`diferença de duração (${Math.round(diffMs / 1000)}s)`);
      }
    }

    const clamped = Math.max(0, Math.min(1, score));
    const rounded = Math.round(clamped * 100) / 100;

    return {
      score: rounded,
      reason:
        reasons.length > 0
          ? `Similaridade textual ${Math.round(bestBaseScore * 100)}% com penalidade: ${reasons.join(', ')}`
          : `Similaridade textual ${Math.round(bestBaseScore * 100)}%`,
    };
  }

  async matchTrack(
    sourceTrack: Track,
    targetProvider: IMusicProvider,
    targetCredentials?: ProviderCredentials,
  ): Promise<MatchResult> {
    const targetPlatform = targetProvider.platform;

    // 1. Consulta cache local/PostgreSQL (chave composta inclui targetPlatform)
    const cachedTargetId = await this.cacheRepository.getMapping({
      targetPlatform,
      isrc: sourceTrack.isrc,
      sourcePlatform: sourceTrack.platform,
      sourceTrackId: sourceTrack.id,
    });

    if (cachedTargetId) {
      return {
        sourceTrack,
        targetTrack: {
          id: cachedTargetId,
          platform: targetPlatform,
          title: sourceTrack.title,
          artists: sourceTrack.artists,
          album: sourceTrack.album,
          durationMs: sourceTrack.durationMs,
          isrc: sourceTrack.isrc,
        },
        confidence: 'exact',
        strategy: 'cache',
        score: 1,
        reason: 'Correspondência recuperada do cache de mapeamento.',
      };
    }

    // 2. Busca direta por ISRC no destino
    if (sourceTrack.isrc) {
      const isrcMatch = await targetProvider.searchByIsrc(sourceTrack.isrc, targetCredentials);
      if (isrcMatch) {
        await this.cacheRepository.setMapping({
          isrc: sourceTrack.isrc,
          sourcePlatform: sourceTrack.platform,
          sourceTrackId: sourceTrack.id,
          targetPlatform,
          targetTrackId: isrcMatch.id,
          similarityScore: 1,
        });

        return {
          sourceTrack,
          targetTrack: isrcMatch,
          confidence: 'exact',
          strategy: 'isrc',
          score: 1,
          reason: `Match exato via ISRC (${sourceTrack.isrc}).`,
        };
      }
    }

    // 3. Busca textual + similaridade fuzzy
    const query = this.cleaner.buildSearchQuery(sourceTrack);
    const candidates = await targetProvider.searchTracks(query, 10, targetCredentials);

    let bestCandidate: Track | null = null;
    let bestScore: CandidateScore = { score: 0, reason: 'Nenhum candidato retornado pela busca.' };

    for (const candidate of candidates) {
      const scored = this.scoreCandidate(sourceTrack, candidate);
      if (scored.score > bestScore.score) {
        bestScore = scored;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore.score >= HIGH_CONFIDENCE_THRESHOLD) {
      await this.cacheRepository.setMapping({
        isrc: sourceTrack.isrc,
        sourcePlatform: sourceTrack.platform,
        sourceTrackId: sourceTrack.id,
        targetPlatform,
        targetTrackId: bestCandidate.id,
        similarityScore: bestScore.score,
      });

      return {
        sourceTrack,
        targetTrack: bestCandidate,
        confidence: 'high',
        strategy: 'fuzzy',
        score: bestScore.score,
        reason: bestScore.reason,
      };
    }

    if (bestCandidate && bestScore.score >= LOW_CONFIDENCE_THRESHOLD) {
      return {
        sourceTrack,
        targetTrack: bestCandidate,
        confidence: 'low',
        strategy: 'fuzzy',
        score: bestScore.score,
        reason: bestScore.reason,
      };
    }

    return {
      sourceTrack,
      targetTrack: null,
      confidence: 'not_found',
      strategy: 'none',
      score: bestScore.score,
      reason: bestCandidate
        ? `Melhor candidato abaixo do limiar (${bestScore.score}): ${bestCandidate.title}`
        : 'Nenhuma faixa compatível encontrada na plataforma de destino.',
    };
  }

  private computeWeightedTextScore(
    sourceTitleNorm: string,
    sourceArtists: { primary: string; all: string[] },
    candidateTitleNorm: string,
    candidateArtists: { primary: string; all: string[] },
  ): number {
    const titleSim = this.stringSimilarity(sourceTitleNorm, candidateTitleNorm);

    let artistSim = this.stringSimilarity(sourceArtists.primary, candidateArtists.primary);
    for (const candArtist of candidateArtists.all) {
      const sim = this.stringSimilarity(sourceArtists.primary, candArtist);
      if (sim > artistSim) {
        artistSim = sim;
      }
    }

    return titleSim * TITLE_WEIGHT + artistSim * ARTIST_WEIGHT;
  }

  private hasVersionMismatch(sourceTags: VersionTag[], candidateTags: VersionTag[]): boolean {
    if (sourceTags.length === 0 && candidateTags.length === 0) {
      return false;
    }
    if (sourceTags.length !== candidateTags.length) {
      return true;
    }
    return sourceTags.some((tag, index) => candidateTags[index] !== tag);
  }

  private calculateDurationPenalty(diffMs: number, platform: Track['platform']): number {
    if (platform === 'youtube') {
      if (diffMs <= 10_000) {
        return 0;
      }
      if (diffMs <= 45_000) {
        const ratio = (diffMs - 10_000) / 35_000;
        return 0.02 + ratio * 0.1;
      }
      return 0.35;
    }

    if (diffMs <= 5_000) {
      return 0;
    }
    if (diffMs <= 15_000) {
      const ratio = (diffMs - 5_000) / 10_000;
      return 0.05 + ratio * 0.2;
    }
    return 0.45;
  }
}
