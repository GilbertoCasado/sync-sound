declare module 'fast-levenshtein' {
  export interface LevenshteinOptions {
    useCollator?: boolean;
  }

  const levenshtein: {
    get(str1: string, str2: string, options?: LevenshteinOptions): number;
  };

  export default levenshtein;
}
