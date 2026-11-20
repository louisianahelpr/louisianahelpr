/** Types for scripts/giftGuideTrain1120b.mjs (the gift guides' train 1120b last pass). */
type Pick = Record<string, unknown> & { name: string; brand?: string; href?: string; section?: string; sectionId?: string; commission?: number | null; type?: string; sponsor?: boolean };
type Rule = Record<string, unknown> & { match?: string; exact?: boolean; section?: string; guide?: string };
export const STORE_MIN: number;
export function fold(s: unknown): string;
export function matches(p: { name: string; brand?: string }, rule: Rule): boolean;
export function placeInSection<T extends Record<string, unknown>>(list: T[], pick: Record<string, unknown>, sectionTitle?: string, keepFrom?: boolean): T[];
export function isBrandPick(p: { name: string; brand?: string }, brand: string): boolean;
export function applyTrain1120b(
  pageList: Record<string, Pick[]>,
  deals: Record<string, unknown[]>,
  spec: Record<string, unknown>,
  ctx: { sponsorsGuide: string; readJson: (file: string) => unknown; sales?: unknown[]; storePages?: string[] },
): { counts: Record<string, unknown>; missing: string[] };
export function applyDealsPage1120b<T extends Record<string, unknown>>(deals: T[], dp: Record<string, unknown> | undefined): { deals: T[]; missing: string[] };
