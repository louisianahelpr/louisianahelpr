/**
 * Q2350: typed text in a PostgREST `.or()` ilike filter is double-quoted by
 * ilikeContains (src/lib/postgrestIlike.ts), never interpolated bare.
 *
 * Measured on prod 2026-11-02 (read-only counts of open_jobs_browse, signed
 * out): the old backslash-escaped value answered HTTP 400 for a search holding
 * "," or ")" (Browse's count is a HEAD request, so Sentry saw "No error
 * message", JAVASCRIPT-41); every ilikeContains value tried answered 200,
 * including `lawn, yard`, `a)b`, `say "hi"`, a trailing backslash and `50%`.
 */
// @mutate src/lib/postgrestIlike.ts | return `"%${quoted}%"`; | return `%${quoted}%`;
// @mutate src/lib/postgrestIlike.ts | const quoted = like.replace(/[\\"]/g, (ch) => `\\${ch}`); | const quoted = like;
// @mutate src/hooks/useDashboardJobsCount.ts | query.or(`title.ilike.${q},description.ilike.${q}${ | query.or(`title.ilike.%${q}%,description.ilike.%${q}%${
// @mutate src/components/admin/AdminSettings.tsx | .or(`full_name.ilike.${ilikeContains(q)},email.ilike.${ilikeContains(q)}`) | .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
import { relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { readSource, walkSource } from "@/test/helpers/walkSource";
import { ilikeContains } from "./postgrestIlike";
import { categoriesMatchingSearch } from "@/lib/jobCategories";

// A recording stand-in for the query builder: every chained call returns the
// builder, and awaiting it answers an empty count. Only the .or() strings matter.
const orCalls = vi.hoisted(() => [] as string[]);
vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok({ data: null, error: null, count: 0, status: 200 });
      if (prop === "or") return (s: string) => { orCalls.push(s); return chain; };
      return () => chain;
    },
  });
  return { supabase: { from: () => chain } };
});
import { fetchDashboardJobsCount } from "@/hooks/useDashboardJobsCount";

describe("Q2350: ilikeContains", () => {
  it("double-quotes the value so , ( ) cannot split the .or() list", () => {
    expect(ilikeContains("yard")).toBe('"%yard%"');
    expect(ilikeContains("lawn, yard")).toBe('"%lawn, yard%"');
    expect(ilikeContains("a)b")).toBe('"%a)b%"');
    expect(ilikeContains("(a)")).toBe('"%(a)%"');
  });

  it("escapes a quote and a backslash for PostgREST, and keeps a typed % literal for LIKE", () => {
    expect(ilikeContains('say "hi"')).toBe('"%say \\"hi\\"%"');
    // LIKE: back\ -> back\\ ; PostgREST quoting doubles each -> back\\\\
    expect(ilikeContains("back\\")).toBe('"%back\\\\\\\\%"');
    // LIKE: 50% -> 50\% ; PostgREST quoting -> 50\\%
    expect(ilikeContains("50%")).toBe('"%50\\\\%%"');
  });
});

describe("Q2350: the exact search filter Browse's count sends", () => {
  const searchFilterFor = async (searchQuery: string): Promise<string> => {
    orCalls.length = 0;
    await fetchDashboardJobsCount({
      selectedCategory: null, searchQuery, minBudget: "", maxBudget: "", urgentOnly: false, boostedOnly: false,
      expiresWithin: "", earlyAccessTier: null, appliedJobIds: [], blockedUserIds: [], dismissedJobIds: [], savedOnlyJobIds: null,
    });
    const search = orCalls.filter((s) => s.includes("ilike"));
    expect(search).toHaveLength(1);
    return search[0];
  };

  it.each([
    // [typed, the .or() string PostgREST receives]
    ["zzqq", 'title.ilike."%zzqq%",description.ilike."%zzqq%"'],
    ["zz, qq", 'title.ilike."%zz, qq%",description.ilike."%zz, qq%"'],
    ["zz)qq(", 'title.ilike."%zz)qq(%",description.ilike."%zz)qq(%"'],
    // An embedded double quote: escaped once, for PostgREST.
    ['say "zz"', String.raw`title.ilike."%say \"zz\"%",description.ilike."%say \"zz\"%"`],
    // One typed backslash: doubled for LIKE (literal), then each doubled again for PostgREST.
    ["zz\\", String.raw`title.ilike."%zz\\\\%",description.ilike."%zz\\\\%"`],
    // A typed %: escaped for LIKE (literal, never a wildcard), that backslash doubled for PostgREST.
    ["50%zz", String.raw`title.ilike."%50\\%zz%",description.ilike."%50\\%zz%"`],
  ])("search %j sends %s", async (typed, expected) => {
    expect(categoriesMatchingSearch(typed)).toEqual([]);
    expect(await searchFilterFor(typed)).toBe(expected);
  });
});

describe("Q2350: no .or() ilike filter interpolates typed text bare", () => {
  // Every `.or(` whose argument is a template literal, in app and edge code.
  const files = walkSource(["src", "supabase/functions"]).filter((f) => !/\.test\.tsx?$/.test(f));
  const sites: { file: string; template: string }[] = [];
  for (const file of files) {
    const raw = readSource(file);
    if (raw === null || !raw.includes(".or(`")) continue;
    const src = blankComments(raw);
    for (const m of src.matchAll(/\.or\(`([^`]*)`/g)) {
      if (m[1].includes("ilike.")) sites.push({ file: relative(process.cwd(), file), template: m[1] });
    }
  }

  it("finds the ilike .or() sites (inventory floor)", () => {
    expect(sites.length).toBeGreaterThan(1);
  });

  it("every ilike value in an .or() is an interpolated ilikeContains value, never a literal %", () => {
    const bare = sites.filter((s) => /ilike\.(?!\$\{)/.test(s.template)).map((s) => `${s.file}: ${s.template}`);
    expect(bare).toEqual([]);
  });

  it("Browse's count builds its search value with ilikeContains", () => {
    const src = blankComments(readSource("src/hooks/useDashboardJobsCount.ts") ?? "");
    expect(src).toMatch(/const q = ilikeContains\(searchQuery\.trim\(\)\)/);
  });
});
