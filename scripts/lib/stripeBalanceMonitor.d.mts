export const FLOOR_CENTS: number;
export const MULTIPLIER: number;
export const WINDOW_HOURS: number;
export interface BalanceResult {
  status: "ok" | "low" | "unreadable";
  threshold: number | null;
  availableCents: number | null;
  upcomingCents: number | null;
}
export function thresholdCents(upcomingCents: number | null | undefined): number;
export function evaluateBalance(r: { availableCents: number | null | undefined; upcomingCents: number | null | undefined }): BalanceResult;
export function parseAvailableUsdCents(body: unknown): number;
export const UPCOMING_SQL: string;
export function dollars(cents: number): string;
export const LOW_TITLE: string;
export const UNREADABLE_TITLE: string;
export const TOP_UP_HOW: string;
export function lowSample(res: BalanceResult, upcomingJobs?: number | null): string;
