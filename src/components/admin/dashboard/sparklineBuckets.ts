/**
 * A 10-point sparkline series across the `windowDays` ending at `now`, newest
 * bucket last. Rows outside the window or with no usable timestamp are
 * silently dropped — the bucket math is forgiving so a few bad rows don't
 * skew the chart. Each row counts 1, or `valueFn(row)` when given.
 */
export function sparklineBuckets<R extends { ts?: string | null }>(
  rows: R[] | undefined | null,
  now: Date,
  windowDays: number,
  valueFn?: (row: R) => number,
): number[] {
  const buckets = Array(10).fill(0);
  if (!rows) return buckets;
  const nowMs = now.getTime();
  const startMs = nowMs - windowDays * 86400000;
  const span = windowDays * 86400000;
  for (const r of rows) {
    const ts = r.ts;
    if (!ts) continue;
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
    const idx = Math.min(9, Math.max(0, Math.floor(((t - startMs) / span) * 10)));
    buckets[idx] += valueFn ? valueFn(r) : 1;
  }
  return buckets;
}
