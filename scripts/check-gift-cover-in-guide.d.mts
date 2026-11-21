/** Types for scripts/check-gift-cover-in-guide.mjs (every cover product is in its guide). */
type Pick = { name: string; image?: string; href?: string; store?: string };
type Manifest = Record<string, { section?: string; items?: { name: string; key?: string; image?: string }[] }>;
export const MANIFEST: string;
export const PICKS_DIR: string;
export function isAmazonPhoto(u?: string): boolean;
export function guidePicks(slug: string, dir?: string): Pick[];
export function coverStrays(manifest: Manifest, picksOf?: (slug: string) => Pick[]): string[];
