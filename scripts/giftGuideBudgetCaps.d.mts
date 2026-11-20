/** Types for scripts/giftGuideBudgetCaps.mjs (the gift guides' budget-section price caps, gg-live-1120). */
type Pick = Record<string, unknown> & { name: string; href: string; section?: string; sectionId?: string; price?: number };
export const BUDGET_SECTION_CAPS: Record<string, number>;
export function applyBudgetCaps(
  pageList: Record<string, Pick[]>,
  spec?: { adds?: { guide: string; section: string; href: string; from?: string }[] },
): { counts: { moved: number; out: number; added: number }; missing: string[] };
