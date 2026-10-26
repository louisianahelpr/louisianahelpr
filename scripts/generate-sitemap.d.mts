/**
 * Types for scripts/generate-sitemap.mjs, so src/test/publicSiteFilesValid.test.ts
 * can render the generator's real output (its XML comments included) instead of
 * reading only the committed public/sitemap.xml. Same pattern as
 * scripts/back-control-inventory.d.mts.
 */
export function render(paths: string[], unweighted: string[]): string;
export function normalize(xml: string): { path: string; changefreq: string; priority: string }[];
export function parseRoutes(src: string): unknown;
export function classify(...args: unknown[]): unknown;
/** Public-but-not-indexable route -> the reason it is excluded. */
export const NOINDEX: Record<string, string>;
export const WEIGHTS: Record<string, { changefreq: string; priority: string }>;
