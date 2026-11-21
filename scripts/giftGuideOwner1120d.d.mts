/** Types for scripts/giftGuideOwner1120d.mjs (the owner 11-20 phone fixes' fill pass). */
type Pick = Record<string, unknown> & { name: string; brand?: string; href?: string; section?: string; price?: number };
export function applyOwner1120d(pageList: Record<string, Pick[]>, spec: { adds?: { guide: string; section: string; row: Pick }[] }): { counts: Record<string, number>; missing: string[] };
