/*
 * CLASS GUARD: an HTTP cron's Supabase reads cannot hang past pg_net's budget.
 *
 * THE BUG (ops ledger 17942da9, "Cron HTTP timeout: arrival-confirm-reminder
 * ... 30000 ms", 2026-09-25 17:34Z, pg_net request 2593, attributed by request
 * id): the function booted in 42ms, its one REST read (the jobs scan, 0 rows)
 * reached the API gateway 42s later and PostgREST answered it in 59ms
 * (edge_logs response.origin_time); function_edge_logs execution_time_ms was
 * 42,840. Every other run in the 6h pg_net window took 0.01–0.15s. Nothing
 * bounded the outbound read, so one stalled request outlived pg_net's 30s.
 * (The ledger's other 9 rows, 2026-09-19..23, are 5000ms/400ms timeouts filed
 * by start-time proximity before Q174 tagged request ids; they are not this
 * cron's 30s budget.)
 *
 * THE FIX: supabase/functions/_shared/boundedFetch.ts gives GET/HEAD a
 * per-attempt deadline and retries on a fresh request; writes pass through.
 *
 * THE CLASS, from the migrations (src/test/helpers/cronHttpJobs.ts): every
 * edge function an HTTP cron calls. Each builds its client with
 * `global: { fetch: boundedFetch() }`, except the EXACT legacy list below,
 * which fails in both directions (convert one and it must leave the list).
 *
 * @mutate supabase/functions/_shared/boundedFetch.ts | for (let attempt = 1; attempt <= readAttempts; attempt++) { | for (let attempt = 1; attempt <= 1; attempt++) {
 * @mutate supabase/functions/_shared/boundedFetch.ts | const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline; | const signal = callerSignal;
 * @mutate supabase/functions/_shared/boundedFetch.ts | if (method !== "GET" && method !== "HEAD") return impl(input, init); | if (method === "HEAD") return impl(input, init);
 * @mutate supabase/functions/_shared/boundedFetch.ts | if (callerSignal?.aborted) throw e; | if (false) throw e;
 * @mutate supabase/functions/_shared/boundedFetch.ts |     stalled.name = "AbortError"; |     stalled.name = "Error";
 * @mutate supabase/functions/arrival-confirm-reminder/index.ts | createClient(supabaseUrl, serviceRoleKey, { global: { fetch: boundedFetch() } }) | createClient(supabaseUrl, serviceRoleKey)
 * @mutate supabase/functions/review-nag-cron/index.ts | createClient(supabaseUrl, serviceKey, { global: { fetch: boundedFetch() } }) | createClient(supabaseUrl, serviceKey)
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | createClient(supabaseUrl, serviceRoleKey, { global: { fetch: boundedFetch() } }) | createClient(supabaseUrl, serviceRoleKey)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { httpCronJobs } from "@/test/helpers/cronHttpJobs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { boundedFetch, CRON_READ_ATTEMPT_MS, CRON_READ_ATTEMPTS } from "../../supabase/functions/_shared/boundedFetch";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");

/**
 * HTTP-cron functions not yet on boundedFetch. Shrink only. 24 on 2026-09-26;
 * 0 on 2026-10-05 (Q592: all 24 converted; boundedFetch bounds and retries
 * GET/HEAD only, writes pass through untouched, which is what made the seven
 * money paths safe to convert after an lh-money-escrow review).
 */
// @two-way src/test/cronReadsCannotHang.test.ts:stale baseline entry in LEGACY_UNBOUNDED
const LEGACY_UNBOUNDED = new Set<string>([]);

function cronFunctions(): string[] {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
  const fns = new Set<string>();
  for (const [name, call] of httpCronJobs(files)) fns.add(/functions\/v1\/([a-z0-9-]+)/.exec(call.args)?.[1] ?? name);
  return [...fns].sort();
}

const usesBoundedFetch = (fn: string) => {
  const src = blankComments(readFileSync(join(ROOT, "supabase", "functions", fn, "index.ts"), "utf8"));
  return /createClient\([^;]*global:\s*\{\s*fetch:\s*boundedFetch\(/.test(src);
};

describe("HTTP crons bound their reads", () => {
  const fns = cronFunctions();

  it("the inventory is real (cannot pass vacuously)", () => {
    // 26 HTTP crons on 2026-09-23 (cronHttpRequestsAreTagged), each calling its own function.
    expect(fns.length).toBeGreaterThan(20);
    expect(fns).toContain("arrival-confirm-reminder");
    for (const fn of fns) expect(existsSync(join(ROOT, "supabase", "functions", fn, "index.ts")), fn).toBe(true);
  });

  it("every HTTP-cron function builds its client with boundedFetch, except the exact legacy list", () => {
    const unbounded = fns.filter((fn) => !usesBoundedFetch(fn));
    expect(unbounded.filter((fn) => !LEGACY_UNBOUNDED.has(fn)), "new unbounded HTTP-cron function(s)").toEqual([]);
    const stale = [...LEGACY_UNBOUNDED].filter((fn) => !unbounded.includes(fn));
    expect(
      stale,
      stale.map((fn) => `stale baseline entry in LEGACY_UNBOUNDED: ${fn} — remove it (lower the baseline); it is converted or no longer an HTTP cron`).join("\n"),
    ).toEqual([]);
  });
});

describe("boundedFetch", () => {
  const ok = () => new Response("ok", { status: 200 });
  /** Never answers until aborted, like the stalled request on 2026-09-25. */
  const stall = (signal?: AbortSignal | null) =>
    new Promise<Response>((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
    });

  it("defaults fit inside pg_net's 30s budget", () => {
    expect(CRON_READ_ATTEMPTS).toBeGreaterThan(1);
    expect(CRON_READ_ATTEMPT_MS * CRON_READ_ATTEMPTS).toBeLessThan(30_000);
  });

  it("a stalled read is abandoned and retried on a fresh request", async () => {
    let calls = 0;
    const f = boundedFetch({
      attemptMs: 30,
      readAttempts: 3,
      fetchImpl: (_i, init) => (++calls === 1 ? stall(init?.signal) : Promise.resolve(ok())),
    });
    const t0 = Date.now();
    const res = await f("https://x.test/rest/v1/jobs?select=id", { method: "GET" });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a read that stalls every time fails fast with a named error", async () => {
    let calls = 0;
    const f = boundedFetch({ attemptMs: 20, readAttempts: 3, fetchImpl: (_i, init) => (calls++, stall(init?.signal)) });
    await expect(f("https://x.test/rest/v1/jobs?select=id")).rejects.toThrow(/read stalled: GET https:\/\/x\.test\/rest\/v1\/jobs got no response in 3 attempts/);
    expect(calls).toBe(3);
  });

  it("the exhausted read is an AbortError, so the client does not retry it 3 more times (Q592 review)", async () => {
    const f = boundedFetch({ attemptMs: 10, readAttempts: 2, fetchImpl: (_i, init) => stall(init?.signal) });
    const err = await f("https://x.test/rest/v1/jobs?select=id").catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    // postgrest-js rethrows an AbortError at once and retries anything else
    // (node_modules/@supabase/postgrest-js fetchWithRetry): pin both halves.
    const pg = readFileSync(join(ROOT, "node_modules/@supabase/postgrest-js/dist/index.cjs"), "utf8");
    expect(pg).toMatch(/\.name\) === "AbortError"[^\n]*throw fetchError/);
  });

  it("a write is passed through once, with no deadline of its own", async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const f = boundedFetch({
      attemptMs: 10,
      fetchImpl: async (_i, init) => {
        calls++;
        signal = init?.signal;
        await new Promise((r) => setTimeout(r, 40));
        return ok();
      },
    });
    const res = await f("https://x.test/rest/v1/job_arrival_confirm_nudges", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect(signal ?? null).toBeNull();
  });

  it("a caller's own abort is not retried", async () => {
    let calls = 0;
    const ac = new AbortController();
    const f = boundedFetch({ attemptMs: 1000, readAttempts: 3, fetchImpl: (_i, init) => (calls++, stall(init?.signal)) });
    const p = f("https://x.test/rest/v1/jobs", { method: "GET", signal: ac.signal });
    ac.abort(new Error("caller cancelled"));
    await expect(p).rejects.toThrow("caller cancelled");
    expect(calls).toBe(1);
  });
});
