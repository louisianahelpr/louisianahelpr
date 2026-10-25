/**
 * Supabase Auth gives the send-email hook 5 s and, on a timeout, rolls the
 * whole sign-up back: no account, no email.
 *
 * Measured on prod 2026-10-22 (auth_logs run_hook durations, function logs):
 * warm runs took 1.3-1.6 s, but the two runs on a freshly booted worker
 * (13:30:59Z, 22:13:25Z) took ~7 s and ~6 s, ~0.6 s and ~1.4 s of it before
 * the handler started (boot + module load). Auth answered "422: Failed to
 * reach hook within maximum time of 5.000000 seconds" (hook_timeout), neither
 * account exists (auth.users has no row for either id), "Auth email enqueued"
 * was still logged afterwards for each, and one of the two people never signed
 * up again.
 *
 * The hook now answers within HOOK_ANSWER_BY_MS of the handler starting: the
 * real result when the work is done (warm), else 200 while it finishes under
 * EdgeRuntime.waitUntil, a late throw alerting ops. RED on origin/main
 * 8ca225a0e3: no _shared/answerWithin.ts, and the hook awaited render +
 * enqueue before answering.
 */
// @mutate supabase/functions/auth-email-hook/index.ts |   if (answered) return answered | return await delivery
// @mutate supabase/functions/auth-email-hook/index.ts |     waitUntil: rt?.waitUntil?.bind(rt), |     waitUntil: undefined,
// @mutate supabase/functions/auth-email-hook/index.ts |       await alertAuthEmail('handler error', 'warning', error instanceof Error ? error.message : String(error))\n    },\n    waitUntil | void error\n    },\n    waitUntil
// @mutate supabase/functions/auth-email-hook/index.ts | answerBudgetMs(startedAt) | 60_000
// @mutate supabase/functions/_shared/answerWithin.ts | export const HOOK_ANSWER_BY_MS = 2_500; | export const HOOK_ANSWER_BY_MS = 4_500;
// @mutate supabase/functions/_shared/answerWithin.ts |     timer = setTimeout(() => resolve(null), ms); |     void ms;
// @mutate supabase/functions/_shared/answerWithin.ts |     (error: unknown) => late.onLateError(error), |     () => undefined,
// @mutate supabase/functions/_shared/answerWithin.ts |   else await late.onNoWaitUntil(); |   else void 0;
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  HOOK_ANSWER_BY_MS,
  answerBudgetMs,
  answerOrFinishInBackground,
  answerWithin,
} from "../../../supabase/functions/_shared/answerWithin";
import { blankComments } from "../helpers/blankNonCode";

const AUTH_HOOK_TIMEOUT_MS = 5_000;
/** The longest pre-handler time measured on a cold run (2026-10-22 22:13Z). */
const MEASURED_COLD_PRE_HANDLER_MS = 1_400;

afterEach(() => vi.useRealTimers());

const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const laterReject = (ms: number, err: Error) => new Promise<never>((_, j) => setTimeout(() => j(err), ms));

describe("answerWithin / answerOrFinishInBackground", () => {
  it("hands back the work's own result when it is done in time, and starts nothing in the background", async () => {
    vi.useFakeTimers();
    const waitUntil = vi.fn();
    const p = answerOrFinishInBackground(later(100, "done"), 1_000, { onLateError: vi.fn(), waitUntil, onNoWaitUntil: vi.fn() });
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toBe("done");
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("answers null at the deadline and keeps the work alive with waitUntil", async () => {
    vi.useFakeTimers();
    const waitUntil = vi.fn();
    const onLateResult = vi.fn();
    const p = answerOrFinishInBackground(later(7_000, "late"), HOOK_ANSWER_BY_MS, { onLateResult, onLateError: vi.fn(), waitUntil, onNoWaitUntil: vi.fn() });
    await vi.advanceTimersByTimeAsync(HOOK_ANSWER_BY_MS);
    expect(await p).toBeNull();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7_000);
    await waitUntil.mock.calls[0][0];
    expect(onLateResult).toHaveBeenCalledWith("late");
  });

  it("a throw after the answer reaches onLateError (the alert), never an unhandled rejection", async () => {
    vi.useFakeTimers();
    const waitUntil = vi.fn();
    const onLateError = vi.fn();
    const p = answerOrFinishInBackground(laterReject(7_000, new Error("enqueue blew up")), 1_000, { onLateError, waitUntil, onNoWaitUntil: vi.fn() });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBeNull();
    await vi.advanceTimersByTimeAsync(7_000);
    await waitUntil.mock.calls[0][0];
    expect(onLateError).toHaveBeenCalledWith(expect.objectContaining({ message: "enqueue blew up" }));
  });

  it("says so when the runtime has no waitUntil", async () => {
    vi.useFakeTimers();
    const onNoWaitUntil = vi.fn();
    const p = answerOrFinishInBackground(later(7_000, "late"), 1_000, { onLateError: vi.fn(), onNoWaitUntil });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBeNull();
    expect(onNoWaitUntil).toHaveBeenCalledTimes(1);
  });

  it("rejects when the work throws inside the window", async () => {
    await expect(answerWithin(Promise.reject(new Error("enqueue")), 1_000)).rejects.toThrow("enqueue");
  });

  it("the budget counts from the handler start and leaves room for a cold boot", () => {
    expect(answerBudgetMs(1_000, 1_000)).toBe(HOOK_ANSWER_BY_MS);
    expect(answerBudgetMs(1_000, 1_000 + 1_000)).toBe(HOOK_ANSWER_BY_MS - 1_000);
    expect(answerBudgetMs(1_000, 1_000 + 60_000)).toBe(0);
    // Measured cold pre-handler time + budget + 500 ms of network still beats Auth.
    expect(MEASURED_COLD_PRE_HANDLER_MS + HOOK_ANSWER_BY_MS + 500).toBeLessThan(AUTH_HOOK_TIMEOUT_MS);
  });
});

describe("auth-email-hook answers Auth within the budget", () => {
  const src = blankComments(readFileSync("supabase/functions/auth-email-hook/index.ts", "utf8"));
  const handler = src.slice(src.indexOf("async function handleWebhook"), src.indexOf("async function deliver("));
  const serveBlock = src.slice(src.lastIndexOf("serve(async (req) => {"));

  it("starts the clock at the top of serve and races render + enqueue against what is left", () => {
    expect(serveBlock.indexOf("const startedAt = Date.now()")).toBeGreaterThan(-1);
    expect(serveBlock.indexOf("const startedAt = Date.now()")).toBeLessThan(serveBlock.indexOf("new URL(req.url)"));
    expect(serveBlock).toMatch(/handleWebhook\(req, startedAt\)/);
    expect(handler).toMatch(/answerOrFinishInBackground\(delivery, answerBudgetMs\(startedAt\),/);
    expect(handler).toMatch(/if \(answered\) return answered/);
    expect(handler).toMatch(/queued: 'pending'/);
  });

  it("a late throw alerts ops, and a missing waitUntil is reported", () => {
    expect(handler).toMatch(/onLateError: async \(error\) => \{[^}]*await alertAuthEmail\('handler error'/);
    expect(handler).toMatch(/onNoWaitUntil: async \(\) => \{[^}]*await alertAuthEmail\('no waitUntil'/);
    expect(handler).toMatch(/waitUntil: rt\?\.waitUntil\?\.bind\(rt\)/);
  });

  it("validates before racing, and does no slow work before it", () => {
    const beforeRace = handler.slice(0, handler.indexOf("const delivery = deliver("));
    // Inventory floor: secret, unsigned, signature, payload and type refusals all answer before the race.
    expect((beforeRace.match(/return new Response\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(beforeRace).toMatch(/wh\.verify\(rawBody, headers\)/);
    expect(beforeRace).not.toMatch(/renderAsync|enqueue_email|email_send_log/);
  });
});
