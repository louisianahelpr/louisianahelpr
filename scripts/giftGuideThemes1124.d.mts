/** Types for scripts/giftGuideThemes1124.mjs (the themed kids gift guides, owner 11-24). */
export interface ThemeRow1124 { id: string; name: string; brand: string; line: string; href: string; image: string; store: string; price: number; priceAt: string; section: string; sectionId: string; was?: number; commission?: number; code?: string; age?: string }
export interface ThemeRowsFile1124 { slug: string; name: string; sectionPrefix: string; builtFrom: string; rows: ThemeRow1124[]; skipped: { id: string; name: string; why: string[] }[] }
export const THEME_ROWS_FILES_1124: Readonly<Record<string, ThemeRowsFile1124>>;
export function themeRows1124(slug: string): readonly ThemeRow1124[];
export function themePicks1124(slug: string, rows?: readonly ThemeRow1124[]): (Omit<ThemeRow1124, "id" | "was" | "age"> & { ownerPick: true; from: string })[];
export function applyThemeGuides1124(pageList: Record<string, unknown[]>): Record<string, number>;
export function isAmazonRow(r: { store: string; href: string }): boolean;
