/**
 * Q1194 — a query function never ignores a Supabase result's `error`.
 *
 * WHAT WAS BROKEN (inventoried by this rule on 2026-10-04, before any fix):
 * 12 statements reachable from a React Query queryFn awaited a Supabase read
 * and never looked at its `error`, so a refused read became a confident zero
 * or "ok": the admin health fetcher (useHealthData: 13 results across 5
 * statements, e.g. "0 sent", "0 push tokens"), the admin config checks
 * (useConfigChecks: 5, e.g. "Every paid job records its platform fee" about
 * rows it never read), the silent-cron check (useCronHealth: 1) and a public
 * profile's review names (useUserProfileData: 1 Promise.all of 2).
 *
 * The rule lives in src/test/helpers/queryFnReach.ts (kind "error-unread")
 * and the zero for the real tree is asserted by
 * src/test/queryReadsThrowThroughUnwrap.test.ts with every other kind; this
 * file proves the rule's spellings on fixtures and pins the real count.
 * Only `supabase.auth.getSession()` is out of scope (local state: a failure
 * IS "no user"); getUser() is a network call and must have its error read
 * (lh-silent-failure review, which also added the builder-in-a-variable and
 * reassignment spellings and the `.then(unwrap)` / getPublicUrl exclusions).
 *
 * LIMIT: the rule proves the error is READ, not that a failed read stops
 * rendering a value. The review found the admin health SCREEN still drew the
 * fallback zeros after the hook threw; that half is held by
 * src/components/admin/AdminHealth.unreadable.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { QueryFnReach } from "./helpers/queryFnReach";
import { walkSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");

describe("Q1194: no query function leaves a Supabase result's error unread (real tree)", () => {
  const files = walkSource([SRC]).filter(
    (f) => !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"),
  );
  const report = new QueryFnReach(new Map(files.map((f) => [f, readFileSync(f, "utf8")])), REPO, SRC, [
    join(SRC, "lib", "supabaseResult.ts"),
  ]).run();

  it("reads the real query functions", () => {
    expect(report.sites.length).toBeGreaterThan(100);
    expect(report.functionsFollowed).toBeGreaterThan(500);
  });

  it("finds none (12 statements on 2026-10-04 before the fix)", () => {
    const unread = [...new Set(report.violations.filter((v) => v.kind === "error-unread").map((v) => `${v.at} ${v.code}`))];
    expect(unread, unread.join("\n")).toEqual([]);
  });
});

const FX = "/fx";
const FX_SRC = `${FX}/src`;
const FIXTURES: Record<string, string> = {
  "lib/supabaseResult.ts": "export function unwrap(r) { if (r.error) throw r.error; return r.data; }",
  "hooks/useUnread.ts": [
    'import { useQuery } from "@tanstack/react-query";',
    'import { supabase } from "@/integrations/supabase/client";',
    'import { unwrap } from "@/lib/supabaseResult";',
    "export function useUnread(report) {",
    // ── dropped: each must be flagged ──
    "  useQuery({ queryKey: ['d1'], queryFn: async () => {",
    '    const { count: d1Count } = await supabase.from("jobs").select("id", { count: "exact", head: true });',
    "    return d1Count ?? 0;",
    "  } });",
    "  useQuery({ queryKey: ['d2'], queryFn: async () => {",
    '    const d2Res = await supabase.from("jobs").select("id", { count: "exact", head: true });',
    "    return d2Res.count || 0;",
    "  } });",
    "  useQuery({ queryKey: ['d3'], queryFn: async () => (await supabase.rpc(\"d3_rpc\")).data });",
    "  useQuery({ queryKey: ['d4'], queryFn: async () => {",
    '    const [d4a, d4b] = await Promise.all([supabase.from("jobs").select("id"), supabase.from("reviews").select("id")]);',
    "    if (d4a.error) throw d4a.error;",
    "    return [d4a.data, d4b.data];",
    "  } });",
    "  useQuery({ queryKey: ['d5'], queryFn: async () => {",
    "    const { data: { user: d5User } } = await supabase.auth.getUser();",
    "    return d5User?.id ?? null;",
    "  } });",
    "  useQuery({ queryKey: ['d6'], queryFn: async () => {",
    '    let d6Query = supabase.from("jobs").select("id");',
    "    if (report) d6Query = d6Query.eq('a', 1);",
    "    const { data: d6Rows } = await d6Query;",
    "    return d6Rows;",
    "  } });",
    "  useQuery({ queryKey: ['d7'], queryFn: async () => {",
    "    let d7Res;",
    '    d7Res = await supabase.from("jobs").select("id", { count: "exact", head: true });',
    "    return d7Res.count;",
    "  } });",
    // ── read: none may be flagged ──
    "  useQuery({ queryKey: ['r1'], queryFn: async () => unwrap(await supabase.from(\"jobs\").select(\"id\")) });",
    "  useQuery({ queryKey: ['r2'], queryFn: async () => {",
    '    const r2Res = await supabase.from("jobs").select("id", { count: "exact", head: true });',
    "    unwrap(r2Res);",
    "    return r2Res.count ?? 0;",
    "  } });",
    "  useQuery({ queryKey: ['r3'], queryFn: async () => {",
    '    const { data, error: r3Err } = await supabase.from("jobs").select("id");',
    "    if (r3Err) report(r3Err);",
    "    return data ?? [];",
    "  } });",
    "  useQuery({ queryKey: ['r4'], queryFn: async () => {",
    '    const [r4a, r4b] = await Promise.all([supabase.from("jobs").select("id"), supabase.from("reviews").select("id")]);',
    "    for (const r of [r4a, r4b]) unwrap(r);",
    "    return r4a.data;",
    "  } });",
    "  useQuery({ queryKey: ['r5'], queryFn: async () => {",
    "    const { data: { session } } = await supabase.auth.getSession();",
    "    return session?.user?.id ?? null;",
    "  } });",
    "  useQuery({ queryKey: ['r6'], queryFn: async () => (await supabase.from(\"jobs\").select(\"id\")).error ? [] : [1] });",
    "  useQuery({ queryKey: ['r7'], queryFn: async () => {",
    '    const r7Rows = await supabase.from("jobs").select("id").then(unwrap);',
    "    return r7Rows.map((r) => r.id);",
    "  } });",
    "}",
  ].join("\n"),
};

describe("Q1194: the error-unread rule (fixtures)", () => {
  const sources = new Map(Object.entries(FIXTURES).map(([p, text]) => [`${FX_SRC}/${p}`, text]));
  const fx = new QueryFnReach(sources, FX, FX_SRC, [`${FX_SRC}/lib/supabaseResult.ts`]).run();

  it("flags each spelling that drops the error", () => {
    // d1..d7, r1..r7
    expect(fx.sites).toHaveLength(14);
    const lines = fx.violations.filter((v) => v.kind === "error-unread").map((v) => Number(v.at.split(":").pop()));
    const at = (needle: string) => FIXTURES["hooks/useUnread.ts"].split("\n").findIndex((l) => l.includes(needle)) + 1;
    expect(lines.sort((a, b) => a - b)).toEqual(
      [
        at("{ count: d1Count }"),
        at("const d2Res"),
        at("d3_rpc"),
        at("const [d4a, d4b]"),
        at("user: d5User"),
        at("data: d6Rows"),
        at("d7Res = await"),
      ].sort((a, b) => a - b),
    );
  });

  it("passes unwrap(), a reported error, an all-unwrapped Promise.all, getSession, a read .error and .then(unwrap)", () => {
    expect(fx.violations.filter((v) => v.kind === "error-unread")).toHaveLength(7);
  });
});

// @mutate src/test/helpers/queryFnReach.ts |     if (ts.isAwaitExpression(n) && this.awaitDropsError(n)) return "error-unread"; |     if (false) return "error-unread";
// @mutate src/test/helpers/queryFnReach.ts |       return !name.elements.some((el) => el.dotDotDotToken \|\| propName(el.propertyName ?? el.name) === "error"); |       return false;
// @mutate src/components/admin/adminHealth/useHealthData.ts |       for (const r of [sentRes, failedRes, suppressedRes]) unwrap(r); |
// @mutate src/components/admin/adminHealth/useConfigChecks.ts |       const feeGap = countOrNull(feeGapRes, "fee"); |       const feeGap = feeGapRes.count;
