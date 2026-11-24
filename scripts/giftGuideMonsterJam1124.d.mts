/** Types for scripts/giftGuideMonsterJam1124.mjs (the Monster Jam gift guide, owner 11-24). */
export interface MonsterJamRow1124 { id: string; name: string; brand: string; line: string; href: string; image: string; store: string; price: number; priceAt: string; section: string; sectionId: string; was?: number; commission?: number; code?: string; age?: string }
export const MONSTER_JAM_GUIDE: "monster-jam";
export const MONSTER_JAM_ROWS_1124: readonly MonsterJamRow1124[];
export function monsterJamPicks1124(): (Omit<MonsterJamRow1124, "id" | "was" | "age"> & { ownerPick: true; from: "monster-jam" })[];
export function isAmazonRow(r: { store: string; href: string }): boolean;
export function collageRows1124<R extends { store: string; href: string } = MonsterJamRow1124>(rows?: readonly R[]): R[];
