/**
 * B78 (11-01): the entry starts Home's first-card reads (useFirstJobState's three) beside the app download, and the
 * query takes that answer once instead of asking again. The prefetch is a plain fetch (the entry must not import
 * Supabase), so its URLs are hand-built; this builds the query's reads with supabase-js itself and requires the same
 * URLs, so the copies cannot drift.
 */
// @mutate src/boot/homePrefetch.ts | if (path !== "/home" \|\| typeof fetch !== "function") return; | if (typeof fetch !== "function") return;
// @mutate src/boot/homePrefetch.ts | jobs.searchParams.set("or", `(customer_id.eq.${userId},helper_id.eq.${userId})`); | jobs.searchParams.set("or", `(customer_id.eq.${userId})`);
// @mutate src/boot/homePrefetch.ts | if (appCount === null \|\| jobCount === null \|\| !Array.isArray(prefs) \|\| prefs.length > 1) return null; | if (appCount === null \|\| jobCount === null \|\| !Array.isArray(prefs)) return null;
// @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   w[KEY] = undefined; |
// @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   if (!s \|\| now - s.at > HOME_PREFETCH_MAX_AGE_MS \|\| s.userId !== userId) return null; |   if (!s \|\| now - s.at > HOME_PREFETCH_MAX_AGE_MS) return null;
// @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |       if (pre) return firstJobState(pre.appCount, pre.jobCount, pre.prefs); |
// @mutate src/boot/signedInPrefetch.ts |   startHomePrefetch(pathname); |
// @mutate src/entry.ts | /^\/(declutter\|home)\/?$/.test(window.location.pathname) | /^\/(declutter)\/?$/.test(window.location.pathname)
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createClient } from "@supabase/supabase-js";

import { HOME_PREFETCH_KEY, homeFirstJobUrls, startHomePrefetch } from "./homePrefetch";
import { HOME_PREFETCH_MAX_AGE_MS, takeHomeFirstJobPrefetch } from "@/pages/home/homeDashboard/homePrefetchTake";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const db = vi.hoisted(() => ({ calls: [] as string[], pending: 0, maxPending: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      db.calls.push(table);
      const settle = <T,>(v: T) => {
        db.pending++;
        db.maxPending = Math.max(db.maxPending, db.pending);
        return new Promise<T>((r) => setTimeout(() => { db.pending--; r(v); }, 5));
      };
      const counted = { data: null, error: null, status: 200, count: 0 };
      const chain = {
        select: () => chain,
        eq: () => (table === "notification_preferences" ? chain : settle(counted)),
        or: () => settle(counted),
        maybeSingle: () => settle({ data: null, error: null, status: 200 }),
      };
      return chain;
    },
  },
}));
const { useFirstJobState } = await import("@/pages/home/homeDashboard/FirstJobHome");

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const session = (expiresInS: number, id = UID) =>
  JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id } });
const res = (o: { ok?: boolean; range?: string; body?: unknown }) =>
  ({ ok: o.ok ?? true, headers: new Headers(o.range ? { "content-range": o.range } : {}), json: async () => o.body }) as unknown as Response;
/** A fetch answering the three reads: counts on HEAD, the alert settings row(s) on GET. */
const answering = (apps: string, jobs: string, prefs: unknown) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "HEAD") return res({ range: url.includes("/applications") ? apps : jobs });
    return res({ body: prefs });
  });

afterEach(() => {
  (window as unknown as Record<string, unknown>)[HOME_PREFETCH_KEY] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  db.calls.length = 0; db.pending = 0; db.maxPending = 0;
});

function signIn(expiresInS = 3600, id = UID) {
  vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem("sb-proj-auth-token", session(expiresInS, id));
}

describe("Home's first-card reads start from the entry (B78)", () => {
  it("its URLs are the ones supabase-js builds for useFirstJobState's three reads", () => {
    const base = "https://proj.supabase.co";
    const sb = createClient(base, "k");
    const url = (q: unknown) => (q as { url: URL }).url.toString();
    const want = {
      applications: url(sb.from("applications").select("id", { count: "exact", head: true }).eq("helper_id", UID)),
      jobs: url(sb.from("jobs").select("id", { count: "exact", head: true }).or(`customer_id.eq.${UID},helper_id.eq.${UID}`)),
      prefs: url(sb.from("notification_preferences").select("job_matches, email_job_matches").eq("user_id", UID).maybeSingle()),
    };
    expect(homeFirstJobUrls(base, UID)).toEqual(want);
    // ...and the query asks exactly those (the same chains, in FirstJobHome.tsx).
    const src = code("src/pages/home/homeDashboard/FirstJobHome.tsx");
    expect(src).toMatch(/\.from\("applications"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("helper_id", userId!\)/);
    expect(src).toMatch(/\.from\("jobs"\)\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\.or\(`customer_id\.eq\.\$\{userId\},helper_id\.eq\.\$\{userId\}`\)/);
    expect(src).toMatch(/\.from\("notification_preferences"\)\.select\("job_matches, email_job_matches"\)\.eq\("user_id", userId!\)\.maybeSingle\(\)/);
  });

  it("the entry starts it only for a member on /home, and only the entry imports the boot module", () => {
    const entry = code("src/entry.ts");
    expect(entry).toMatch(/if \(hasToken\(\) && \/\^\\\/\(declutter\|home\)\\\/\?\$\/\.test\(window\.location\.pathname\)\) \{\s*void signedInPrefetch\(\)\s*\.then\(\(m\) => m\?\.startSignedInPrefetch\(window\.location\.pathname\)\)/);
    expect(entry).toContain('const signedInPrefetch = () => import("./boot/signedInPrefetch");');
    expect(code("src/boot/signedInPrefetch.ts")).toContain("startHomePrefetch(pathname);");
    expect(code("src/pages/home/homeDashboard/homePrefetchTake.ts")).toContain(`const KEY = "${HOME_PREFETCH_KEY}";`);
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /(from ["']|import\(["'])(@\/boot|\.\/boot|\.\.?\/)[^"']*homePrefetch["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/boot/signedInPrefetch.ts"]);
  });

  it("fires nothing for a guest, another route, or a session about to expire", () => {
    const f = answering("*/0", "*/0", []);
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    startHomePrefetch("/home");
    expect(f, "guest").not.toHaveBeenCalled();
    signIn(30);
    startHomePrefetch("/home");
    expect(f, "a token with under a minute left is supabase-js's to refresh").not.toHaveBeenCalled();
    localStorage.clear();
    signIn();
    for (const p of ["/", "/browse", "/jobs", "/home/x", "/declutter"]) startHomePrefetch(p);
    expect(f, "other routes").not.toHaveBeenCalled();
    startHomePrefetch("/home/");
    expect(f).toHaveBeenCalledTimes(3);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    for (const [, init] of calls) expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls.filter(([, i]) => i.method === "HEAD").every(([, i]) => (i.headers as Record<string, string>).Prefer === "count=exact")).toBe(true);
  });

  it("hands the answer out once, to the member it was read for", async () => {
    signIn();
    vi.stubGlobal("fetch", answering("*/0", "*/2", [{ job_matches: false, email_job_matches: false }]));
    startHomePrefetch("/home");
    expect(await takeHomeFirstJobPrefetch("someone-else"), "another member's answer").toBeNull();
    startHomePrefetch("/home");
    expect(await takeHomeFirstJobPrefetch(UID)).toEqual({ appCount: 0, jobCount: 2, prefs: { job_matches: false, email_job_matches: false } });
    expect(await takeHomeFirstJobPrefetch(UID), "a second take (a refetch) must reach the server").toBeNull();
  });

  it("a failed, odd or old answer hands out nothing, so the query reads for itself", async () => {
    signIn();
    const cases: [string, ReturnType<typeof vi.fn>][] = [
      ["no count", answering("", "*/0", [])],
      ["two settings rows (maybeSingle's error)", answering("*/0", "*/0", [{}, {}])],
      ["settings not a list", answering("*/0", "*/0", { message: "x" })],
      ["refused", vi.fn(async () => res({ ok: false }))],
      ["offline", vi.fn(async () => { throw new TypeError("Failed to fetch"); })],
    ];
    expect(cases.length).toBeGreaterThan(4);
    for (const [why, f] of cases) {
      vi.stubGlobal("fetch", f);
      startHomePrefetch("/home");
      expect(await takeHomeFirstJobPrefetch(UID), why).toBeNull();
    }
    vi.stubGlobal("fetch", answering("*/0", "*/0", []));
    startHomePrefetch("/home");
    expect(await takeHomeFirstJobPrefetch(UID, Date.now() + HOME_PREFETCH_MAX_AGE_MS + 1), "old").toBeNull();
  });

  function hook() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(() => useFirstJobState(UID), { wrapper });
  }

  it("useFirstJobState takes the entry's answer and asks Supabase nothing (no double read)", async () => {
    signIn();
    vi.stubGlobal("fetch", answering("*/0", "*/0", [{ job_matches: false, email_job_matches: false }]));
    startHomePrefetch("/home");
    const { result } = hook();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({ isNew: true, alertsOff: true });
    expect(db.calls).toEqual([]);
  });

  it("without it, the three reads go out together, not one after another", async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(db.calls.sort()).toEqual(["applications", "jobs", "notification_preferences"]);
    expect(db.maxPending).toBe(3);
  });
});
