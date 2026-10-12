import type { DisputeRecord } from "./types";

/**
 * One CURRENT dispute record per job (on a re-file, the most recent) and the
 * job's EARLIER ones, newest first (Q1327: a re-file keeps the old row, the
 * Helpr's answer archived on it, and the admin card shows them as history).
 */
export function groupDisputeRecords(rows: readonly DisputeRecord[]): {
  current: Record<string, DisputeRecord>;
  earlier: Record<string, DisputeRecord[]>;
} {
  const current: Record<string, DisputeRecord> = {};
  const earlier: Record<string, DisputeRecord[]> = {};
  const newestFirst = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const r of newestFirst) {
    if (!current[r.job_id]) current[r.job_id] = r;
    else (earlier[r.job_id] ??= []).push(r);
  }
  return { current, earlier };
}
