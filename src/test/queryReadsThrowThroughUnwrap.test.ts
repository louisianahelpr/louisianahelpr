/**
 * EVERY READ THROWS THROUGH unwrap() (docs/OPEN.md Q1182, follow-up of Q1164).
 *
 * The read-retry policy (src/lib/queryRetry.ts) never retries a 4xx, and it
 * finds the status where unwrap() (src/lib/supabaseResult.ts) puts it: postgrest-js
 * keeps the HTTP status on the RESPONSE, and unwrap() copies it onto the error it
 * throws. A query function that throws the Supabase error object itself
 * (`if (error) throw error`, `throw res.error`) hands React Query an error with
 * no status. For most reads the PostgREST code still maps to one, but not for a
 * HEAD count: `select(..., { head: true })` has no body, so postgrest-js builds
 * `{ message: "" }`, with no code either. useDashboardJobsCount's refused count
 * was sent twice (4 error_logs rows on 2026-10-02), and HelprWrapped's
 * `new Error(coreErrors[0].message)` dropped the code as well.
 *
 * Measured on origin/main 2026-10-03 (before this fix): 110 query functions
 * (89 `queryFn` properties + 21 useInstantQuery fetchers), 38 raw throws, one
 * re-wrapped error (HelprWrapped) and one result rebuilt without its status
 * (userBlocks' shared read, which unwrap() downstream could never fix), 40
 * statements in all, reached from 42 query functions. The inventory and the
 * rules are in src/test/helpers/queryFnReach.ts.
 *
 * @mutate src/hooks/useDashboardJobsCount.ts |       unwrap(result);\n      return result.count ?? 0; |       if (result.error) throw result.error;\n      return result.count ?? 0;
 * @mutate src/lib/seriesDates.ts |     unwrap(r); |     if (r.error) throw r.error;
 * @mutate src/hooks/useCurrentUser.ts |     (result) => unwrap(result) ?? null, |     ({ data, error }) => { if (error) throw error; return data ?? null; },
 * @mutate src/components/admin/adminHealth/useHealthData.ts |       unwrap(fraudRes); |       const { error: fcErr } = fraudRes; if (fcErr) throw fcErr;
 * @mutate src/pages/profile/HelprWrapped.tsx |     unwrap(postedRes); |     throw new Error(coreErrors[0].message \|\| "Couldn't load your Helpr year.");
 * @mutate src/lib/userBlocks.ts |     .then(({ data, error, status }) => ({ data, error, status })) |     .then(({ data, error }) => ({ data, error }))
 * @mutate src/hooks/useActivityData.ts |   unwrap(appsRes);\n  unwrap(directOffersRes); |   const primaryError = appsRes.error \|\| directOffersRes.error;\n  if (primaryError) throw primaryError;
 * @mutate src/hooks/useDashboardData.ts |     unwrap(blocksRes); |     if (blocksRes.error) { throw blocksRes.error; }
 * @mutate src/components/profile/TwoFactorCard.tsx |       const list = unwrap(await supabase.auth.mfa.listFactors()); |       const listRes = await supabase.auth.mfa.listFactors(); if (listRes.error) throw listRes.error; const list = listRes.data;
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useDashboardJobsCount } from "@/hooks/useDashboardJobsCount";
import { MAX_HOPS, QueryFnReach, type ReachReport } from "./helpers/queryFnReach";
import { walkSource } from "./helpers/walkSource";

/*
 * The real supabase-js client, with a fetch that answers every request the way
 * PostgREST refuses a HEAD: a status and no body. Used by the last block below
 * to measure the finding itself.
 */
const rig = vi.hoisted(() => ({ requests: [] as string[], status: 401 }));
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://example.supabase.co", "anon-key", {
      global: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          rig.requests.push(`${init?.method ?? "GET"} ${String(input)}`);
          return new Response(null, { status: rig.status });
        }) as typeof fetch,
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
});

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");
const SANCTIONED = join(SRC, "lib", "supabaseResult.ts");

/** App source: every .ts/.tsx under src/ except tests, the test tree and declarations. */
function appSources(): Map<string, string> {
  const files = walkSource([SRC]).filter(
    (f) => !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"),
  );
  return new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
}

/** One block per offending statement, listing every query function that reaches it. */
function describeViolations(violations: ReachReport["violations"]): string[] {
  const byStatement = new Map<string, ReachReport["violations"]>();
  for (const v of violations) byStatement.set(v.at, [...(byStatement.get(v.at) ?? []), v]);
  return [...byStatement.values()].map(
    (vs) =>
      `${vs[0].at} [${vs[0].kind}] ${vs[0].code}\n` +
      vs.map((v) => `      <- queryFn at ${v.site} (${v.via})${v.chain.length ? ` through ${v.chain.join(" > ")}` : ""}`).join("\n"),
  );
}

describe("every React Query read throws through unwrap() (Q1182)", () => {
  const sources = appSources();
  const report = new QueryFnReach(sources, REPO, SRC, [SANCTIONED]).run();

  it("inventories the query functions from the source, wrappers included", () => {
    // 110 on 2026-10-03. A scan that finds none, or loses a whole entry point,
    // would pass every check below.
    expect(sources.size).toBeGreaterThan(800);
    expect(report.sites.length).toBeGreaterThan(100);
    const via = (name: string) => report.sites.filter((s) => s.via === name).length;
    expect(via("useQuery")).toBeGreaterThan(60);
    expect(via("prefetchQuery")).toBeGreaterThan(5);
    // useInstantQuery is found as a wrapper (its queryFn is its `fetcher`
    // parameter), and each admin screen's fetcher becomes a site of its own.
    expect(report.wrappers).toContain("useInstantQuery.fetcher (src/hooks/useInstantQuery.ts)");
    expect(via("useInstantQuery")).toBeGreaterThan(15);
  });

  it("follows the functions each query function calls, and reads the throws it reaches", () => {
    // 2026-10-03, MAX_HOPS 4: 751 functions followed; 54 throw statements
    // reached before this fix, 14 after it (catch-block rethrows,
    // functionInvokeError, errors the app makes itself), 3 of them 2+ hops
    // down. At 10 hops: 952 functions and no further throw; the deepest
    // finding before the fix was at hop 2.
    expect(MAX_HOPS).toBeGreaterThan(2);
    expect(report.functionsFollowed).toBeGreaterThan(500);
    expect(report.reachedThrows.length).toBeGreaterThan(10);
    expect(report.reachedThrows.filter((t) => t.hop >= 2).length).toBeGreaterThan(0);
  });

  it("leaves no query function the scan cannot read", () => {
    expect(report.unfollowable, report.unfollowable.join("\n")).toEqual([]);
  });

  it("no query function throws a Supabase error without unwrap()", () => {
    const lines = describeViolations(report.violations);
    expect(
      [...new Set(report.violations.map((v) => `${v.at} [${v.kind}]`))],
      `\n${lines.length} statement(s) reachable from a React Query queryFn lose the HTTP status the retry ` +
        `policy reads (src/lib/queryRetry.ts). Throw through unwrap() (src/lib/supabaseResult.ts) instead:\n` +
        `  const rows = unwrap(await supabase.from(...)...);   // or, to keep count: unwrap(res); return res.count ?? 0;\n` +
        `(The rule matches by name: any \`.error\` / \`{ data, error }\`. If the flagged value is not a Supabase result,\n` +
        ` e.g. an edge function's JSON \`{ error }\`, rename it rather than wrapping it in unwrap().)\n\n` +
        lines.join("\n"),
    ).toEqual([]);
  });
});

// ── the scanner itself, on fixtures: every entry point, every spelling ─────
const FX = "/fx";
const FX_SRC = `${FX}/src`;

const FIXTURES: Record<string, string> = {
  "lib/supabaseResult.ts": [
    "export function unwrap(result) {",
    "  const { data, error } = result;",
    "  if (error) throw error;",
    "  return data;",
    "}",
    "export async function functionInvokeError(error) { return error; }",
  ].join("\n"),
  "lib/deep.ts": [
    'import { supabase } from "@/integrations/supabase/client";',
    "async function innerRead() {",
    '  const deepRes = await supabase.from("jobs").select("id");',
    "  if (deepRes.error) throw deepRes.error;",
    "  return deepRes.data;",
    "}",
    "export async function fetchDeep() {",
    "  return innerRead();",
    "}",
  ].join("\n"),
  "lib/barrelTarget.ts": [
    'import { supabase } from "@/integrations/supabase/client";',
    "export const loadViaBarrel = async () => {",
    '  const { data, error: barrelErr } = await supabase.rpc("get_public_profile_stats", { p_user_ids: [] });',
    "  if (barrelErr) {",
    "    throw barrelErr;",
    "  }",
    "  return data;",
    "};",
  ].join("\n"),
  "lib/barrel.ts": 'export { loadViaBarrel } from "./barrelTarget";',
  "lib/starTarget.ts": [
    'import { supabase } from "@/integrations/supabase/client";',
    "export async function loadViaStar() {",
    '  const { error: starErr } = await supabase.from("reviews").select("id");',
    "  if (starErr) throw starErr;",
    "}",
  ].join("\n"),
  "lib/star.ts": 'export * from "./starTarget";',
  "lib/nsApi.ts": [
    'import { supabase } from "@/integrations/supabase/client";',
    "export async function load() {",
    '  const { data, error: nsErr } = await supabase.from("applications").select("id");',
    "  if (nsErr) throw nsErr;",
    "  return data;",
    "}",
  ].join("\n"),
  "lib/defaultApi.ts": [
    'import { supabase } from "@/integrations/supabase/client";',
    "export default async function loadDefault() {",
    '  const defRes = await supabase.from("profiles").select("id");',
    "  const defErr = defRes.error;",
    "  if (defErr) throw defErr;",
    "  return defRes.data;",
    "}",
  ].join("\n"),
  "lib/sharedRead.ts": [
    'import { supabase } from "@/integrations/supabase/client";',
    "export function readRows() {",
    '  return supabase.from("jobs").select("id").then(({ data, error }) => ({ data, error }));',
    "}",
  ].join("\n"),
  "hooks/useInstant.ts": [
    'import { useQuery } from "@tanstack/react-query";',
    "export function useInstant({ key, fetcher }) {",
    "  return useQuery({ queryKey: key, queryFn: fetcher });",
    "}",
  ].join("\n"),
  "hooks/useCases.ts": [
    'import { useCallback } from "react";',
    'import { useQuery, useInfiniteQuery, useQueries, useMutation } from "@tanstack/react-query";',
    'import { supabase } from "@/integrations/supabase/client";',
    'import { unwrap, functionInvokeError } from "@/lib/supabaseResult";',
    'import { fetchDeep } from "@/lib/deep";',
    'import { loadViaBarrel } from "@/lib/barrel";',
    'import { loadViaStar } from "@/lib/star";',
    'import * as nsApi from "@/lib/nsApi";',
    'import loadDefault from "@/lib/defaultApi";',
    'import { readRows } from "@/lib/sharedRead";',
    'import { useInstant } from "./useInstant";',
    'import { queryClient, registry, report } from "@/lib/elsewhere";',
    "",
    "export function useCases(ids, prefetched) {",
    "  useQuery({ queryKey: ['c1'], queryFn: async () => {",
    '    const { data, error: c1Err } = await supabase.from("jobs").select("id");',
    "    if (c1Err) throw c1Err;",
    "    return data;",
    "  } });",
    "  useInfiniteQuery({ queryKey: ['c2'], initialPageParam: 0, getNextPageParam: () => null, queryFn: async () => {",
    '    const { data, error: c2Err } = await supabase.from("jobs").select("id");',
    "    if (c2Err) {",
    "      report(c2Err);",
    "      throw c2Err;",
    "    }",
    "    return data;",
    "  } });",
    "  useQueries({ queries: ids.map((id) => ({ queryKey: ['c3', id], queryFn: async () => {",
    '    const c3Res = await supabase.from("jobs").select("id").eq("id", id);',
    "    if (c3Res.error) throw c3Res.error;",
    "    return c3Res.data;",
    "  } })) });",
    "  void queryClient.fetchQuery({ queryKey: ['c4'], queryFn: () => fetchDeep() });",
    "  void queryClient.prefetchQuery({ queryKey: ['c5'], queryFn: async () => {",
    '    const c5Res = await supabase.from("jobs").select("id");',
    "    const c5Err = c5Res.error;",
    "    if (c5Err) throw c5Err;",
    "    return c5Res.data;",
    "  } });",
    "  void queryClient.ensureQueryData({ queryKey: ['c6'], queryFn: async () => {",
    '    const { data, error: c6Err } = await supabase.from("jobs").select("id");',
    "    if (c6Err) throw new Error(c6Err.message);",
    "    return data;",
    "  } });",
    "  useInstant({ key: ['c7'], fetcher: async () => {",
    '    const { error: c7Err } = await supabase.from("jobs").select("id");',
    "    if (c7Err) throw c7Err ?? new Error('unknown');",
    "  } });",
    "  useQuery({ queryKey: ['c8'], queryFn: async () => (await supabase.from(\"jobs\").select(\"id\").throwOnError()).data });",
    "  useQuery({ queryKey: ['c9'], queryFn: async () => {",
    '    const c9Res = await supabase.from("jobs").select("id");',
    "    return c9Res.error ? Promise.reject(c9Res.error) : c9Res.data;",
    "  } });",
    "  useQuery({ queryKey: ['c10'], queryFn: async () => {",
    '    const [aRes, bRes] = await Promise.all([supabase.from("jobs").select("id"), supabase.from("reviews").select("id")]);',
    "    const c10Errs = [aRes.error, bRes.error].filter(Boolean);",
    "    if (c10Errs.length === 2) throw new Error(c10Errs[0].message || 'both failed');",
    "    return aRes.data;",
    "  } });",
    "  useQuery({ queryKey: ['c11'], queryFn: async () => unwrap(await readRows()) });",
    "  useQuery({ queryKey: ['c12'], queryFn: () => nsApi.load() });",
    "  useQuery({ queryKey: ['c13'], queryFn: loadDefault });",
    "  useQuery({ queryKey: ['c14'], queryFn: loadViaBarrel });",
    "  useQuery({ queryKey: ['c15'], queryFn: () => loadViaStar() });",
    "  const c16Load = useCallback(async () => {",
    '    const { error: c16Err } = await supabase.from("jobs").select("id");',
    "    if (c16Err) throw c16Err;",
    "  }, []);",
    "  useQuery({ queryKey: ['c16'], queryFn: c16Load });",
    "  useQuery({ queryKey: ['c17'], queryFn: async () => {",
    '    const [xRes, yRes] = await Promise.all([supabase.from("jobs").select("id"), supabase.from("reviews").select("id")]);',
    "    for (const c17Err of [xRes.error, yRes.error]) if (c17Err) throw c17Err;",
    "    return xRes.data;",
    "  } });",
    "  useQuery({ queryKey: ['u1'], queryFn: registry.load });",
    // ── shapes that are fine ──
    '  useQuery({ queryKey: ["k1"], queryFn: async () => unwrap(await supabase.from("jobs").select("id")) });',
    "  useQuery({ queryKey: ['k2'], queryFn: async () => {",
    '    const { data, error } = await supabase.functions.invoke("stripe-connect", { body: {} });',
    "    if (error) throw await functionInvokeError(error);",
    "    return data;",
    "  } });",
    "  useQuery({ queryKey: ['k3'], queryFn: async () => {",
    '    try { return unwrap(await supabase.from("jobs").select("id")); }',
    "    catch (k3Caught) { report(k3Caught); throw k3Caught; }",
    "  } });",
    "  useQuery({ queryKey: ['k4'], queryFn: async () => { if (!ids.length) throw new Error('Not authenticated'); return ids; } });",
    "  useQuery({ queryKey: ['k5'], queryFn: async () => {",
    '    const { data } = prefetched ? { data: prefetched, error: null } : { data: unwrap(await supabase.from("jobs").select("id")) };',
    "    return data;",
    "  } });",
    "  useMutation({ mutationFn: async () => {",
    '    const { error: m1Err } = await supabase.from("jobs").insert({});',
    "    if (m1Err) throw m1Err;",
    "  } });",
    "}",
    "",
    "export async function neverAQuery() {",
    '  const { error: n1Err } = await supabase.from("jobs").select("id");',
    "  if (n1Err) throw n1Err;",
    "}",
  ].join("\n"),
};

function scanFixtures(): ReachReport {
  const sources = new Map(Object.entries(FIXTURES).map(([p, text]) => [`${FX_SRC}/${p}`, text]));
  return new QueryFnReach(sources, FX, FX_SRC, [`${FX_SRC}/lib/supabaseResult.ts`]).run();
}

describe("the queryFn reach scan (fixtures)", () => {
  const fx = scanFixtures();
  const found = new Map(fx.violations.map((v) => [v.code, v]));

  it("finds a query function behind every React Query entry point, and a wrapper's callers", () => {
    const via = new Map(fx.sites.map((s) => [s.line, s.via]));
    const at = (needle: string) => FIXTURES["hooks/useCases.ts"].split("\n").findIndex((l) => l.includes(needle)) + 1;
    expect(via.get(at("['c1']"))).toBe("useQuery");
    expect(via.get(at("['c2']"))).toBe("useInfiniteQuery");
    expect(via.get(at("['c3', id]"))).toBe("useQueries");
    expect(via.get(at("['c4']"))).toBe("fetchQuery");
    expect(via.get(at("['c5']"))).toBe("prefetchQuery");
    expect(via.get(at("['c6']"))).toBe("ensureQueryData");
    expect(fx.wrappers).toEqual(["useInstant.fetcher (src/hooks/useInstant.ts)"]);
    expect(via.get(at("['c7']"))).toBe("useInstant");
    // c1..c17, u1, k1..k5; the wrapper's own `queryFn: fetcher` is not a site, its caller (c7) is.
    expect(fx.sites).toHaveLength(23);
  });

  it("flags every spelling of a raw, re-wrapped, rejected or status-dropping throw, at any hop", () => {
    const flagged = [...found.values()].map((v) => `${v.kind}: ${v.code}`).sort();
    expect(flagged).toEqual(
      [
        "raw-throw: throw c1Err;",
        "raw-throw: throw c2Err;",
        "raw-throw: throw c3Res.error;",
        "raw-throw: throw deepRes.error;",
        "raw-throw: throw c5Err;",
        "rewrapped: throw new Error(c6Err.message);",
        "raw-throw: throw c7Err ?? new Error('unknown');",
        'throwOnError: supabase.from("jobs").select("id").throwOnError()',
        "raw-throw: Promise.reject(c9Res.error)",
        "rewrapped: throw new Error(c10Errs[0].message || 'both failed');",
        "status-dropped: { data, error }",
        "raw-throw: throw nsErr;",
        "raw-throw: throw defErr;",
        "raw-throw: throw barrelErr;",
        "raw-throw: throw starErr;",
        "raw-throw: throw c16Err;",
        "raw-throw: throw c17Err;",
      ].sort(),
    );
    // Through an imported helper two hops down, named on the way.
    expect(found.get("throw deepRes.error;")?.chain).toEqual(["fetchDeep (src/lib/deep.ts)", "innerRead (src/lib/deep.ts)"]);
  });

  it("passes unwrap(), functionInvokeError(), a caught rethrow, an app error and a null-error literal", () => {
    const codes = [...found.keys()].join("\n");
    for (const fine of ["k3Caught", "functionInvokeError", "Not authenticated", "prefetched", "throw error;"])
      expect(codes, `${fine} was flagged`).not.toContain(fine);
  });

  it("reads only what a query function reaches: a mutation and an unreached function are not flagged", () => {
    const codes = [...found.keys()].join("\n");
    expect(codes).not.toContain("m1Err");
    expect(codes).not.toContain("n1Err");
  });

  it("reports a queryFn value with nothing of ours behind it instead of passing it", () => {
    expect(fx.unfollowable).toHaveLength(1);
    expect(fx.unfollowable[0]).toMatch(/registry\.load/);
  });
});

// ── the finding's own number ───────────────────────────────────────────────
describe("a refused HEAD count is sent once (Q1182, measured)", () => {
  it("useDashboardJobsCount asks once when PostgREST refuses the count, and its error carries the 401", async () => {
    // The retry rule the app's queryClient actually uses (src/lib/queryClient.ts),
    // with no delay so a retry, if there is one, lands inside the wait below.
    const retry = queryClient.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe("function");
    const client = new QueryClient({ defaultOptions: { queries: { retry, retryDelay: 1, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    rig.requests.length = 0;
    rig.status = 401;

    const { result } = renderHook(
      () =>
        useDashboardJobsCount({
          userId: null,
          selectedCategory: null,
          searchQuery: "",
          minBudget: "",
          maxBudget: "",
          urgentOnly: false,
          boostedOnly: false,
          expiresWithin: "",
          earlyAccessTier: null,
          appliedJobIds: [],
          blockedUserIds: [],
          dismissedJobIds: [],
          savedOnlyJobIds: null,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    // Let a retry still in flight land before counting.
    await new Promise((r) => setTimeout(r, 50));

    const counts = rig.requests.filter((r) => r.startsWith("HEAD ") && r.includes("/open_jobs_browse"));
    // Measured 2026-10-03: 2 before this fix (the refusal, then React Query's
    // retry of it), 1 after.
    expect(counts, rig.requests.join("\n")).toHaveLength(1);
    expect((result.current.error as { status?: number } | null)?.status).toBe(401);
    client.clear();
  });
});
