// Route memory for native resume. The failure this guards against is not a
// crash — it is the app quietly forgetting where you were every time you
// glanced at a notification. Tests cover:
//   - round-trip remember → read
//   - the freshness window (and its two boundaries)
//   - routes that must never be restored (auth states, one-shot receipts)
//   - corrupt / hostile stored values falling back to null rather than throwing
//   - search params surviving, since tab state lives in the query string

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  rememberRoute,
  readRestorableRoute,
  clearRememberedRoute,
  isRestorablePath,
} from "./lastRoute";

const KEY = "lh_last_route";
const NOW = 1_700_000_000_000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isRestorablePath", () => {
  it("accepts real destinations", () => {
    expect(isRestorablePath("/messages")).toBe(true);
    expect(isRestorablePath("/profile?tab=security")).toBe(true);
    expect(isRestorablePath("/jobs/abc-123")).toBe(true);
  });

  it("rejects the launch entrypoint itself", () => {
    // Restoring "/" would hand control straight back to the resolver that
    // asked us — a loop at worst, a no-op at best.
    expect(isRestorablePath("/")).toBe(false);
    expect(isRestorablePath("")).toBe(false);
  });

  it("rejects auth and profile-gating states", () => {
    // These are states, not places. A restored /reset-password whose token
    // has expired is a screen the user cannot leave.
    expect(isRestorablePath("/login")).toBe(false);
    expect(isRestorablePath("/signup")).toBe(false);
    expect(isRestorablePath("/reset-password")).toBe(false);
    expect(isRestorablePath("/complete-profile")).toBe(false);
    expect(isRestorablePath("/account-banned")).toBe(false);
  });

  it("rejects one-shot confirmation screens", () => {
    // Re-showing "payment complete" on a resume reads as a second charge.
    expect(isRestorablePath("/payment-success")).toBe(false);
  });

  it("does not reject a route that merely shares a prefix", () => {
    // "/logins-report" is not "/login". Guard against a sloppy startsWith.
    expect(isRestorablePath("/logins-report")).toBe(true);
  });

  it("rejects excluded routes that carry query params", () => {
    // Auth routes almost always have a query string, so matching the raw
    // string instead of the pathname would let every one of them through.
    expect(isRestorablePath("/login?redirect=/messages")).toBe(false);
    expect(isRestorablePath("/reset-password?token=abc")).toBe(false);
    expect(isRestorablePath("/payment-success?session_id=cs_123")).toBe(false);
  });

  it("rejects the entrypoint even with a query or hash", () => {
    expect(isRestorablePath("/?ref=push")).toBe(false);
    expect(isRestorablePath("/#how-it-works")).toBe(false);
  });
});

describe("remember → read round trip", () => {
  it("restores the route just visited", () => {
    rememberRoute("/messages");
    expect(readRestorableRoute()).toBe("/messages");
  });

  it("preserves search params", () => {
    // Tab state lives in the query string, so dropping it would restore the
    // right page with the wrong panel open.
    rememberRoute("/profile?tab=security");
    expect(readRestorableRoute()).toBe("/profile?tab=security");
  });

  it("keeps only the most recent route", () => {
    rememberRoute("/messages");
    rememberRoute("/my-jobs");
    expect(readRestorableRoute()).toBe("/my-jobs");
  });

  it("does not record non-restorable routes", () => {
    rememberRoute("/login");
    expect(readRestorableRoute()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does not let a non-restorable route clobber a good one", () => {
    rememberRoute("/messages");
    rememberRoute("/payment-success");
    expect(readRestorableRoute()).toBe("/messages");
  });

  it("returns null when nothing was ever remembered", () => {
    expect(readRestorableRoute()).toBeNull();
  });

  it("clearRememberedRoute forgets it", () => {
    rememberRoute("/messages");
    clearRememberedRoute();
    expect(readRestorableRoute()).toBeNull();
  });
});

describe("freshness window", () => {
  const WINDOW = 30 * 60 * 1000;

  it("restores a route remembered seconds ago (the resume case)", () => {
    rememberRoute("/messages");
    expect(readRestorableRoute(NOW + 5_000)).toBe("/messages");
  });

  it("restores at the last moment inside the window", () => {
    rememberRoute("/messages");
    expect(readRestorableRoute(NOW + WINDOW)).toBe("/messages");
  });

  it("drops a route once past the window (next-morning cold start)", () => {
    rememberRoute("/messages");
    expect(readRestorableRoute(NOW + WINDOW + 1)).toBeNull();
  });

  it("drops a timestamp from the future rather than trusting it", () => {
    // A device clock change must not pin a route as permanently 'fresh'.
    localStorage.setItem(KEY, JSON.stringify({ p: "/messages", t: NOW + 60_000 }));
    expect(readRestorableRoute(NOW)).toBeNull();
  });
});

describe("hostile / corrupt stored values", () => {
  // A bad value should land the user on the dashboard, never on an error
  // boundary — this runs during launch, before anything can catch a throw.
  it.each([
    ["not json at all", "{{{"],
    ["a bare string", '"/messages"'],
    ["null", "null"],
    ["an array", "[]"],
    ["missing timestamp", JSON.stringify({ p: "/messages" })],
    ["missing path", JSON.stringify({ t: NOW })],
    ["numeric path", JSON.stringify({ p: 42, t: NOW })],
    ["string timestamp", JSON.stringify({ p: "/messages", t: "recent" })],
  ])("returns null for %s", (_label, raw) => {
    localStorage.setItem(KEY, raw);
    expect(() => readRestorableRoute()).not.toThrow();
    expect(readRestorableRoute()).toBeNull();
  });

  it("re-validates the stored path, not just its shape", () => {
    // A path that was restorable when written could be de-listed later; the
    // read side must not assume the write side agreed with it.
    localStorage.setItem(KEY, JSON.stringify({ p: "/reset-password", t: NOW }));
    expect(readRestorableRoute()).toBeNull();
  });
});
