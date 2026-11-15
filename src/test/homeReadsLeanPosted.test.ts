/**
 * Q2812 (Builder 2, 2026-11-15; owner rule "pages under 2 s"): Home's to-dos, Next up, Coming up and counts, and the
 * nav badge on every signed-in page, read the LEAN posted core (get_my_activity_cores p_parts {posted_lean}), not every
 * job the member ever posted (the cwv-lab poster: 831 jobs, 176,572 bytes gzip).
 *
 * Two halves:
 *  (a) the two Home readers ask for the lean key and the lean fetch;
 *  (b) the lean set never drops a job Home can act on: for every job status (the job_status enum) x every payment status
 *      (PAYMENT_STATUSES) x an open back-out notice or not x marked done or not, a posted job whose postedActivityBucket
 *      is anything but Done or Cancelled (Needs you, Waiting, Booked: the buckets Home's derivations read) is in the
 *      lean set. The lean set is read from the NEWEST effective definition of get_my_activity_cores (the
 *      `v_lean_ids := ARRAY(...)` WHERE clause) by a tiny evaluator that throws on any clause it does not know, so a
 *      narrower predicate fails here and a new kind of clause must be taught to it.
 */
// @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | queryKey: uid ? queryKeys.activity.postedLean(uid) : | queryKey: uid ? queryKeys.activity.posted(uid) :
// @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | queryFn: () => fetchPostedActivity(uid, { lean: true }), | queryFn: () => fetchPostedActivity(uid),
// @mutate src/pages/home/homeDashboard/useHomeSummary.ts | useActivityData(user, "posted", { lean: true }); | useActivityData(user, "posted");
// @mutate src/hooks/useActivityData.ts | const cores = (opts.lean ? await fetchLeanPostedCores(userId) : null) ?? | const cores = (null) ??
// @mutate supabase/migrations/20261115173740_activity_cores_posted_lean.sql |               OR j.payment_status = 'chargeback'\n | \n
// @mutate supabase/migrations/20261115173740_activity_cores_posted_lean.sql |               OR (j.payment_status = 'failed' AND j.status <> 'cancelled')\n | \n
// @mutate supabase/migrations/20261115173740_activity_cores_posted_lean.sql | j.status NOT IN ('completed', 'cancelled') | j.status NOT IN ('completed', 'cancelled', 'disputed')
// @mutate supabase/migrations/20261115173740_activity_cores_posted_lean.sql | \n              OR j.id IN (SELECT b.job_id FROM public.backout_notices b WHERE b.user_id = v_uid AND b.acknowledged_at IS NULL))); | )));
// @mutate src/components/job-card/activityActions/useOptimisticJobCache.ts | [[postedKey, posted], [postedLeanKey, postedLean]] as const | [[postedKey, posted]] as const
// @mutate src/components/job-card/activityActions/useOptimisticJobCache.ts |       if (snapshot.postedLean) { |       if (snapshot.postedLean && false) {
// @mutate src/hooks/useActivityData.ts | queryFn: () => fetchPostedActivity(userId), | queryFn: () => fetchPostedActivity(userId, { lean: true }),
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOptimisticJobCache } from "@/components/job-card/activityActions/useOptimisticJobCache";
import { queryKeys } from "@/lib/queryKeys";
import type { PostedActivity } from "@/hooks/useActivityData";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { Constants } from "@/integrations/supabase/types";
import { PAYMENT_STATUSES } from "@/lib/statusLabels";
import { postedActivityBucket } from "@/components/job-card/activityFilters";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8")).replace(/\s+/g, " ");

describe("Home reads the lean posted core (Q2812)", () => {
  it("useNeedsYouTodos (the nav badge, every page) and useHomeSummary ask for the lean key and fetch", () => {
    const todos = code("src/pages/home/homeDashboard/useNeedsYouTodos.ts");
    expect(todos).toMatch(/queryKey: uid \? queryKeys\.activity\.postedLean\(uid\)/);
    expect(todos).toContain("fetchPostedActivity(uid, { lean: true })");
    expect(todos).not.toMatch(/queryKeys\.activity\.posted\(uid\) :/);
    const summary = code("src/pages/home/homeDashboard/useHomeSummary.ts");
    expect(summary).toContain('useActivityData(user, "posted", { lean: true })');
    const hook = code("src/hooks/useActivityData.ts");
    expect(hook).toMatch(/opts\.lean \? await fetchLeanPostedCores\(userId\) : null\) \?\? await fetchActivityCores\(userId, "posted"\)/);
    expect(hook).toMatch(/lean \? queryKeys\.activity\.postedLean\(userId\) : queryKeys\.activity\.posted\(userId\)/);
  });

  it("Home still warms the WHOLE posted core once it settles, so Posted (and its loading bones) never wait on the lean one", () => {
    // JobsSectionSkeleton counts every ["activity","posted"] entry (useCachedListCount, the max); the lean entry alone
    // is empty for a member whose posts are all finished. The whole core arrives from usePrefetchUserData after Home
    // settles (not on Save-Data / 2G, where nothing is warmed), as it did before Q2812.
    const hook = code("src/hooks/useActivityData.ts");
    const warm = /export function prefetchActivityCores\(queryClient: QueryClient, userId: string\) \{(.*?)\n?\}/.exec(hook)?.[1] ?? "";
    expect(warm).toContain("queryKey: queryKeys.activity.posted(userId), queryFn: () => fetchPostedActivity(userId), ");
    expect(code("src/hooks/usePrefetchUserData.ts")).toContain("prefetchActivityCores(queryClient, userId);");
    expect(code("src/pages/home/Dashboard.tsx")).toContain("usePrefetchUserData(user?.id);");
  });
});

describe("an optimistic job patch reaches Home's lean posted core (Q2812)", () => {
  it("patches the lean entry beside the whole one, and a rollback restores it", () => {
    const qc = new QueryClient();
    const uid = "u-1";
    const core = (tag: string) => ({ postedJobs: [{ id: "j1", poster_confirmed_arrival_at: null, tag }] }) as unknown as PostedActivity;
    qc.setQueryData(queryKeys.activity.posted(uid), core("whole"));
    qc.setQueryData(queryKeys.activity.postedLean(uid), core("lean"));
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useOptimisticJobCache({ id: uid } as never), { wrapper });
    const at = "2026-11-15T12:00:00Z";
    const snap = result.current.optimisticallyPatchJob("j1", { poster_confirmed_arrival_at: at });
    const read = (k: readonly unknown[]) => (qc.getQueryData<PostedActivity>(k)!.postedJobs[0] as { poster_confirmed_arrival_at: string | null }).poster_confirmed_arrival_at;
    expect(read(queryKeys.activity.posted(uid))).toBe(at);
    expect(read(queryKeys.activity.postedLean(uid))).toBe(at);
    result.current.rollbackActivity(snap);
    expect(read(queryKeys.activity.posted(uid))).toBeNull();
    expect(read(queryKeys.activity.postedLean(uid))).toBeNull();
    // Home alone (no whole entry): still patched.
    qc.removeQueries({ queryKey: queryKeys.activity.posted(uid), exact: true });
    result.current.optimisticallyPatchJob("j1", { poster_confirmed_arrival_at: at });
    expect(read(queryKeys.activity.postedLean(uid))).toBe(at);
  });
});

type Row = { status: string | null; payment_status: string; backout: boolean };

/** The newest effective get_my_activity_cores lean WHERE clause (after `j.customer_id = v_uid AND`). */
function leanPredicate(): string {
  const def = effectiveDefs(resolve(ROOT, "supabase/migrations")).get("get_my_activity_cores");
  expect(def, "get_my_activity_cores has a definition").toBeTruthy();
  const body = blankSqlComments(def!.stmt).replace(/\s+/g, " ");
  const m = /v_lean_ids := ARRAY\( SELECT j\.id FROM public\.jobs j WHERE j\.customer_id = v_uid AND \((.*?)\)\);/i.exec(body);
  expect(m, `${def!.file}: the lean id list`).toBeTruthy();
  return m![1];
}

/** Split on a top-level separator (`OR` / `AND`), parentheses respected. */
function splitTop(s: string, sep: "OR" | "AND"): string[] {
  const out: string[] = [];
  const token = ` ${sep} `;
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (depth === 0 && s.slice(i, i + token.length).toUpperCase() === token) {
      out.push(s.slice(start, i));
      start = i + token.length;
      i = start - 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

const strip = (s: string): string => {
  const t = s.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return t;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")") depth--;
    if (depth === 0 && i < t.length - 1) return t;
  }
  return strip(t.slice(1, -1));
};

const list = (s: string) => s.split(",").map((x) => x.trim().replace(/^'|'$/g, ""));

/** Evaluates the restricted grammar the lean clause uses; throws on anything else. */
function evalClause(clause: string, r: Row): boolean {
  const c = strip(clause);
  const ors = splitTop(c, "OR");
  if (ors.length > 1) return ors.some((x) => evalClause(x, r));
  const ands = splitTop(c, "AND");
  if (ands.length > 1) return ands.every((x) => evalClause(x, r));
  let m: RegExpExecArray | null;
  if (/^j\.status IS NULL$/i.test(c)) return r.status === null;
  if ((m = /^j\.status NOT IN \(([^)]*)\)$/i.exec(c))) return r.status !== null && !list(m[1]).includes(r.status);
  if ((m = /^j\.status <> '(\w+)'$/i.exec(c))) return r.status !== null && r.status !== m[1];
  if ((m = /^j\.status = '(\w+)'$/i.exec(c))) return r.status === m[1];
  if ((m = /^j\.payment_status = '(\w+)'$/i.exec(c))) return r.payment_status === m[1];
  if ((m = /^j\.payment_status IN \(([^)]*)\)$/i.exec(c))) return list(m[1]).includes(r.payment_status);
  if (/^j\.id IN \(SELECT b\.job_id FROM public\.backout_notices b WHERE b\.user_id = v_uid AND b\.acknowledged_at IS NULL\)$/i.test(c)) return r.backout;
  throw new Error(`unknown lean clause: ${c}`);
}

describe("the lean posted set keeps every job Home can act on (Q2812)", () => {
  it("reads the newest definition's predicate", () => {
    const p = leanPredicate();
    expect(p).toMatch(/backout_notices/);
    // The evaluator answers for a plain open job and refuses a clause it does not know.
    expect(evalClause(p, { status: "open", payment_status: "escrow", backout: false })).toBe(true);
    expect(() => evalClause("j.title = 'x'", { status: "open", payment_status: "escrow", backout: false })).toThrow(/unknown/);
  });

  it("every status x payment status x back-out x marked-done whose bucket is not Done or Cancelled is in the set", () => {
    const p = leanPredicate();
    const statuses: readonly (string | null)[] = [...Constants.public.Enums.job_status, null];
    let checked = 0;
    const missing: string[] = [];
    for (const status of statuses) {
      for (const payment_status of PAYMENT_STATUSES) {
        for (const backout of [false, true]) {
          for (const markedDone of [false, true]) {
            const job = {
              status: status as string,
              payment_status,
              poster_marked_done_at: markedDone ? "2026-11-01T00:00:00Z" : null,
              ...(backout ? { backout_notice: { id: "n" } } : {}),
            };
            const bucket = postedActivityBucket(job as Parameters<typeof postedActivityBucket>[0], 0);
            checked++;
            if (bucket === "done" || bucket === "cancelled") continue;
            if (!evalClause(p, { status, payment_status, backout })) missing.push(`${status}/${payment_status}/backout=${backout}/done=${markedDone} -> ${bucket}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(missing).toEqual([]);
  });
});
