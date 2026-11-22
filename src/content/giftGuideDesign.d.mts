/** Types for src/content/giftGuideDesign.mjs (same brand, same design, same price together; owner 2026-11-22). */
export function designWords(row: { name?: unknown; brand?: unknown }): Set<string>;
export function designTogether<T>(items: readonly T[], view: (item: T) => { name?: unknown; brand?: unknown; price?: unknown }): T[];
