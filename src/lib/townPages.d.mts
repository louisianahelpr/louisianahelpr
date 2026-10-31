/** Types for src/lib/townPages.mjs (shared by the SPA, api/share.ts and the sitemap generator). */
export interface TownPageTown { slug: string; name: string }
export interface TownPageService { category: string; label: string; phrase: string; slug: string }
export interface TownPageMeta {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  geoRegion: string;
  geoPlacename: string;
}
export const TOWN_PAGE_TOWNS: readonly TownPageTown[];
export const TOWN_PAGE_SERVICES: readonly TownPageService[];
export function townPagePath(service: { slug: string }, town: { slug: string }): string;
export function findTownPage(serviceSlug: string | undefined, townSlug: string | undefined): { service: TownPageService; town: TownPageTown } | null;
export function allTownPagePaths(): string[];
export function townPageMeta(service: TownPageService, town: TownPageTown): TownPageMeta;
export function townPageMetaFor(pathname: string): TownPageMeta | null;
