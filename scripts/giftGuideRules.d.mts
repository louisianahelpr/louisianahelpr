/** Types for scripts/giftGuideRules.mjs. */
export const PROMO_NAME: RegExp;
export const OLD_YEAR: RegExp;
export const GENERIC_SEGMENT: RegExp;
export const EXPERIENCE: RegExp;
export const GIFT_CARD: RegExp;
export const NOT_A_GIFT: RegExp;
export const BRAND_CASE: Record<string, string>;
export const NOT_LOUISIANA_BUSINESS: RegExp;
export const EXPERIENCE_GUIDES: string[];
export const KNIFE_OK_GUIDES: string[];
export function domainName(s: string): boolean;
export function productName(raw: unknown, names: unknown[], host?: string): string | null;
export function brokenImage(u: string): boolean;
export function fitsGuide(slug: string, p: { name: string }): boolean;
export const CATEGORY_NAME: RegExp;
