/**
 * Q2507 / Q2515: the reads a screen already had in flight when the session
 * was signed out come back "permission denied" (they went out with the anon
 * key) and were reported as errors.
 *
 * Measured 2026-11-02 (Builder 9): Sentry JAVASCRIPT-2T and JAVASCRIPT-49 are
 * one event, 2026-10-22 16:34:47Z, iPhone Safari. Its replay: on
 * /jobs?tab=posted four reads (recurring_visit_payments, user_roles,
 * get_job_view_counts, feature_switches_for_me) answer 401 in 100-150 ms,
 * and the page moves to /login?redirect=... with NO `signed_out=session-lost`,
 * so it was ProtectedRoute's no-user redirect after a sign-out, not the
 * session-lost net Q1596 covers. error_logs holds the two denials, both with
 * url /login (reported after the redirect) and no "Session lost" row.
 *
 * So for SIGNED_OUT_NOISE_MS after SIGNED_OUT, report() drops grant denials.
 * Only a short window: a signed-out visitor who keeps browsing as a guest on
 * the same page must still have a real grant bug reported.
 */
// @mutate src/lib/errorLogger.ts | if (isSignedOutNoise(err)) return; | if (false) return;
// @mutate src/lib/permissionDenied.ts | now - signedOutAt < SIGNED_OUT_NOISE_MS && isPermissionDenied(err); | isPermissionDenied(err);
// @mutate src/lib/permissionDenied.ts | now - signedOutAt < SIGNED_OUT_NOISE_MS && isPermissionDenied(err); | now - signedOutAt < SIGNED_OUT_NOISE_MS;
// @mutate src/lib/permissionDenied.ts | signedOutAt = -Infinity; | void 0;
// @mutate src/integrations/supabase/client.ts | if (event === 'SIGNED_OUT') markSignedOut(); | void 0;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })));
const sentrySpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: sentrySpy }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

import { report } from "./errorLogger";
import { clearSessionLost, markSignedOut, SIGNED_OUT_NOISE_MS } from "./permissionDenied";

const denied = (what: string) => ({ message: `permission denied for ${what}`, code: "42501", details: null, hint: null });

/** Every message POSTed to error_logs after the debounce. */
const loggedMessages = async (): Promise<string[]> => {
  await new Promise((r) => setTimeout(r, 300));
  const msgs = fetchSpy.mock.calls.flatMap((c) => (JSON.parse(String(c[1].body)) as Array<{ message: string }>).map((r) => r.message));
  // Floor: every case logs at least one row, so an empty batch never passes a "nothing denied" check.
  expect(msgs.length).toBeGreaterThan(0);
  return msgs;
};
const sentToSentry = () => sentrySpy.mock.calls.map((c) => String((c[0] as { message?: unknown })?.message ?? ""));

beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/login"), writable: true });
  fetchSpy.mockClear();
  sentrySpy.mockClear();
  clearSessionLost();
});
afterEach(() => clearSessionLost());

describe("Q2507/Q2515: denials of reads in flight at sign-out are not reported", () => {
  it("right after SIGNED_OUT the in-flight denials are dropped; other errors still report", async () => {
    markSignedOut();
    report(denied("table recurring_visit_payments"), { tags: { source: "QueryCache" } });
    report(denied("function feature_switches_for_me"), { tags: { source: "QueryCache" } });
    report(new Error("Cannot read properties of undefined"), { tags: { source: "window.onerror" } });
    const msgs = await loggedMessages();
    expect(msgs.filter((m) => /permission denied/.test(m))).toEqual([]);
    expect(msgs).toContain("Cannot read properties of undefined");
    expect(sentToSentry().filter((m) => /permission denied/.test(m))).toEqual([]);
  });

  it("once the window has passed, a guest page's denial reports again", async () => {
    markSignedOut(Date.now() - SIGNED_OUT_NOISE_MS - 1);
    report(denied("table jobs"), { tags: { source: "QueryCache" } });
    const msgs = await loggedMessages();
    expect(msgs.some((m) => m.startsWith("permission denied for table jobs"))).toBe(true);
    expect(sentToSentry()).toContain("permission denied for table jobs");
  });

  it("an RLS refusal (42501, not a grant denial) still reports inside the window", async () => {
    markSignedOut();
    report({ message: 'new row violates row-level security policy for table "jobs"', code: "42501" }, { tags: { source: "query" } });
    const msgs = await loggedMessages();
    expect(msgs.some((m) => m.startsWith("new row violates row-level security policy"))).toBe(true);
  });

  it("a new sign-in ends the window at once", async () => {
    markSignedOut();
    clearSessionLost();
    report(denied("table jobs"), { tags: { source: "QueryCache" } });
    const msgs = await loggedMessages();
    expect(msgs.some((m) => m.startsWith("permission denied for table jobs"))).toBe(true);
  });

  it("the window is short (a few seconds), so guest browsing after sign-out is still watched", () => {
    expect(SIGNED_OUT_NOISE_MS).toBeGreaterThan(1_000);
    expect(SIGNED_OUT_NOISE_MS).toBeLessThanOrEqual(10_000);
  });

  it("is wired: the client marks SIGNED_OUT", () => {
    const client = blankComments(readFileSync(resolve(process.cwd(), "src/integrations/supabase/client.ts"), "utf8"));
    expect(client).toMatch(/if \(event === 'SIGNED_OUT'\) markSignedOut\(\);/);
  });
});
