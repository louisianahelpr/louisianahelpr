// @mutate src/lib/bugReportContext.ts |   while (recent.length > MAX_RECENT_ERRORS) recent.shift(); |   void 0;
// @mutate src/lib/bugReportContext.ts |   if (isSupportScreen(pathname, search)) return; |   void 0;
// @mutate src/lib/bugReportContext.ts |   const keep = ["tab", "filter", "view"]; |   const keep = [...new URLSearchParams(search).keys()];
// @mutate src/lib/bugReportContext.ts |   const room = Math.max(0, max - block.length - 2); |   const room = max;
// @mutate src/lib/errorLogger.ts |   noteRecentError(message); |   void message;
/*
 * Q1028 (owner, 2026-10-07): "Report a bug" attaches, as TEXT, the screen and
 * route the person came from, the viewport, the platform, the app build and
 * the last 10 client errors (already redacted by errorLogger).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  _resetBugReportContext,
  bugReportBlock,
  bugReportContext,
  bugReportItems,
  isSupportScreen,
  MAX_RECENT_ERRORS,
  noteRecentError,
  noteScreen,
  routeLabel,
  withBugReport,
} from "@/lib/bugReportContext";

beforeEach(() => _resetBugReportContext());

describe("what a bug report attaches", () => {
  it("keeps the last 10 errors, each cut to 200 characters", () => {
    for (let i = 0; i < 14; i++) noteRecentError(`error ${i} ${"x".repeat(300)}`, new Date(Date.UTC(2026, 9, 7, 5, i)));
    const ctx = bugReportContext();
    expect(ctx.errors).toHaveLength(MAX_RECENT_ERRORS);
    expect(ctx.errors[0].message.startsWith("error 4 ")).toBe(true);
    expect(ctx.errors.every((e) => e.message.length <= 200)).toBe(true);
  });

  it("names the screen the person came FROM, never the support form itself", () => {
    noteScreen("/jobs/123", "", "Fence repair · Helpr");
    noteScreen("/profile", "?tab=support&topic=report", "Help & Support · Helpr");
    noteScreen("/support", "?topic=report", "Support · Helpr");
    const ctx = bugReportContext();
    expect(ctx.screen).toBe("Fence repair · Helpr");
    expect(ctx.route).toBe("/jobs/123");
    expect(isSupportScreen("/help")).toBe(true);
    expect(isSupportScreen("/profile", "?tab=security")).toBe(false);
  });

  it("drops query VALUES from the route (no ids or tokens), keeping the tab", () => {
    expect(routeLabel("/profile", "?tab=security&token=abc123")).toBe("/profile?tab=security (+1 param)");
    expect(routeLabel("/reset-password", "?code=secret")).toBe("/reset-password (+1 param)");
  });

  it("the list the person sees and the block the team reads carry the same items", () => {
    noteScreen("/home", "", "Home · Helpr");
    noteRecentError("TypeError: x is undefined", new Date("2026-10-07T05:00:00Z"));
    const ctx = bugReportContext();
    const labels = bugReportItems(ctx).map((i) => i.label);
    expect(labels).toEqual(["Screen", "Route", "Screen size", "Device", "App build", "Recent errors"]);
    const block = bugReportBlock(ctx);
    for (const l of labels) expect(block).toContain(`${l}: `);
    expect(block).toContain("2026-10-07T05:00:00.000Z TypeError: x is undefined");
  });

  it("fits the server's limit: drops the oldest errors, then shortens the message, never cuts the block", () => {
    for (let i = 0; i < 10; i++) noteRecentError(`e${i} ${"y".repeat(190)}`);
    const ctx = bugReportContext();
    const out = withBugReport("m".repeat(5000), ctx, 5000);
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out).toContain("--- Attached automatically ---");
    expect(out).toContain("App build: ");
    const short = withBugReport("It broke when I tapped Save.", ctx, 5000);
    expect(short.startsWith("It broke when I tapped Save.\n\n--- Attached automatically ---")).toBe(true);
    expect(short).toContain("e9 ");
  });
});

describe("errorLogger feeds it", () => {
  it("every reported error lands in the bug report's recent errors, redacted", async () => {
    // report() drops errors on localhost (the dev environment); act as prod, and keep its flush off the wire.
    const realLocation = window.location;
    Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/home"), writable: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    vi.resetModules();
    vi.doMock("@/lib/sentry", () => ({ captureException: vi.fn() }));
    vi.doMock("@/lib/posthog", () => ({}));
    const ctxMod = await import("@/lib/bugReportContext");
    ctxMod._resetBugReportContext();
    const { report } = await import("@/lib/errorLogger");
    const err = new Error("boom with Bearer abcdefghijklmnop1234");
    err.stack = "Error: boom\n    at https://www.louisianahelpr.com/assets/index-abc.js:1:1";
    report(err);
    const errors = ctxMod.bugReportContext().errors;
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("boom with Bearer <redacted>");
    expect(errors[0].message).not.toContain("abcdefghijklmnop1234");
    Object.defineProperty(window, "location", { value: realLocation, writable: true });
    vi.unstubAllGlobals();
  });
});
