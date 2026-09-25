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
export type NoindexPath =
  | "/login"
  | "/signup"
  | "/forgot-password"
  | "/reset-password"
  | "/signup-pending"
  | "/account-banned";
export interface NoindexPageMeta extends PublicPageMeta {
  robots: string;
}
export const NOINDEX_ROBOTS: string;
export const NOINDEX_PAGE_META: Readonly<Record<NoindexPath, NoindexPageMeta>>;
export function noindexPageMetaFor(pathname: string): NoindexPageMeta | null;
export function publicPageMetaFor(
  pathname: string,
  tabParam: string | null | undefined,
): PublicPageMeta | null;
