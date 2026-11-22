/** Types for scripts/gift-guide-small-biz.mjs (the Small Business Saturday section's generator; its test reads the rule). */
export const TRACKER_NAME: Record<string, string>;
export const HELD: Set<string>;
export function cleanText(s: unknown): string;
export function confirmedLocal(slug: string, order: { value: Record<string, number>; notConfirmed: string[]; national: string[] }): boolean;
export function shipsFor(b: { slug: string; category: string; shipping?: unknown }): "ships" | "local";
export function cardName(name: unknown): string;
export function cardTown(town: unknown): string;
