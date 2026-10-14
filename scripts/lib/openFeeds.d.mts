export const FINDINGS: string;
export const SNAPSHOT: string;
export function snapshotText(prevText: string | null, snap: Record<string, unknown>): string;
export const FEEDS_HEADING: string;
export interface RobotMember { workflow: string; issue: number | null; run: string | null; runUnknown: boolean; keys: string[] }
export interface FeedSource { keys: string[]; title: string; origin: string; markers: string[]; tier?: "HIGH" | "MEDIUM" | "LOW"; robots?: RobotMember[] }
export function tierOf(severity: unknown): "HIGH" | "MEDIUM" | "LOW";
export function queueItems(md: string): { id: string; state: string; start: number; end: number; text: string }[];
export function tagsOf(text: string): string[];
export function mirrored(md: string): Map<string, string[]>;
export function mirrorProblems(openKeys: string[], md: string): { missing: string[]; doubled: string[] };
export function feedCounts(md: string): { ledger: number; issue: number; bus: number; robots: number };
export const ROBOTS_MARK: string;
export const ROBOTS_GUARD: string;
export function isRobotsItem(text: string): boolean;
export function robotMembersOf(text: string): { workflow: string; issue: number | null; line: string }[];
export function robotsTitle(n: number): string;
export function newestRunUrl(texts: (string | null | undefined)[]): string | null;
export function busSources(text: string): FeedSource[];
export function busStatus(text: string): Map<string, "open" | "closed">;
export const LEDGER_SQL: string;
export function ledgerMarker(fp: string): string;
export function groupSources(input: { ledger?: unknown[]; issues?: unknown[] }): FeedSource[];
export function openAlertIssues(
  list: (label: string) => { number: number; title: string; body?: string; comments?: { body?: string }[] }[] | null | undefined,
): { number: number; title: string; label: string; run?: string | null; runTruncated?: boolean }[];
export function applyFeeds(
  md: string,
  groups: FeedSource[],
  opts: { status: (key: string) => "open" | "closed" | null; nextFree: number; today: string; robotsReadable?: boolean },
): { md: string; created: { id: string; keys: string[] }[]; attached: { id: string; keys: string[]; seenAgain?: boolean }[]; flipped: string[]; ambiguous: { keys: string[]; ids: string[] }[]; robots: { id: string; members: number; created: boolean }[] };
export function isFeedMirrored(text: string): boolean;
