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
// @mutate src/pages/home/fetchGuestJobs.ts | const prefetched = await takeGuestJobsPrefetch(); | const prefetched = null;
// @mutate src/entry.ts | startGuestJobsPrefetch(window.location.pathname); | void 0;
// F010 (owner's UI audit 11-09): the landing's "Open jobs near you" read also starts at the entry on a signed-out "/".
// @mutate src/boot/guestJobsPrefetch.ts |   if ((path !== "/browse" && path !== "/") \|\| hasToken() | if (path !== "/browse" \|\| hasToken()
// @mutate src/boot/guestJobsPrefetch.ts |   u.searchParams.set("limit", String(LANDING_LIMIT)); |   u.searchParams.set("limit", "40");
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  GUEST_JOBS_PREFETCH_KEY,
  guestJobsRestUrl,
  LANDING_JOBS_PREFETCH_KEY,
  landingJobsRestUrl,
  startGuestJobsPrefetch,
} from "@/boot/guestJobsPrefetch";
import { LANDING_JOBS_PREFETCH_MAX_AGE_MS, takeLandingJobsPrefetch } from "@/components/landing/LiveJobsSection";
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
  (window as unknown as Record<string, unknown>)[LANDING_JOBS_PREFETCH_KEY] = undefined;
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
    // The queryFn lives in fetchGuestJobs.ts (moved whole, 2026-10-05) and DashboardGuest calls it.
    expect(code("src/pages/home/DashboardGuest.tsx")).toMatch(/queryFn: fetchGuestJobs,/);
    const src = code("src/pages/home/fetchGuestJobs.ts");
    expect(src).toMatch(/const prefetched = await takeGuestJobsPrefetch\(\);/);
    expect(src).toMatch(
      // Q1461: through readJobsAheadOfDb, which hands the shared select (or it minus a column the database lacks) to `columns`.
      /readJobsAheadOfDb\(GUEST_JOBS_SELECT, \(columns\) => supabase\s*\.from\("open_jobs_browse"\)\s*\.select\(columns\)\s*\.neq\("payment_status", "abandoned"\)\s*\.order\("boosted_at", \{ ascending: false, nullsFirst: false \}\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(GUEST_JOBS_LIMIT\)/,
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
    startGuestJobsPrefetch("/home");
    startGuestJobsPrefetch("/browse/x");
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

describe("the landing's jobs read starts at the entry (F010, 11-09)", () => {
  const liveSrc = () => readFileSync(resolve(ROOT, "src/components/landing/LiveJobsSection.tsx"), "utf8");

  it("its URL is the one supabase-js builds for LiveJobsSection's query", () => {
    const select = /const LIVE_JOBS_SELECT =\s*"([^"]+)";/.exec(liveSrc())?.[1];
    expect(select).toBeTruthy();
    expect(code("src/components/landing/LiveJobsSection.tsx")).toMatch(
      /\.from\("open_jobs_browse"\)\s*\.select\(columns\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(LIVE_JOBS_LIMIT\)/,
    );
    expect(/const LIVE_JOBS_LIMIT = (\d+);/.exec(liveSrc())?.[1]).toBe("4");
    const base = "https://proj.supabase.co";
    const q = createClient(base, "k")
      .from("open_jobs_browse")
      .select(select!)
      .order("created_at", { ascending: false })
      .limit(4) as unknown as { url: URL };
    expect(landingJobsRestUrl(base)).toBe(q.url.toString());
  });

  it("the hand-over key is the same on both sides", () => {
    expect(code("src/components/landing/LiveJobsSection.tsx")).toContain(`const LANDING_JOBS_PREFETCH_KEY = "${LANDING_JOBS_PREFETCH_KEY}";`);
  });

  it("fires for a signed-out \"/\" only, and hands the rows out once", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => [{ id: "j" }] }));
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sb-proj-auth-token", "{}");
    startGuestJobsPrefetch("/");
    expect(fetchMock, "a signed-in visitor goes to /home; no prefetch").not.toHaveBeenCalled();
    localStorage.clear();
    startGuestJobsPrefetch("/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/open_jobs_browse?select=id%2Ctitle%2Cbudget");
    expect(takeGuestJobsPrefetch(), "the /browse slot is untouched").toBeNull();
    expect(await takeLandingJobsPrefetch()).toEqual([{ id: "j" }]);
    expect(takeLandingJobsPrefetch(), "a retry reaches the server").toBeNull();
  });

  it("a failed or old prefetch hands out nothing usable, so the section asks Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    startGuestJobsPrefetch("/");
    expect(await takeLandingJobsPrefetch()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    startGuestJobsPrefetch("/");
    expect(await takeLandingJobsPrefetch()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    startGuestJobsPrefetch("/");
    expect(takeLandingJobsPrefetch(Date.now() + LANDING_JOBS_PREFETCH_MAX_AGE_MS + 1)).toBeNull();
  });
});
