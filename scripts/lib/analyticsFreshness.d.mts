export interface KeyEvent {
  event: string;
  label: string;
  windowDays: number;
  ground: string | null;
}
export type FreshnessStatus = "ok" | "degraded" | "broken" | "quiet" | "unverified" | "unreadable";
export interface FreshnessRow {
  event: string;
  window_days?: number;
  events: number | string | null;
  test_events?: number | string | null;
  last_event_at?: string | null;
  real_actions: number | string | null;
  test_actions?: number | string | null;
}
export interface FreshnessResult {
  k: KeyEvent;
  row: FreshnessRow | undefined;
  status: FreshnessStatus;
}
export const DEGRADED_RATIO: number;
export const DEGRADED_MIN: number;
export const KEY_EVENTS: KeyEvent[];
export const MISSING_MILESTONES: Record<string, string>;
export const NOT_MONITORED: Record<string, string>;
export function freshnessSql(events?: KeyEvent[]): string;
export function classify(row: FreshnessRow | undefined, hasGround: boolean, opts?: { ratio?: number; min?: number }): FreshnessStatus;
export function evaluateFreshness(
  rows: FreshnessRow[] | unknown,
  events?: KeyEvent[],
): { results: FreshnessResult[]; alerts: FreshnessResult[]; unreadable: FreshnessResult[]; summary: string; report: string };
export function alertTitle(r: FreshnessResult): string;
