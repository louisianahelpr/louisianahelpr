/** Types for scripts/giftGuideSectionAudit1120.mjs (the 11-20 section audit's removals, renames, prices and links). */
type Pick = Record<string, unknown> & { name?: string };
export const GONE_1120: [RegExp, string][];
export const GONE_IN_GUIDE_1120: Record<string, [RegExp, string][]>;
export const RENAMED_1120: [RegExp, string, string?, string?][];
export const PRICED_1120: [RegExp, number, string, number][];
export const RELINKED_1120: [RegExp, Record<string, unknown>, string[]?][];
export function auditFix1120<T extends Pick>(slug: string, p: T): T | undefined;
