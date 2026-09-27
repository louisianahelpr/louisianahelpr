export const FINDINGS: string;
export const SNAPSHOT: string;
export const FEEDS_HEADING: string;
export interface FeedSource { keys: string[]; title: string; origin: string; markers: string[] }
export function queueItems(md: string): { id: string; state: string; start: number; end: number; text: string }[];
export function tagsOf(text: string): string[];
export function mirrored(md: string): Map<string, string[]>;
export function mirrorProblems(openKeys: string[], md: string): { missing: string[]; doubled: string[] };
export function feedCounts(md: string): { ledger: number; issue: number; bus: number };
export function busSources(text: string): FeedSource[];
export function busStatus(text: string): Map<string, "open" | "closed">;
export const LEDGER_SQL: string;
export function ledgerMarker(fp: string): string;
export function groupSources(input: { ledger?: unknown[]; issues?: unknown[] }): FeedSource[];
export function applyFeeds(
  md: string,
  groups: FeedSource[],
  opts: { status: (key: string) => "open" | "closed" | null; nextFree: number; today: string },
): { md: string; created: { id: string; keys: string[] }[]; attached: { id: string; keys: string[] }[]; flipped: string[] };
