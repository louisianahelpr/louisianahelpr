// Run `fn` over `items` with at most `limit` in flight at once.
//
// Daily sweeps that did one job at a time (three REST round trips each, ~1–3s
// per job on prod) outran pg_net's 30s budget: review-nag-cron and
// stalled-completion-reminder both logged "Cron HTTP timeout" on 2026-09-23
// (ledger 0813c5f8, 25d66912). Each job's work is independent, so a small pool
// keeps the run inside the budget without a burst the database would notice.
// A rejection from `fn` rejects the whole call, as a throw inside the old
// `for` loop did.
export const SWEEP_CONCURRENCY = 8;

export async function forEachBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
