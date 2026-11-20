/** Types for src/content/giftGuideMerges.mjs (the 1120 guide merges and kept store pages). */
export const SECTION_CAP: number;
export const GUIDE_MERGES: readonly { parent: string; sections: readonly string[] }[];
export const STORE_PAGES_KEPT: readonly string[];
export const NEW_PARENTS: readonly string[];
export const MERGED_INTO: Readonly<Record<string, { parent: string; index: number }>>;
export function isFoldedStore(slug: string): boolean;
