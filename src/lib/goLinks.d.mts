/** Types for src/lib/goLinks.mjs (api/go.ts, scripts/go-links.mjs, src/test/goLinks.test.ts). */
export interface GoLink { url: string; label?: string }
export type GoLinkMap = Readonly<Record<string, GoLink>>;
export const GO_LINK_HOSTS: readonly string[];
export const GO_FALLBACK_URL: string;
export const GO_SLUG_RE: RegExp;
export const GO_SLUG_MAX: number;
export const AMAZON_HOST_RE: RegExp;
export function isGoSlug(slug: unknown): slug is string;
export function isAllowedGoTarget(url: unknown): boolean;
export function goTargetFor(slug: unknown, map: GoLinkMap | null | undefined): string;
export function slugify(text: unknown, max?: number): string;
