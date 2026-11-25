import type { MappingCacheLookup, TrackMapping } from '../domain/mapping.js';

export interface IMappingCacheRepository {
  /** Busca se já conhecemos o ID correspondente no serviço de destino */
  getMapping(lookup: MappingCacheLookup): Promise<string | null>;
  /** Salva o pareamento para evitar chamadas de busca redundantes no futuro */
  setMapping(mapping: TrackMapping): Promise<void>;
}
