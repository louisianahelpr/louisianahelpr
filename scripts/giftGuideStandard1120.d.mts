/** Types for scripts/giftGuideStandard1120.mjs (the owner 11-20 standard pass). */
export const SPONSOR_HOME_GUIDES: Set<string>;
export function findPick<T extends { name: string; href?: string }>(list: T[], used: { has(p: T): boolean }, want: { name: string; href?: string }): T | undefined;
export function applyStandard(
  pageList: Record<string, any[]>,
  spec: any,
  ctx?: any,
): { counts: Record<string, number>; missing: any[]; extras: any[]; kept: any; aliases: Record<string, any> };
export {};
