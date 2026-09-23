export type ExpiryStatus = "OK" | "DUE" | "EXPIRED" | "NO_EXPIRY" | "UNREADABLE";
export interface InventoryItem {
  id: string;
  label: string;
  env?: string[];
  hosts?: string[];
  literal?: { file: string; text: string };
  sourceOfTruth: string;
  read: { method: string; [key: string]: unknown };
  ciReadable: boolean;
}
export interface Inventory {
  warnDays?: number;
  items: InventoryItem[];
  undated: Record<string, string>;
}
export interface Reading {
  expiresAt?: string | null;
  noExpiry?: boolean;
  detail: string;
  source?: string;
}
export interface ExpiryResult {
  id: string;
  label: string;
  status: ExpiryStatus;
  expiresAt: string | null;
  daysLeft: number | null;
  detail: string;
  source: string;
  ciReadable: boolean;
}
export interface Verdict {
  fail: boolean;
  due: ExpiryResult[];
  unreadable: ExpiryResult[];
  blind: ExpiryResult[];
  summary: string;
}
export interface InventoryDiff {
  unclassified: string[];
  unreferenced: string[];
  duplicated: string[];
  hostsWithoutTls: string[];
  tlsWithoutReference: string[];
  missingLiteral: string[];
}
export const DAY_MS: number;
export const FAILING: Set<string>;
export const INVENTORY: string;
export function classify(expiresAt: string | Date, now: Date, warnDays: number): { status: ExpiryStatus; daysLeft: number | null };
export function evaluate(item: InventoryItem, reading: Reading | null | undefined, now: Date, warnDays: number): ExpiryResult;
export function verdict(results: ExpiryResult[], opts?: { ci?: boolean }): Verdict;
export function renderReport(results: ExpiryResult[], v: Verdict, now: Date, warnDays: number): string;
export function referencedNames(root: string, blank?: (src: string) => string): Map<string, string[]>;
export function referencedHosts(root: string): Map<string, string[]>;
export function inventoryDiff(inv: Inventory, names: Map<string, string[]>, hosts: Map<string, string[]>, root: string): InventoryDiff;
export function jwtExp(token: string | null | undefined): string | null;
export function readTls(host: string, opts?: { timeoutMs?: number; connect?: unknown }): Promise<Reading>;
export function readRdap(domain: string, fetchFn?: typeof fetch): Promise<Reading>;
export function ascToken(env: Record<string, string | undefined>, now?: Date): string | null;
export function readItem(item: InventoryItem, opts?: { env?: Record<string, string | undefined>; root?: string; fetchFn?: typeof fetch; tlsConnect?: unknown }): Promise<Reading>;
export function loadInventory(root: string): Inventory;
export function runAll(inv: Inventory, now: Date, opts?: { env?: Record<string, string | undefined>; root?: string; fetchFn?: typeof fetch; warnDays?: number }): Promise<{ results: ExpiryResult[]; warnDays: number }>;
export interface InventoryCounts { items: number; measured: number; ciReadable: number; noExpiry: number; manualDated: number; manualNoDate: number; undated: number }
export function inventoryCounts(inv: Inventory): InventoryCounts;
export interface ScoreboardRow { group: string; signal: string; status: string; pass: null; fail: null; skipped: null; total: string | null; at: string; source: string; note: string }
export function scoreboardRows(results: ExpiryResult[], at: string): ScoreboardRow[];
