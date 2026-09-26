/**
 * Q206 (b) — the entry's guest /browse prefetch asks for EXACTLY what
 * DashboardGuest's query asks for, and DashboardGuest takes it.
 *
 * The prefetch is a plain fetch (the entry must not import Supabase), so its
 * URL is hand-built. If it drifted from the query, /browse would render rows
 * of a different shape or order than the query would have returned. This builds
 * DashboardGuest's query with supabase-js itself and requires the same URL.
 *
 * Measured (production build, 375, 1.6 Mbps / 150 ms RTT, 4x CPU, prod data,
 * scripts/perf/measure-load.mjs, 3 runs): first card median 4929 ms before,
 * jobs request starting at 3796 ms; the after numbers are in docs/OPEN.md Q206.
 */
// @mutate src/boot/guestJobsPrefetch.ts | u.searchParams.set("order", "boosted_at.desc.nullslast,created_at.desc"); | u.searchParams.set("order", "created_at.desc");
// @mutate src/pages/home/DashboardGuest.tsx | const prefetched = await takeGuestJobsPrefetch(); | const prefetched = null;
// @mutate src/entry.ts | startGuestJobsPrefetch(window.location.pathname); | void 0;
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { GUEST_JOBS_PREFETCH_KEY, guestJobsRestUrl, startGuestJobsPrefetch } from "@/boot/guestJobsPrefetch";
import {
  GUEST_JOBS_LIMIT,
  GUEST_JOBS_PREFETCH_MAX_AGE_MS,
  GUEST_JOBS_SELECT,
  takeGuestJobsPrefetch,
} from "@/lib/guestJobsQuery";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

afterEach(() => {
  (window as unknown as Record<string, unknown>)[GUEST_JOBS_PREFETCH_KEY] = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("guest /browse prefetch (Q206 b)", () => {
  it("its URL is the one supabase-js builds for DashboardGuest's query", () => {
    const base = "https://proj.supabase.co";
    const q = createClient(base, "k")
      .from("open_jobs_browse")
      .select(GUEST_JOBS_SELECT)
      .neq("payment_status", "abandoned")
      .order("boosted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(GUEST_JOBS_LIMIT) as unknown as { url: URL };
    expect(guestJobsRestUrl(base)).toBe(q.url.toString());
  });

  it("DashboardGuest's fallback query is the same chain, over the shared select", () => {
    const src = code("src/pages/home/DashboardGuest.tsx");
    expect(src).toMatch(/const prefetched = await takeGuestJobsPrefetch\(\);/);
    expect(src).toMatch(
      /\.from\("open_jobs_browse"\)\s*\.select\(GUEST_JOBS_SELECT\)\s*\.neq\("payment_status", "abandoned"\)\s*\.order\("boosted_at", \{ ascending: false, nullsFirst: false \}\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(GUEST_JOBS_LIMIT\)/,
    );
    expect(code("src/entry.ts")).toMatch(/startGuestJobsPrefetch\(window\.location\.pathname\);/);
  });

  it("the hand-over key is the same on both sides, and only the entry imports the boot module", () => {
    expect(code("src/lib/guestJobsQuery.ts")).toContain(`const KEY = "${GUEST_JOBS_PREFETCH_KEY}";`);
    // A lazy page importing the boot module makes it a shared chunk every
    // page chunk waits on (measured: every route's page chunk moved to round 3).
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /from ["'](@\/boot|\.\/boot|\.\.?\/)[^"']*guestJobsPrefetch["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/entry.ts"]);
  });

  it("fires only for a signed-out /browse, once, and hands the rows out once", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{ id: "a" }] }));
    vi.stubGlobal("fetch", fetchMock);
    startGuestJobsPrefetch("/");
    startGuestJobsPrefetch("/home");
    expect(fetchMock).not.toHaveBeenCalled();
    localStorage.setItem("sb-proj-auth-token", "{}");
    startGuestJobsPrefetch("/browse");
    expect(fetchMock, "a signed-in visitor is redirected; no prefetch").not.toHaveBeenCalled();
    localStorage.clear();
    startGuestJobsPrefetch("/browse/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await takeGuestJobsPrefetch()).toEqual([{ id: "a" }]);
    expect(takeGuestJobsPrefetch(), "a second take (a refetch) must reach the server").toBeNull();
  });

  it("a failed or old prefetch hands out nothing usable, so the queryFn asks Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    startGuestJobsPrefetch("/browse");
    expect(await takeGuestJobsPrefetch()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    startGuestJobsPrefetch("/browse");
    expect(await takeGuestJobsPrefetch()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    startGuestJobsPrefetch("/browse");
    expect(takeGuestJobsPrefetch(Date.now() + GUEST_JOBS_PREFETCH_MAX_AGE_MS + 1)).toBeNull();
  });
});
