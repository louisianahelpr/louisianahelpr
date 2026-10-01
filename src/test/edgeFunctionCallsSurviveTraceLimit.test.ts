/**
 * Supabase throttles function-to-function calls per trace: the fetch THROWS a
 * RateLimitError with `retryAfterMs`. On 2026-09-29 16:26Z review-nag-cron hit
 * it after ~25 sequential send-notification-email calls, dropped 6 review
 * emails and answered 500 (ops ledger bea47b14 / 4a759fc3). Class: every edge
 * function that awaits a call to another of our edge functions. Each goes
 * through _shared/functionFetch.ts, which waits `retryAfterMs` and retries.
 * The only raw fetches left are the two fire-and-forget kicks listed below,
 * whose daily/5-minute cron is the retry.
 *
 * @mutate supabase/functions/review-nag-cron/index.ts | await fetchFunction(`${supabaseUrl}/functions/v1/send-notification-email` | await fetch(`${supabaseUrl}/functions/v1/send-notification-email`
 * @mutate supabase/functions/review-nag-cron/index.ts | }, { deadlineAt: invocationDeadline(startedAt) }); | });
 * @mutate supabase/functions/_shared/functionFetch.ts |       if (wait === null \|\| attempt >= maxRetries \|\| now() + wait + 250 > deadlineAt) throw err; |       throw err;
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_MS, fetchFunction, invocationDeadline } from "../../supabase/functions/_shared/functionFetch";
import { blankComments } from "./helpers/blankNonCode";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const files = walk("supabase/functions");
const CALL = /\bfetch\(\s*`[^`]*\/functions\/v1\//g;
const rawCalls = files.flatMap((f) => {
  const src = blankComments(readFileSync(f, "utf8"));
  return [...src.matchAll(CALL)].map(() => f);
});
const guarded = files.filter((f) => /\bfetchFunction\(\s*`[^`]*\/functions\/v1\//.test(readFileSync(f, "utf8")));

// Fire-and-forget kicks: never awaited, each has a cron that does the work if
// the kick is throttled.
const FIRE_AND_FORGET = [
  "supabase/functions/_shared/kick-email-queue.ts",
  "supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts",
];

function rateLimitError(retryAfterMs: number) {
  return Object.assign(new Error(`Rate limit exceeded for trace x. Retry after ${retryAfterMs}ms.`), {
    name: "RateLimitError",
    retryAfterMs,
  });
}

describe("edge-to-edge calls survive the per-trace rate limit", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(guarded.length).toBeGreaterThanOrEqual(5);
  });

  it("no awaited raw fetch to another edge function remains", () => {
    expect([...new Set(rawCalls)].sort()).toEqual([...FIRE_AND_FORGET].sort());
  });

  it("waits retryAfterMs and retries instead of dropping the call", async () => {
    const waits: number[] = [];
    let calls = 0;
    const res = await fetchFunction("https://x/functions/v1/y", {}, {
      fetchImpl: (async () => {
        calls++;
        if (calls === 1) throw rateLimitError(54_486);
        return new Response("ok");
      }) as typeof fetch,
      sleep: async (ms) => { waits.push(ms); },
    });
    expect(await res.text()).toBe("ok");
    expect(calls).toBe(2);
    expect(waits[0]).toBeGreaterThanOrEqual(54_486);
  });

  it("rethrows other errors at once, and gives up after maxRetries", async () => {
    await expect(fetchFunction("u", {}, {
      fetchImpl: (async () => { throw new TypeError("network"); }) as typeof fetch,
      sleep: async () => {},
    })).rejects.toThrow("network");
    let calls = 0;
    await expect(fetchFunction("u", {}, {
      maxRetries: 2,
      fetchImpl: (async () => { calls++; throw rateLimitError(10); }) as typeof fetch,
      sleep: async () => {},
    })).rejects.toThrow("Rate limit");
    expect(calls).toBe(3);
  });

  it("never waits past the deadline: one ~55 s wait fits the default budget, two do not", async () => {
    let clock = 1_000_000;
    let calls = 0;
    await expect(fetchFunction("u", {}, {
      now: () => clock,
      fetchImpl: (async () => { calls++; throw rateLimitError(54_486); }) as typeof fetch,
      sleep: async (ms) => { clock += ms; },
    })).rejects.toThrow("Rate limit");
    expect(calls).toBe(2);
    expect(DEFAULT_BUDGET_MS).toBeLessThan(150_000);
    calls = 0;
    await expect(fetchFunction("u", {}, {
      now: () => clock,
      deadlineAt: clock + 10_000,
      fetchImpl: (async () => { calls++; throw rateLimitError(54_486); }) as typeof fetch,
      sleep: async () => { throw new Error("must not wait"); },
    })).rejects.toThrow("Rate limit");
    expect(calls).toBe(1);
  });

  it("every cron passes its invocation deadline, which ends inside the 150 s gateway timeout", () => {
    expect(invocationDeadline(0)).toBeLessThan(150_000);
    for (const fn of ["review-nag-cron", "arrival-confirm-reminder", "stalled-completion-reminder"]) {
      const src = blankComments(readFileSync(`supabase/functions/${fn}/index.ts`, "utf8"));
      expect(src, fn).toMatch(/\{\s*deadlineAt:\s*invocationDeadline\(startedAt\)\s*\}/);
      expect(src, fn).toMatch(/const startedAt = Date\.now\(\);/);
    }
  });
});
