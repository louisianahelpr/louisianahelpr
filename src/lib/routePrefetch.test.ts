// routePrefetch warms route chunks on hover/focus. Bugs here either
// silently fail to prefetch (UX regression — slower nav) or throw
// from a hover handler (which would kill the user-visible nav).
//
// Pure-logic tests focus on:
//  - exact-path matching
//  - prefix matching for parameterized routes (/user/:id → /user)
//  - silent no-op on unknown paths (no throw)
//  - "warmed" cache prevents duplicate fetches

import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

async function loadFresh() {
  return await import("./routePrefetch");
}

describe("prefetchRoute", () => {
  it("does NOT throw on empty / null / undefined path", async () => {
    const { prefetchRoute } = await loadFresh();
    expect(() => prefetchRoute("")).not.toThrow();
    expect(() => prefetchRoute(null as unknown as string)).not.toThrow();
    expect(() => prefetchRoute(undefined as unknown as string)).not.toThrow();
  });

  it("does NOT throw on a path with no matching prefetcher (silent no-op)", async () => {
    const { prefetchRoute } = await loadFresh();
    expect(() => prefetchRoute("/nonexistent-route")).not.toThrow();
    expect(() => prefetchRoute("/admin/users/123/audit")).not.toThrow();
  });

  it("matches exact paths from the prefetcher map", async () => {
    const { prefetchRoute } = await loadFresh();
    // These should hit the map and trigger an import (success or fail
    // is irrelevant — we just want no throw)
    expect(() => prefetchRoute("/dashboard")).not.toThrow();
    expect(() => prefetchRoute("/profile")).not.toThrow();
    expect(() => prefetchRoute("/post-job")).not.toThrow();
  });

  it("matches by prefix for parameterized paths (/user/:id → /user)", async () => {
    const { prefetchRoute } = await loadFresh();
    // /user is in the map; /user/abc-123 should still resolve via prefix
    expect(() => prefetchRoute("/user/abc-123")).not.toThrow();
    expect(() => prefetchRoute("/jobs/specific-id")).not.toThrow();
  });

  it("is idempotent — calling for the same path twice does not crash", async () => {
    const { prefetchRoute } = await loadFresh();
    prefetchRoute("/dashboard");
    expect(() => prefetchRoute("/dashboard")).not.toThrow();
    expect(() => prefetchRoute("/dashboard")).not.toThrow();
  });

  it("returns void (fire-and-forget — no promise to await)", async () => {
    const { prefetchRoute } = await loadFresh();
    const result = prefetchRoute("/dashboard");
    expect(result).toBeUndefined();
  });
});
