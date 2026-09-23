export interface Quota {
  id: string;
  service: string;
  name: string;
  limit: number | null;
  unit: string;
  window: string;
  read: "sql" | "logs" | "github" | "sentry" | null;
  env: string;
  why?: string;
  limitSource: string;
}
export type QuotaStatus = "ok" | "warn" | "over" | "unreadable" | "not-monitored";
export interface QuotaRow {
  q: Quota;
  limit: number | null;
  used: number | null;
  status: QuotaStatus;
  pct: number | null;
  note: string;
}
export interface Reading {
  value?: number;
  error?: string;
  note?: string;
}
export const WARN_AT: number;
export const QUOTAS: Quota[];
export function effectiveLimit(q: Quota, env?: Record<string, string | undefined>, live?: Record<string, number>): number | null;
export function grade(used: number, limit: number | null, warnAt?: number): { status: "ok" | "warn" | "over" | "unreadable"; pct: number | null };
export function evaluateQuotas(
  readings: Record<string, Reading>,
  opts?: { env?: Record<string, string | undefined>; live?: Record<string, number>; warnAt?: number; quotas?: Quota[] },
): { rows: QuotaRow[]; alerts: QuotaRow[]; unreadable: QuotaRow[]; notMonitored: QuotaRow[]; summary: string; report: string };
export function alertTitle(row: QuotaRow): string;
export function unreadableTitle(row: QuotaRow): string;
