/**
 * Q1596 (lead decision 2026-11-02): once "Session lost on a signed-in screen"
 * has fired for a client, the permission-denied errors that follow from that
 * same client and session are not reported again (they are the session loss,
 * already reported once). Real denials with a live session still report.
 *
 * Measured on prod (read-only SQL, Builder 161, 2026-11-02): the anon bursts of
 * 2026-10-19, 10-22 and 10-30 each carry a "Session lost" row plus 1-3
 * denials each on up to 9 tables/functions, from one client in one batch;
 * Sentry ledger ec743a639c38 ("permission denied for table profiles") counts
 * those denials.
 */
// @mutate src/lib/errorLogger.ts | if (isSessionLossNoise(err)) return; | if (false) return;
// @mutate src/lib/permissionDenied.ts | export const isSessionLossNoise = (err: unknown): boolean => sessionLostMarked && isPermissionDenied(err); | export const isSessionLossNoise = (err: unknown): boolean => isPermissionDenied(err);
// @mutate src/lib/permissionDenied.ts | export const isSessionLossNoise = (err: unknown): boolean => sessionLostMarked && isPermissionDenied(err); | export const isSessionLossNoise = (err: unknown): boolean => sessionLostMarked;
// @mutate src/lib/permissionDenied.ts | export function clearSessionLost(): void { | export function clearSessionLost(): void { return;
// @mutate src/components/ProtectedRoute.tsx | markSessionLost(); | void 0;
// @mutate src/integrations/supabase/client.ts | if (event === 'SIGNED_IN') clearSessionLost(); | if (event === 'SIGNED_OUT') clearSessionLost();
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
import { clearSessionLost, markSessionLost, PERMISSION_DENIED_EVENT } from "./permissionDenied";

const denied = (table: string) => ({ message: `permission denied for table ${table}`, code: "42501", details: null, hint: null });

/** Every message POSTed to error_logs after the debounce. */
const loggedMessages = async (): Promise<string[]> => {
  await new Promise((r) => setTimeout(r, 300));
  return fetchSpy.mock.calls.flatMap((c) => (JSON.parse(String(c[1].body)) as Array<{ message: string }>).map((r) => r.message));
};

beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/home"), writable: true });
  fetchSpy.mockClear();
  sentrySpy.mockClear();
  clearSessionLost();
});
afterEach(() => clearSessionLost());

describe("Q1596: denials after a confirmed session loss are not reported again", () => {
  it("a denial with a live session (no loss marked) still reports to error_logs and Sentry", async () => {
    report(denied("jobs"), { tags: { source: "query" } });
    const msgs = await loggedMessages();
    expect(msgs.some((m) => m.startsWith("permission denied for table jobs"))).toBe(true);
    const sentMessages = sentrySpy.mock.calls.map((c) => String((c[0] as { message?: unknown })?.message ?? ""));
    expect(sentMessages).toContain("permission denied for table jobs");
  });

  it("after the loss is marked, the denials that follow are dropped; the session-lost row and other errors still report", async () => {
    markSessionLost();
    report(new Error("Session lost on a signed-in screen"), { severity: "warning", tags: { source: "ProtectedRoute.sessionLost" } });
    report(denied("profiles"), { tags: { source: "query" } });
    report(denied("applications"), { tags: { source: "query" } });
    report({ message: "permission denied for function get_job_offer_targets", code: "42501" }, { tags: { source: "query" } });
    report(new Error("Cannot read properties of undefined"), { tags: { source: "window.onerror" } });
    const msgs = await loggedMessages();
    expect(msgs.filter((m) => /permission denied/.test(m))).toEqual([]);
    expect(msgs).toContain("Session lost on a signed-in screen");
    expect(msgs).toContain("Cannot read properties of undefined");
    // Not sent to Sentry either (the ledger row is Sentry-sourced): only the two real reports.
    const sentMessages = sentrySpy.mock.calls.map((c) => String((c[0] as { message?: unknown })?.message ?? ""));
    expect(sentMessages.filter((m) => /permission denied/.test(m))).toEqual([]);
    expect(sentMessages).toContain("Session lost on a signed-in screen");
  });

  it("an ordinary 42501 refusal (RLS / app 'not allowed') is not a permission-denied grant error and still reports after a loss", async () => {
    markSessionLost();
    report({ message: 'new row violates row-level security policy for table "jobs"', code: "42501" }, { tags: { source: "query" } });
    const msgs = await loggedMessages();
    expect(msgs.some((m) => m.startsWith("new row violates row-level security policy"))).toBe(true);
  });

  it("a dropped denial still announces PERMISSION_DENIED_EVENT (the update path keeps working)", () => {
    markSessionLost();
    const onDenied = vi.fn();
    window.addEventListener(PERMISSION_DENIED_EVENT, onDenied);
    report(denied("jobs"));
    window.removeEventListener(PERMISSION_DENIED_EVENT, onDenied);
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it("a new sign-in clears the mark, so the next session's denials report again", async () => {
    markSessionLost();
    clearSessionLost();
    report(denied("jobs"), { tags: { source: "query" } });
    const msgs = await loggedMessages();
    expect(msgs.some((m) => m.startsWith("permission denied for table jobs"))).toBe(true);
  });

  it("is wired: ProtectedRoute marks the loss before reporting it, and the client clears it on SIGNED_IN", () => {
    const read = (p: string) => blankComments(readFileSync(resolve(process.cwd(), p), "utf8"));
    const route = read("src/components/ProtectedRoute.tsx");
    const mark = route.indexOf("markSessionLost();");
    const lost = route.indexOf('report(new Error("Session lost on a signed-in screen")');
    expect(mark).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(mark);
    const client = read("src/integrations/supabase/client.ts");
    expect(client).toMatch(/if \(event === 'SIGNED_IN'\) clearSessionLost\(\);/);
  });
});
