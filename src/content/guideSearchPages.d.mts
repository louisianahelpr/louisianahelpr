export type SearchAge = "baby" | "3-5" | "6-8" | "9-12" | "teens";
export interface SearchMatch {
  under?: number;
  atLeast?: number;
  types?: string[];
  ages?: SearchAge[];
  louisiana?: true;
}
export interface SearchPage {
  slug: string;
  guides: string[];
  lead: string;
  name: string;
  h1: string;
  title: string;
  description: string;
  intro: string;
  match: SearchMatch;
}
export const SEARCH_PAGE_MIN_PICKS: number;
export const SEARCH_PAGES: SearchPage[];
export function searchPageBySlug(slug: string): SearchPage | null;
export function searchPagesOf(guide: string): SearchPage[];
export function searchPageParent(page: SearchPage): string | null;
export const SEARCH_GUIDE_NAMES: Record<string, string>;
export function searchPageSiblings(page: SearchPage, n?: number): SearchPage[];
export function searchPageMeta(page: SearchPage): import("../lib/publicPageMeta.mjs").PublicPageMeta;
