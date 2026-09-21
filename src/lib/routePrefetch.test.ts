/*
 * routePrefetch warms route chunks on hover/focus/idle.
 *
 * THIS FILE WAS HOLLOW until 2026-09-21. Every one of its six assertions was
 * `expect(() => prefetchRoute(x)).not.toThrow()`, while its header claimed to
 * cover "exact-path matching", "prefix matching for parameterized routes" and
 * "'warmed' cache prevents duplicate fetches". It covered none of them: a
 * `prefetchRoute` whose entire body was deleted passes all six, because doing
 * nothing does not throw. The one thing it proved — that a hover handler does
 * not explode — is worth keeping and is kept below, but it is not the guard.
 *
 * What makes the behaviour observable is that each prefetcher is a dynamic
 * `import()` of a real page module, so mocking those modules with factories
 * that record a call turns "did it warm the right chunk?" into an assertion.
 * That is the axis where the real bug lived: `/support` used to map to the
 * Profile chunk, so hovering the footer link warmed a chunk the route never
 * renders — silently, costing exactly the latency the map exists to remove.
 *
 * WHAT THIS STILL CANNOT SEE, stated rather than implied: the `warmed` set is
 * module-private and each mock factory runs once per module registry, so a
 * second call to an already-warmed path is indistinguishable from a second
 * call that was correctly suppressed. Deleting `warmed` would not fail this
 * file. Making that observable needs the prefetcher map injected, which is a
 * production change this file does not justify on its own.
 */

import { describe, it, expect, vi } from "vitest";

const PAGES: [string, string][] = [
  ["@/pages/Dashboard", "Dashboard"],
  ["@/pages/Profile", "Profile"],
  ["@/pages/PostJob", "PostJob"],
  ["@/pages/Activity", "Activity"],
  ["@/pages/Messages", "Messages"],
  ["@/pages/Support", "Support"],
  ["@/pages/Login", "Login"],
  ["@/pages/Signup", "Signup"],
  ["@/pages/AccountPending", "AccountPending"],
  ["@/pages/UserProfile", "UserProfile"],
  ["@/pages/DashboardGuest", "DashboardGuest"],
  ["@/pages/Legal", "Legal"],
  ["@/pages/HelpCenter", "HelpCenter"],
];

const loaded: string[] = [];

/**
 * `vi.doMock`, not `vi.mock`, and re-registered inside every case.
 *
 * A hoisted `vi.mock` factory is evaluated ONCE per test file, so a recording
 * factory only ever records the FIRST import of that module — every later case
 * touching the same page sees an empty array whether the code works or not.
 * That is a vacuity of exactly the kind this file is being rewritten to remove,
 * and it showed up immediately: /terms passed while /rules and /privacy
 * "failed" for no reason but ordering.
 *
 * `vi.doMock` is not hoisted and applies to imports made after it, so pairing
 * it with `vi.resetModules()` gives each case a genuinely fresh registry.
 */
async function loadFresh() {
  vi.resetModules();
  loaded.length = 0;
  for (const [spec, name] of PAGES) {
    vi.doMock(spec, () => {
      loaded.push(name);
      return { default: () => null };
    });
  }
  return await import("./routePrefetch");
}

/** Prefetch is fire-and-forget; let the dynamic import settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("prefetchRoute — which chunk it warms", () => {
  it("warms the chunk an exact path maps to", async () => {
    const { prefetchRoute } = await loadFresh();
    prefetchRoute("/dashboard");
    await settle();
    expect(loaded).toContain("Dashboard");
  });

  it("resolves a parameterized path by prefix (/user/:id -> /user)", async () => {
    const { prefetchRoute } = await loadFresh();
    prefetchRoute("/user/abc-123");
    await settle();
    expect(
      loaded,
      "a profile link with an id in it warmed nothing — prefix matching is the " +
        "only reason /user/:id, the most-hovered link in the app, is covered at all",
    ).toContain("UserProfile");
  });

  it("warms NOTHING for a path with no entry", async () => {
    const { prefetchRoute } = await loadFresh();
    prefetchRoute("/nonexistent-route");
    await settle();
    expect(loaded).toEqual([]);
  });

  it("/support warms Support, not Profile (the regression the map comment records)", async () => {
    // This key used to point at the Profile chunk while /support was a redirect
    // into the Profile tab system. Once /support became its own page the key was
    // stale, so hovering the footer link warmed a chunk the route never renders
    // — the exact cost the map exists to avoid, paid silently.
    const { prefetchRoute } = await loadFresh();
    prefetchRoute("/support");
    await settle();
    expect(loaded).toContain("Support");
    expect(loaded).not.toContain("Profile");
  });

  // One case each, NOT a loop: `vi.resetModules()` in the middle of a test does
  // not re-run an already-evaluated mock factory, so a second iteration sees an
  // empty `loaded` whether the code works or not — a loop here would have been
  // its own small vacuity. `beforeEach` is what actually gives each case a
  // fresh registry.
  //
  // /terms, /rules and /privacy are real routes rather than redirects, so a
  // lone /legal key would not resolve any of them by prefix. Each needs its
  // own entry, and the footer is the surface where that was missed.
  it.each(["/terms", "/rules", "/privacy"])(
    "%s warms the Legal chunk on its own",
    async (path) => {
      const { prefetchRoute } = await loadFresh();
      prefetchRoute(path);
      await settle();
      expect(loaded, `${path} warmed nothing`).toContain("Legal");
    },
  );
});

describe("prefetchRoute — never breaks the interaction it is attached to", () => {
  it("does NOT throw on empty / null / undefined path", async () => {
    const { prefetchRoute } = await loadFresh();
    expect(() => prefetchRoute("")).not.toThrow();
    expect(() => prefetchRoute(null as unknown as string)).not.toThrow();
    expect(() => prefetchRoute(undefined as unknown as string)).not.toThrow();
  });

  it("does NOT throw on an unknown path (silent no-op)", async () => {
    const { prefetchRoute } = await loadFresh();
    expect(() => prefetchRoute("/nonexistent-route")).not.toThrow();
    expect(() => prefetchRoute("/admin/users/123/audit")).not.toThrow();
  });

  it("is fire-and-forget — returns void, with no promise to await", async () => {
    const { prefetchRoute } = await loadFresh();
    expect(prefetchRoute("/dashboard")).toBeUndefined();
  });

  it("repeat calls for the same path stay silent", async () => {
    // NOT a proof of the `warmed` set — see the header. This pins that the
    // second call is harmless, which is all a hover handler needs.
    const { prefetchRoute } = await loadFresh();
    prefetchRoute("/dashboard");
    expect(() => prefetchRoute("/dashboard")).not.toThrow();
    expect(() => prefetchRoute("/dashboard")).not.toThrow();
  });
});

// Prefix matching is what covers every parameterized route in the app —
// /user/:id, /jobs/:id and the admin paths. Without it a hover on any link
// carrying an id warms nothing at all, and the chunk waterfall this module
// exists to remove is paid in full at the tap. The old suite, being entirely
// `not.toThrow()`, was green for that.
// @mutate src/lib/routePrefetch.ts | : Object.keys(prefetchers).find((p) => path.startsWith(p)); | : undefined;
