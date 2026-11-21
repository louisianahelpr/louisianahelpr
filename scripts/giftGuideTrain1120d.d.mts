/** Types for scripts/giftGuideTrain1120d.mjs (holiday design audit A: type fixes, page caps, thin sections). */
type Pick = Record<string, unknown> & { name: string; brand?: string; href: string; type?: string; section?: string; sectionId?: string; price?: number; commission?: number | null; sponsor?: true; ownerPick?: true; from?: string };
export const TYPE_FIXES: [RegExp, string, string[]][];
export const BRAND_TYPE_FREE: Set<string>;
export function typeFix(p: { name: string; type?: string }): string | null;
export function applyTrain1120d(
  pageList: Record<string, Pick[]>,
  spec: Record<string, unknown>,
  ctx: { sponsorsGuide: string; anchors?: Record<string, string>; parentOf?: (slug: string) => string | undefined; fixedOrder?: string[] },
): { counts: Record<string, number>; missing: string[]; aliases: Record<string, Record<string, string>> };
