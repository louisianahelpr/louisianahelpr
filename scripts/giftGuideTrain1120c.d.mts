/** Types for scripts/giftGuideTrain1120c.mjs (the gift guides' train 1120c pass, after 1120b). */
type Pick = Record<string, unknown> & { name: string; brand?: string; href?: string; section?: string; price?: number; code?: string; codeEnds?: string };
export function applyTrain1120c(
  pageList: Record<string, Pick[]>,
  deals: Record<string, unknown[]>,
  spec: Record<string, unknown>,
  ctx: { sponsorsGuide: string; readJson: (file: string) => unknown; sales?: unknown[]; storePages?: string[] },
): { counts: Record<string, unknown>; missing: string[] };
