/**
 * The AI provider's brief overload is retried in place (owner, 2026-10-09).
 *
 * MEASURED on prod 2026-10-09 11:59:24Z: Gemini answered 503 "This model is
 * currently experiencing high demand", ai-job-builder returned 500, and the
 * poster saw a red "busy, try again" toast; their own retry 12s later worked.
 * Now the function retries 500/502/503 up to twice before answering (each
 * attempt time-limited, a 30s retry deadline, jittered waits), and never
 * retries 429/402/504 or a thrown error (which may already have been billed).
 *
 * The handler test runs the REAL function through the edge harness with the
 * Gemini call stubbed: 503 then a good answer must reach the poster as 200.
 *
 * @mutate supabase/functions/ai-job-builder/retry.ts | export const RETRY_DELAYS_MS = [800, 1600]; | export const RETRY_DELAYS_MS: number[] = [];
 * @mutate supabase/functions/ai-job-builder/retry.ts | new Set([500, 502, 503]) | new Set([500, 502])
 * @mutate supabase/functions/ai-job-builder/retry.ts |     if (now() - started + wait >= deadlineMs) return res; |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";
import { fetchWithRetry, RETRY_DELAYS_MS } from "../../../supabase/functions/ai-job-builder/retry";

const busy = () =>
  new Response(JSON.stringify([{ error: { code: 503, message: "This model is currently experiencing high demand." } }]), { status: 503 });
const good = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({
        title: "Mow my lawn", description: "Front and back.", category: "yard_work",
        estimated_hours: 2, budget_min: 40, budget_max: 60,
      }) } }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const noSleep = { sleep: () => Promise.resolve(), random: () => 0.5 };

describe("fetchWithRetry", () => {
  it("retries a 503 and returns the later success", async () => {
    const calls = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(good());
    const res = await fetchWithRetry(calls, noSleep);
    expect(res.status).toBe(200);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts and hands back the last failure", async () => {
    const calls = vi.fn().mockImplementation(() => Promise.resolve(busy()));
    const res = await fetchWithRetry(calls, noSleep);
    expect(res.status).toBe(503);
    expect(calls).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    expect(RETRY_DELAYS_MS.length + 1).toBe(3);
  });

  it("never retries a thrown error: a dropped connection may already have been billed", async () => {
    const never = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(fetchWithRetry(never, noSleep)).rejects.toThrow("network");
    expect(never).toHaveBeenCalledTimes(1);
  });

  it("never retries our quota (429), billing (402), a bad request (400) or a gateway timeout (504)", async () => {
    for (const status of [429, 402, 400, 504]) {
      const calls = vi.fn().mockResolvedValue(new Response("{}", { status }));
      expect((await fetchWithRetry(calls, noSleep)).status).toBe(status);
      expect(calls).toHaveBeenCalledTimes(1);
    }
  });

  it("starts no retry that would cross the deadline", async () => {
    let t = 0;
    const calls = vi.fn().mockImplementation(() => { t += 29_500; return Promise.resolve(busy()); });
    const res = await fetchWithRetry(calls, { ...noSleep, now: () => t });
    expect(res.status).toBe(503);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("gives every attempt its own abort signal and jitters the wait", async () => {
    const signals: AbortSignal[] = [];
    const waits: number[] = [];
    const calls = vi.fn().mockImplementation((signal: AbortSignal) => { signals.push(signal); return Promise.resolve(signals.length < 2 ? busy() : good()); });
    await fetchWithRetry(calls, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); }, random: () => 0 });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(waits).toEqual([400]); // 800ms base, -50% jitter
  });
});

describe("ai-job-builder handler", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    scenario.authUser = { id: "u-1", email: "user@test.dev" };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a single provider 503 reaches the poster as a generated job, not an error", async () => {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", GEMINI_API_KEY: "k" });
    const gemini = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(good());
    vi.stubGlobal("fetch", gemini);
    const fn = await loadEdgeFunction("ai-job-builder");
    const res = await fn.fetch(fn.request({
      headers: { Authorization: "Bearer good" },
      body: { messages: [{ role: "user", content: "I need my lawn mowed this weekend" }] },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Mow my lawn");
    expect(gemini).toHaveBeenCalledTimes(2);
  });
});
