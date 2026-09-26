// boundedFetch — a fetch for a cron function's Supabase client whose READS
// cannot hang past the caller's budget.
//
// MEASURED (prod, 2026-09-25 17:34Z, arrival-confirm-reminder, pg_net request
// 2593): the function booted at 17:34:00.8 (42ms boot), and its first and only
// REST read (the jobs scan, 0 rows) reached the API gateway at 17:34:42.97,
// where PostgREST answered in 59ms (edge_logs response.origin_time). The run
// took 42,840ms (function_edge_logs execution_time_ms), all of it waiting on
// that one outbound request, so pg_net gave up at its 30,000ms timeout and the
// cron was filed as "Cron HTTP timeout". Every other run in the 6h pg_net
// window finished in 0.01–0.15s. The work was not slow; one outbound call
// stalled and nothing bounded it.
//
// So a GET/HEAD gets a per-attempt deadline and is retried on a fresh request
// (a read is safe to repeat). A write is passed through untouched: timing out
// a write that did land would lose the notification its claim guards, which
// is worse than a late answer.
export const CRON_READ_ATTEMPT_MS = 6000;
export const CRON_READ_ATTEMPTS = 3;

type FetchFn = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

export function boundedFetch(opts: { attemptMs?: number; readAttempts?: number; fetchImpl?: FetchFn } = {}): FetchFn {
  const attemptMs = opts.attemptMs ?? CRON_READ_ATTEMPT_MS;
  const readAttempts = Math.max(1, opts.readAttempts ?? CRON_READ_ATTEMPTS);
  return async (input, init) => {
    const impl: FetchFn = opts.fetchImpl ?? ((i, n) => fetch(i, n));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") return impl(input, init);

    const callerSignal = init?.signal ?? undefined;
    let last: unknown;
    for (let attempt = 1; attempt <= readAttempts; attempt++) {
      const deadline = AbortSignal.timeout(attemptMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
      try {
        return await impl(input, { ...init, signal });
      } catch (e) {
        // The caller cancelled: that is not a stall, so do not retry it.
        if (callerSignal?.aborted) throw e;
        last = e;
      }
    }
    const url = input instanceof Request ? input.url : String(input);
    throw new Error(
      `read stalled: ${method} ${url.split("?")[0]} got no response in ${readAttempts} attempts of ${attemptMs}ms` +
        ` (last: ${(last as Error)?.message ?? String(last)})`,
    );
  };
}
