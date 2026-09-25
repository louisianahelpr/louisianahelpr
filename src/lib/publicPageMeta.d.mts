/** Types for src/lib/publicPageMeta.mjs (shared by the SPA and api/share.ts). */
export type LegalTab = "terms" | "community" | "privacy";

export interface PublicPageMeta {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
}

export const SITE_ORIGIN: string;
export const LEGAL_TABS: readonly LegalTab[];
export const LEGAL_PATH_TAB: Readonly<Record<string, LegalTab>>;
export function resolveLegalTab(pathname: string, tabParam: string | null | undefined): LegalTab;
export const LEGAL_PAGE_META: Readonly<
  Record<LegalTab, { title: string; description: string; canonical: string }>
>;
export const PUBLIC_PAGE_META: Readonly<Record<"/browse" | "/help" | "/support", PublicPageMeta>>;
export function legalPageMeta(tab: LegalTab): PublicPageMeta;
export function publicPageMetaFor(
  pathname: string,
  tabParam: string | null | undefined,
): PublicPageMeta | null;
