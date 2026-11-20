/** Types for src/content/giftGuideMerges.mjs (the 1120 guide merges and kept store pages). */
export const SECTION_CAP: number;
export const SECTION_MIN: number;
export const SECTION_MAX: number;
export const SECTION_GROUPS: Readonly<Record<string, { own?: string; groups: { id: string; title: string; from: string[] }[]; pins?: { name: RegExp; group: string }[] }>>;
export const BASE_MERGES: readonly { parent: string; sections: readonly string[] }[];
export const NO_LIST_SECTIONS: readonly string[];
export const GUIDE_MERGES: readonly { parent: string; sections: readonly string[] }[];
export const STORE_PAGES_KEPT: readonly string[];
export const NEW_PARENTS: readonly string[];
export const MERGED_INTO: Readonly<Record<string, { parent: string; index: number }>>;
export const STORE_PAGES_HELD: string[];
export function isFoldedStore(slug: string): boolean;
