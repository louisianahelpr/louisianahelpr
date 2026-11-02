/**
 * Q2347 (lead decision 2026-11-02, Option A): "Held a signed-in request while
 * the sign-in refreshed" is the signed-in request guard working as designed
 * (src/lib/signedInRequestGuard.ts). It is counted in our own error_logs only
 * and never sent to Sentry, where each event became alert-ledger row
 * 15cc2d7f63f3 (16 events 10-21..10-26, measured read-only on prod).
 *
 * error_logs-only is silent for the owner: scripts/prod-errors-check.mjs
 * classes source "signedInRequestGuard.held" as 'other', which it never pages.
 */
// @mutate src/lib/errorLogger.ts | if (!opts.localOnly) void fanOutToObservability( | void fanOutToObservability(
// @mutate src/integrations/supabase/client.ts | localOnly: true, | localOnly: false,
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })));
const sentrySpy = vi.hoisted(() => vi.fn());
const posthogSpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: sentrySpy }));
vi.mock("@/lib/posthog", () => ({ captureException: posthogSpy }));

import { report } from "./errorLogger";

const HELD = "Held a signed-in request while the sign-in refreshed";

/** Every message POSTed to error_logs so far. */
const posted = (): string[] =>
  fetchSpy.mock.calls.flatMap((c) => (JSON.parse(String(c[1].body)) as Array<{ message: string }>).map((r) => r.message));
const sentTo = (spy: typeof sentrySpy): string[] => spy.mock.calls.map((c) => String((c[0] as { message?: unknown })?.message ?? ""));

const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  await vi.runOnlyPendingTimersAsync();
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/home"), writable: true });
  fetchSpy.mockClear();
  sentrySpy.mockClear();
  posthogSpy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Q2347: the held-request diagnostic stays in error_logs", () => {
  it("a localOnly report is written to error_logs and sent to neither Sentry nor PostHog", async () => {
    report(new Error(HELD), { severity: "warning", localOnly: true, tags: { source: "signedInRequestGuard.held" } });
    await settle();
    expect(posted()).toContain(HELD);
    expect(sentTo(sentrySpy)).not.toContain(HELD);
    expect(sentTo(posthogSpy)).not.toContain(HELD);
  });

  it("an ordinary report still reaches Sentry (the option is opt-in)", async () => {
    report(new Error("a real failure"), { tags: { source: "query" } });
    await settle();
    expect(posted()).toContain("a real failure");
    expect(sentTo(sentrySpy)).toContain("a real failure");
  });

  it("the client's held report passes localOnly: true", () => {
    const src = blankComments(readFileSync(resolve(process.cwd(), "src/integrations/supabase/client.ts"), "utf8"));
    const reports = [...src.matchAll(/report\(new Error\('([^']+)'\),\s*\{([\s\S]*?)\}\s*\)/g)];
    expect(reports.length).toBeGreaterThan(0);
    const held = reports.find((m) => m[1] === HELD);
    expect(held, "the held report call was not found in client.ts").toBeTruthy();
    expect(held![2]).toMatch(/\blocalOnly:\s*true\b/);
  });
});
