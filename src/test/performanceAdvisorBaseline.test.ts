/**
 * GUARD (Q1321, Q1816): the Supabase PERFORMANCE advisor is held to an EXACT
 * baseline (scripts/ci/performance-advisor-baseline.json) by
 * scripts/check-performance-advisor.mjs, nightly in db-drift-detect.yml.
 *
 * Two kinds of exactness, because the classes move for two kinds of reason:
 *   - CODE-DRIVEN classes (multiple_permissive_policies, auth_db_connections_absolute)
 *     are exact COUNTS: one more fails, one fewer fails (lower the baseline).
 *   - unused_index is USAGE-driven: an index leaves it the first time real
 *     traffic scans it. As a count it went red twice in two days with no code
 *     change (119 -> 118, run 38611385251; 118 -> 117, run 38645447224), and a
 *     new unused index that arrived the same day one got used left the count
 *     unchanged and passed. It is now an exact SET of schema.table.index names:
 *     a NEW name fails; a name that LEAVES passes and prints the line to remove;
 *     a name a MIGRATION drops or renames away fails HERE, on every push, until
 *     the baseline loses it in the same change (the code-driven half of
 *     leaving, exact both ways).
 *
 * Measured 2026-10-14 22:11Z with get_advisors (performance): unused_index 117
 * names (the same 117 as pg_stat_user_indexes idx_scan = 0, non-unique, public,
 * read the same minute), multiple_permissive_policies 32,
 * auth_db_connections_absolute 1.
 */
// @mutate scripts/check-performance-advisor.mjs |       if (!known.has(k)) out.over.push( |       if (false) out.over.push(
// @mutate scripts/check-performance-advisor.mjs |       if (!seen[c].has(k)) out.departed.push( |       if (!seen[c].has(k)) out.under.push(
// @mutate scripts/check-performance-advisor.mjs |     else if (n < b) out.under.push( |     else if (false) out.under.push(
// @mutate scripts/check-performance-advisor.mjs |     else if (n > b) out.over.push( |     else if (false) out.over.push(
// @mutate scripts/check-performance-advisor.mjs |     if (b === undefined) out.over.push( |     if (false) out.over.push(
// @mutate scripts/check-performance-advisor.mjs |     if (!(name in counts) && b > 0) out.under.push( |     if (false) out.under.push(
// @mutate scripts/check-performance-advisor.mjs |     if (seen[c].size === 0 && known.size > 0) { |     if (false) {
// @mutate scripts/check-performance-advisor.mjs |   if (!m) throw new Error(`an unused_index finding names no index | if (false) throw new Error(`an unused_index finding names no index
// @mutate scripts/ci/performance-advisor-baseline.json |     "public.tips.idx_tips_tipper_id", |     "public.tips.idx_tips_tipper_id", "public.applications.idx_applications_job",
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

type Finding = { detail?: string; metadata?: Record<string, unknown> };
type Lint = { name: string; level?: string; findings?: Finding[]; count?: number; detail?: string };
type Baseline = { counts: Record<string, number>; unused_index: string[]; measured: string; note: string };
type Result = { over: string[]; under: string[]; departed: string[]; total: number };
type Mod = {
  SET_CLASSES: string[];
  loadBaseline: () => Baseline;
  lintsOf: (b: unknown) => Lint[];
  countsOf: (l: Lint[]) => Record<string, number>;
  unusedIndexKey: (f: Finding) => string;
  compare: (l: Lint[], b: Baseline) => Result;
};
const REPO = resolve(__dirname, "../..");
const load = async () => (await import(/* @vite-ignore */ resolve(REPO, "scripts/check-performance-advisor.mjs"))) as Mod;

/** The detail text exactly as prod's get_advisors returned it (a literal backslash before each backtick). */
const detailOf = (key: string) => {
  const [schema, table, index] = key.split(".");
  return `Index \\\`${index}\\\` on table \\\`${schema}.${table}\\\` has not been used`;
};

/** An MCP-shaped advisor run: these unused index names, and these counts for the code-driven classes. */
const runOf = (unused: string[], counts: Record<string, number>): Lint[] => [
  ...(unused.length ? [{ name: "unused_index", findings: unused.map((k) => ({ detail: detailOf(k), metadata: { name: k.split(".")[1] } })) }] : []),
  ...Object.entries(counts).map(([name, n]) => ({ name, findings: Array.from({ length: n }, (_, i) => ({ detail: `x${i}` })) })),
];

describe("performance advisor baseline (Q1321, Q1816): unused_index by exact name, code-driven classes by exact count", () => {
  it("the baseline is the real measurement, not an empty file (floor)", async () => {
    const b = (await load()).loadBaseline();
    expect(b.unused_index.length).toBeGreaterThan(50);
    expect(new Set(b.unused_index).size).toBe(b.unused_index.length);
    for (const k of b.unused_index) expect(k).toMatch(/^\w+\.\w+\.\w+$/);
    expect(b.counts.multiple_permissive_policies).toBeGreaterThan(10);
    expect(b.counts.auth_db_connections_absolute).toBe(1);
    expect(b.counts).not.toHaveProperty("unused_index");
    expect(b.measured).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("a run at the baseline passes", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const r = m.compare(runOf(b.unused_index, b.counts), b);
    expect(r).toMatchObject({ over: [], under: [], departed: [] });
    expect(r.total).toBe(b.unused_index.length + Object.values(b.counts).reduce((s, n) => s + n, 0));
  });

  it("(1) a NEW unused index name fails, even when a departure keeps the count unchanged", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const added = m.compare(runOf([...b.unused_index, "public.jobs.jobs_brand_new_idx"], b.counts), b);
    expect(added.over).toEqual([expect.stringMatching(/^unused_index: NEW public\.jobs\.jobs_brand_new_idx: /)]);
    // The count design passed this one: 117 out, 117 in.
    const swapped = m.compare(runOf([...b.unused_index.slice(1), "public.jobs.jobs_brand_new_idx"], b.counts), b);
    expect(swapped.over).toEqual([expect.stringMatching(/^unused_index: NEW public\.jobs\.jobs_brand_new_idx: /)]);
    expect(swapped.under).toEqual([]);
  });

  it("(2) an index LEAVING the set (traffic scanned it) passes and names the line to remove", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const gone = b.unused_index[3];
    const r = m.compare(runOf(b.unused_index.filter((k) => k !== gone), b.counts), b);
    expect(r.over).toEqual([]);
    expect(r.under).toEqual([]);
    expect(r.departed).toEqual([`unused_index: ${gone} left the set (real traffic scanned it): remove the line "${gone}" from "unused_index"`]);
  });

  it("the whole unused_index class vanishing fails (an advisor change, not traffic)", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const r = m.compare(runOf([], b.counts), b);
    expect(r.under).toEqual([expect.stringMatching(/^unused_index: 0 finding\(s\), the baseline names \d+: the class vanished entirely/)]);
  });

  it("(3) the code-driven classes stay EXACT counts, both ways", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const mpp = b.counts.multiple_permissive_policies;
    const more = m.compare(runOf(b.unused_index, { ...b.counts, multiple_permissive_policies: mpp + 1 }), b);
    expect(more.over).toEqual([`multiple_permissive_policies: ${mpp + 1} finding(s), baseline ${mpp} (+1)`]);
    const fewer = m.compare(runOf(b.unused_index, { ...b.counts, multiple_permissive_policies: mpp - 1 }), b);
    expect(fewer.under).toEqual([`multiple_permissive_policies: ${mpp - 1} finding(s), baseline ${mpp} (-1): lower the baseline`]);
    const authMore = m.compare(runOf(b.unused_index, { ...b.counts, auth_db_connections_absolute: 2 }), b);
    expect(authMore.over).toEqual(["auth_db_connections_absolute: 2 finding(s), baseline 1 (+1)"]);
    const { auth_db_connections_absolute: _gone, ...rest } = b.counts;
    void _gone;
    const missing = m.compare(runOf(b.unused_index, rest), b);
    expect(missing.under).toEqual([expect.stringMatching(/^auth_db_connections_absolute: 0 finding/)]);
    const extra = m.compare(runOf(b.unused_index, { ...b.counts, unindexed_foreign_keys: 2 }), b);
    expect(extra.over).toEqual(["unindexed_foreign_keys: 2 finding(s), a class the baseline does not name"]);
  });

  it("reads both result shapes and both detail spellings; an unused_index finding with no index name throws (fails closed)", async () => {
    const m = await load();
    expect(m.lintsOf({ result: { lints: [] } })).toEqual([]);
    expect(m.lintsOf({ lints: [{ name: "a" }] })).toHaveLength(1);
    expect(() => m.lintsOf({})).toThrow();
    expect(m.countsOf([{ name: "auth_db_connections_absolute", count: 1 }, { name: "unused_index", findings: [{}, {}] }])).toEqual({
      auth_db_connections_absolute: 1,
      unused_index: 2,
    });
    expect(m.unusedIndexKey({ detail: detailOf("public.tips.idx_tips_job_id") })).toBe("public.tips.idx_tips_job_id");
    expect(m.unusedIndexKey({ detail: "Index `idx_tips_job_id` on table `public.tips` has not been used" })).toBe("public.tips.idx_tips_job_id");
    expect(() => m.unusedIndexKey({ detail: "something else" })).toThrow(/names no index/);
    // The Management API's flat shape: one row per finding, detail on the row.
    const b = m.loadBaseline();
    const flat = [...b.unused_index.map((k) => ({ name: "unused_index", detail: detailOf(k) })), ...runOf([], b.counts)];
    expect(m.compare(flat, b)).toMatchObject({ over: [], under: [], departed: [] });
    expect(() => m.compare([{ name: "unused_index", detail: "no name here" }], b)).toThrow(/names no index/);
  });
});

// ── the code-driven half of leaving: a migration drops or renames the index ──

/** Index and table names a migration leaves alive or dead, newest statement wins (literal SQL only). */
function migrationFate(sqlByFile: [string, string][]) {
  const index = new Map<string, "alive" | "dead">();
  const table = new Map<string, "alive" | "dead">();
  const id = String.raw`(?:"?\w+"?\.)?"?(\w+)"?`;
  // A comma list of plain identifiers only: a `[^;]+` ran into the prose of a
  // format() string and marked live tables (profiles, job_checkins) dropped.
  const one = String.raw`(?:"?\w+"?\.)?"?\w+"?`;
  const idList = String.raw`${one}(?:\s*,\s*${one})*`;
  const res: [RegExp, (m: RegExpExecArray) => void][] = [
    [new RegExp(String.raw`create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+on\b`, "gi"), (m) => index.set(m[1], "alive")],
    [new RegExp(String.raw`drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(${idList})`, "gi"), (m) => {
      for (const part of m[1].split(",")) {
        const n = /(?:"?\w+"?\.)?"?(\w+)"?/.exec(part.trim());
        if (n) index.set(n[1], "dead");
      }
    }],
    [new RegExp(String.raw`alter\s+index\s+(?:if\s+exists\s+)?${id}\s+rename\s+to\s+"?(\w+)"?`, "gi"), (m) => { index.set(m[1], "dead"); index.set(m[2], "alive"); }],
    [new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${id}`, "gi"), (m) => table.set(m[1], "alive")],
    // Not `ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles`: that leaves the table.
    [new RegExp(String.raw`(?<!publication\s+"?\w+"?\s+)drop\s+table\s+(?:if\s+exists\s+)?(${idList})`, "gi"), (m) => {
      for (const part of m[1].split(",")) {
        const n = /(?:"?\w+"?\.)?"?(\w+)"?/.exec(part.trim());
        if (n) table.set(n[1], "dead");
      }
    }],
    [new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${id}\s+rename\s+to\s+"?(\w+)"?`, "gi"), (m) => { table.set(m[1], "dead"); table.set(m[2], "alive"); }],
  ];
  for (const [, raw] of sqlByFile) {
    const sql = blankSqlComments(raw);
    const events: [number, () => void][] = [];
    for (const [re, apply] of res) for (const m of sql.matchAll(re)) events.push([m.index ?? 0, () => apply(m as RegExpExecArray)]);
    events.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
  }
  return { index, table };
}

/** Baseline names a migration has dropped or renamed away (index, or its table). */
function droppedByMigration(names: string[], sqlByFile: [string, string][]): string[] {
  const { index, table } = migrationFate(sqlByFile);
  return names.filter((k) => {
    const [, t, i] = k.split(".");
    return index.get(i) === "dead" || table.get(t) === "dead";
  });
}

describe("unused_index baseline loses a name in the same change a migration drops it (exact, both ways)", () => {
  const dir = join(REPO, "supabase/migrations");
  const migrations = (): [string, string][] =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => [f, readFileSync(join(dir, f), "utf8")]);

  it("the parser reads drops, recreates, renames and dropped tables, newest first wins", () => {
    const names = ["public.t.a_idx", "public.t.b_idx", "public.t.c_idx", "public.gone.d_idx", "public.t.e_idx"];
    const sql: [string, string][] = [
      ["1.sql", "CREATE INDEX a_idx ON public.t(x); CREATE INDEX b_idx ON public.t(y); CREATE INDEX c_idx ON t(z); CREATE TABLE public.gone(id int); CREATE INDEX d_idx ON public.gone(id);"],
      ["2.sql", "DROP INDEX IF EXISTS public.a_idx, public.b_idx CASCADE; -- DROP INDEX e_idx;\nALTER INDEX public.c_idx RENAME TO c2_idx;"],
      ["3.sql", "CREATE INDEX IF NOT EXISTS b_idx ON public.t(y); DROP TABLE IF EXISTS public.gone; ALTER PUBLICATION supabase_realtime DROP TABLE public.t;"],
    ];
    expect(droppedByMigration(names, sql)).toEqual(["public.t.a_idx", "public.t.c_idx", "public.gone.d_idx"]);
  });

  it("no name in the baseline is one a migration dropped or renamed away", async () => {
    const all = migrations();
    expect(all.length).toBeGreaterThan(500);
    const b = (await load()).loadBaseline();
    const { index } = migrationFate(all);
    // Inventory floor: the parser sees the repo's real index history.
    expect([...index.values()].filter((v) => v === "dead").length).toBeGreaterThan(10);
    expect(droppedByMigration(b.unused_index, all)).toEqual([]);
  });
});
