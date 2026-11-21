/** Types for scripts/giftGuideHolidayB1120.mjs (the gift guides' holiday audit B pass, after train 1120c). */
type Pick = Record<string, unknown> & { name: string; brand?: string; href?: string; line?: string; image?: string; section?: string; sectionId?: string; sponsor?: boolean };
export const NOTE_WORDS: RegExp;
export const RATING_WORDS: RegExp;
export function shopperLine(line: string | undefined | null): string;
export function cleanName(name: string, brand?: string): string;
export function applyHolidayB1120(
  pageList: Record<string, Pick[]>,
  deals: Record<string, unknown[]>,
  spec: Record<string, unknown>,
  ctx: {
    sponsorsGuide: string;
    readJson: (file: string) => unknown;
    sales?: { store: string; offer?: string; href?: string }[];
    storePages?: string[];
    nameOnly?: { guide: string; brand: string }[];
    dealCodes?: { store: string; offer?: string }[];
    lineup?: string[];
    blockedBrand?: (row: { brand?: string; name?: string }) => unknown;
  },
): { counts: Record<string, unknown>; missing: string[] };
