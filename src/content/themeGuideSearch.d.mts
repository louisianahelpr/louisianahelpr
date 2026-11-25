/** Types for src/content/themeGuideSearch.mjs (the themed kids guides' search words). */
export interface ThemeSearchPick {
  name: string;
  price?: number;
  priceAt?: string;
  priceFrom?: boolean;
  /** The store's shown name ("Walmart"). */
  store?: string;
}
export interface ThemeGuideFacts {
  count: number;
  priced: number;
  min: number | null;
  max: number | null;
  topName: string;
  stocking: number;
  kinds: string[];
  stores: string[];
}
export declare const THEME_TITLE_MAX: number;
export declare const THEME_DESCRIPTION_MAX: number;
export declare const KINDS: readonly (readonly [string, RegExp, RegExp?])[];
export declare function giftKind(name: string): string;
export declare function themeGuideFacts(picks: readonly ThemeSearchPick[], count: number, today: string): ThemeGuideFacts;
export declare function themeGuideSearch(
  name: string,
  picks: readonly ThemeSearchPick[],
  count: number,
  today: string,
  opts?: { deals?: boolean },
): { title: string; description: string; ogTitle: string; intro: string } | null;
