/** Types for src/content/giftGuideSmallBiz.mjs (the Small Business Saturday page). */
export interface SmallBiz {
  slug: string;
  name: string;
  town: string;
  category: string;
  description: string;
  /** The best gift idea, in plain words (never a price). */
  gift: string;
  /** "Visit": the website, else the Facebook Page, else Instagram; absent when the business has no link. */
  href?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  /** /gift-guides/small-biz/<slug>.<ext> (none when the business gave no logo or declined its use). */
  logo?: string;
  ships: "ships" | "local";
}
export const SMALL_BIZ_SLUG: string;
export const SHOP_SMALL_GUIDE: string;
export const SMALL_BIZ_FEATURE_FROM: string;
export const SMALL_BIZ_FEATURE_TO: string;
export const SMALL_BIZ_RETITLE_AFTER: string;
export const SMALL_BIZ_CATEGORIES: readonly string[];
export const SMALL_BIZ_WORDS: {
  title: string;
  laterTitle: string;
  lead: string;
  intro: string;
  badge: string;
  facebook: string;
  instagram: string;
  website: string;
  ships: string;
  local: string;
  guideLink: string;
  featuredLine: string;
  featuredCta: string;
  loading: string;
  failed: string;
  none: string;
};
export function smallBizDay(now: Date): string;
export function smallBizFeatured(today: string): boolean;
export function smallBizTitle(today: string): string;
export function smallBizSections<T extends { category: string }>(rows: readonly T[]): { category: string; rows: T[] }[];
export function giftLine(name: string, gift: string | null | undefined): string;
