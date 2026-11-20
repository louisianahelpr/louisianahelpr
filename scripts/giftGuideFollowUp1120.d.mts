/** Types for scripts/giftGuideFollowUp1120.mjs (the gift guides' follow-up train 1120 rules). */
type Finding = { file: string; guide: string; section: string; item: string; href: string; fix: string; problem: string; move_to: string };
type Pick = { name?: string; brand?: string; href?: string; commission?: number | null; sponsor?: boolean };
export const GIFT_CARD: RegExp;
export const MEMBERSHIP: RegExp;
export const AUDIT_FILES_1120: string[];
export const SPONSOR_SECTIONS_1120: { id: string; title: string; categories: string[] }[];
export function readAudits1120(readJson: (file: string) => unknown): Finding[];
export function storeCopyOf(problem: string): string;
export function moveTarget(from: string, moveTo: string): { guide: string; section: string } | null;
export function renameOf(row: Finding, currentName: string, brand?: string): string | null;
export function brandFirst(name: string, brand?: string): string;
export function auditActions1120(rows: Finding[], oldSlug: (guide: string, section: string) => string | null): {
  cuts: { slug: string; href: string; item: string }[];
  storeCuts: Set<string>;
  moves: { href: string; from: string; to: string }[];
  renames: Map<string, Finding>;
  counts: Record<string, number>;
};
export function zeroSwaps1120(readJson: (file: string) => unknown): {
  cuts: { guide: string; section: string; href: string; item: string }[];
  adds: { guide: string; section: string; row: Record<string, unknown> }[];
};
export function louisianaAdds1120(readJson: (file: string) => unknown): { guide: string; section: string; row: Record<string, unknown>; file: string }[];
export function followUpOut(p: Pick, opts: { sponsor: (p: Pick) => boolean; kept: (p: Pick) => boolean }): string;
