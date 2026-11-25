/** Types for src/lib/giftGuidePageMeta.mjs (the gift guides page and api/share.ts). */
import type { PublicPageMeta } from "./publicPageMeta.mjs";
export function giftGuidePageMeta(
  slug: string,
  fallbackTitle?: string,
  topNames?: readonly string[],
  count?: number,
  themePicks?: readonly import("../content/themeGuideSearch.mjs").ThemeSearchPick[] | null,
  today?: string,
): PublicPageMeta & { robots?: string };
export const GUIDE_LEAD_PICKS: Readonly<Record<string, readonly string[]>>;
export function dealDayPageMeta(day: import("../content/giftGuideDeals.mjs").DealEvent): PublicPageMeta;
export function giftGuideDescription(name: string, topNames: readonly string[] | undefined, count: number): string | null;
export function publicOrGiftGuidePageMetaFor(
  pathname: string,
  tabParam: string | null | undefined,
): (PublicPageMeta & { robots?: string }) | null;
