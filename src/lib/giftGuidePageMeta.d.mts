/** Types for src/lib/giftGuidePageMeta.mjs (the gift guides page and api/share.ts). */
import type { PublicPageMeta } from "./publicPageMeta.mjs";
export function giftGuidePageMeta(slug: string, fallbackTitle?: string): PublicPageMeta & { robots?: string };
export function publicOrGiftGuidePageMetaFor(
  pathname: string,
  tabParam: string | null | undefined,
): (PublicPageMeta & { robots?: string }) | null;
