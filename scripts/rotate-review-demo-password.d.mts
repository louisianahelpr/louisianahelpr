export const REVIEWER_EMAIL: string;
export const SECRET_NAME: string;
type Freeze = { frozen?: unknown; version?: string; build?: number } | null;
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export function refusal(a: { apply: boolean; freeze: Freeze }): string | null;
export function newPassword(bytes?: (n: number) => Buffer): string;
export function findUserId(a: { fetchImpl: FetchLike; url: string; key: string; email?: string }): Promise<string | null>;
export function rotate(a: {
  apply: boolean;
  freeze: Freeze;
  fetchImpl: FetchLike;
  url: string;
  key: string | null | undefined;
  setSecret: (password: string) => { ok: boolean; why?: string };
  writeBackup: (password: string) => string;
  gen?: () => string;
}): Promise<{ code: number; lines: string[] }>;
