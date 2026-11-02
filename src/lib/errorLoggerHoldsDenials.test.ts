/**
 * Q2295 (lead-approved 2026-11-02, extends Q1596): a grant denial is held
 * until the session-loss check answers, so the denial that STARTS the check
 * (and any that arrive while it runs) is dropped when the loss is confirmed.
 *
 * Measured on prod (read-only SQL, Builder 188, 2026-11-02): the one
 * my_schedule_clashes occurrence (2026-10-19 16:00:48Z, ledger 59e0e601cc69)
 * came in ONE error_logs batch with "Session lost on a signed-in screen" plus
 * denials on get_job_offer_targets and applications. Q1596 drops denials only
 * AFTER ProtectedRoute marks the loss, so those still reported.
 */
// @mutate src/lib/errorLogger.ts | if (isPermissionDenied(err)) { | if (false) {
// @mutate src/lib/permissionDenied.ts | heldDenials.length = 0; | void 0;
// @mutate src/lib/permissionDenied.ts | if (holdTimer === null) holdTimer = setTimeout(releaseHeldDenials, DENIAL_HOLD_MS); | if (false) holdTimer = setTimeout(releaseHeldDenials, DENIAL_HOLD_MS);
// @mutate src/lib/errorLogger.ts | releaseHeldDenials(); | void 0;
// @mutate src/components/ProtectedRoute.tsx | releaseHeldDenials(); | void 0;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })));
const sentrySpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: sentrySpy }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

import { installGlobalErrorHandlers, report } from "./errorLogger";
import { clearSessionLost, DENIAL_HOLD_MS, heldDenialCount, markSessionLost, releaseHeldDenials } from "./permissionDenied";

const denied = (what: string) => ({ message: `permission denied for ${what}`, code: "42501", details: null, hint: null });

/** Every message POSTed to error_logs so far. */
const posted = (): string[] =>
  fetchSpy.mock.calls.flatMap((c) => (JSON.parse(String(c[1].body)) as Array<{ message: string }>).map((r) => r.message));
const sentToSentry = (): string[] => sentrySpy.mock.calls.map((c) => String((c[0] as { message?: unknown })?.message ?? ""));

/** Let the 250 ms flush debounce and the fetch promise run. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  await vi.runOnlyPendingTimersAsync();
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/home"), writable: true });
  releaseHeldDenials();
  fetchSpy.mockClear();
  sentrySpy.mockClear();
  clearSessionLost();
});
afterEach(() => {
  releaseHeldDenials();
  clearSessionLost();
  vi.useRealTimers();
});

describe("Q2295: denials wait for the session-loss check", () => {
  it("the 2026-10-19 batch: denials before the loss is confirmed are dropped; only the session-lost row reports", async () => {
    report(denied("function my_schedule_clashes"), { tags: { source: "query" } });
    report(denied("function get_job_offer_targets"), { tags: { source: "query" } });
    report(denied("table applications"), { tags: { source: "query" } });
    expect(heldDenialCount()).toBe(3);
    // confirmSessionLost() answers "lost": ProtectedRoute marks, then reports.
    markSessionLost();
    report(new Error("Session lost on a signed-in screen"), { severity: "warning", tags: { source: "ProtectedRoute.sessionLost" } });
    await vi.advanceTimersByTimeAsync(DENIAL_HOLD_MS + 500);
    await settle();
    const msgs = posted();
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs).toContain("Session lost on a signed-in screen");
    expect(msgs.filter((m) => /permission denied/.test(m))).toEqual([]);
    expect(sentToSentry().filter((m) => /permission denied/.test(m))).toEqual([]);
    expect(sentToSentry()).toContain("Session lost on a signed-in screen");
  });

  it("a 'not lost' answer sends the held denials at once, to error_logs and Sentry", async () => {
    report(denied("table jobs"), { tags: { source: "query" } });
    await settle();
    expect(posted().filter((m) => /permission denied/.test(m))).toEqual([]);
    releaseHeldDenials();
    await settle();
    expect(posted().some((m) => m.startsWith("permission denied for table jobs"))).toBe(true);
    expect(sentToSentry()).toContain("permission denied for table jobs");
  });

  it("with no answer, the held denial reports when the window ends, and the window is not extended", async () => {
    report(denied("table jobs"), { tags: { source: "query" } });
    await vi.advanceTimersByTimeAsync(DENIAL_HOLD_MS - 1_000);
    report(denied("table profiles"), { tags: { source: "query" } });
    await vi.advanceTimersByTimeAsync(500);
    expect(posted()).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    const msgs = posted();
    expect(msgs.some((m) => m.startsWith("permission denied for table jobs"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("permission denied for table profiles"))).toBe(true);
    expect(heldDenialCount()).toBe(0);
  });

  it("a page going away (pagehide) sends the held denials, so a stale-bundle reload never loses one", async () => {
    installGlobalErrorHandlers();
    report(denied("column jobs.secret"), { tags: { source: "query" } });
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(posted().some((m) => m.startsWith("permission denied for column jobs.secret"))).toBe(true);
  });

  it("after a confirmed loss, pagehide sends nothing held", async () => {
    installGlobalErrorHandlers();
    report(denied("table jobs"), { tags: { source: "query" } });
    markSessionLost();
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(posted().filter((m) => /permission denied/.test(m))).toEqual([]);
  });

  it("other errors and ordinary 42501 refusals are never held", async () => {
    report(new Error("Cannot read properties of undefined"), { tags: { source: "window.onerror" } });
    report({ message: 'new row violates row-level security policy for table "jobs"', code: "42501" }, { tags: { source: "query" } });
    expect(heldDenialCount()).toBe(0);
    await settle();
    const msgs = posted();
    expect(msgs).toContain("Cannot read properties of undefined");
    expect(msgs.some((m) => m.startsWith("new row violates row-level security policy"))).toBe(true);
  });

  it("is wired: ProtectedRoute sends the held denials on a 'not lost' answer, before its loss branch", () => {
    const route = blankComments(readFileSync(resolve(process.cwd(), "src/components/ProtectedRoute.tsx"), "utf8"));
    const notLost = route.indexOf("if (!lost) {");
    const release = route.indexOf("releaseHeldDenials();");
    const mark = route.indexOf("markSessionLost();");
    expect(notLost).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(notLost);
    expect(mark).toBeGreaterThan(release);
  });
});
