/**
 * Q2112: every reader that COUNTS analytics_events for a person-facing number
 * (the owner's funnel, monitors, SLOs) reads the people's rows only: the view
 * public.analytics_events_real, or the same filter inlined as ROBOT_EVENT_SQL
 * (scripts/lib/analyticsFreshness.mjs). Robots (nightly journeys, press runs,
 * local harnesses) run the real app on prod; a raw count counts them as
 * people. MEASURED 2026-10-21 (prod, 7 days): job_posted 77 raw events, 76 of
 * them robots, against 1 real post; the freshness monitor counted all 77.
 *
 * Inventory from source: every `FROM [public.]analytics_events` and every
 * `.from("analytics_events")` in src/, supabase/functions/, scripts/ and
 * e2e/ (tests and PGlite proofs excluded: they build their own tables). Each
 * read must carry the robot filter within its statement, or sit in
 * NOT_A_PEOPLE_COUNT with why. Exact both ways.
 *
 * @mutate scripts/lib/analyticsFreshness.mjs | AND e.created_at > ${since} AND NOT ${ROBOT_EVENT_SQL})::int AS events | AND e.created_at > ${since})::int AS events
 * @mutate scripts/slo.mjs |       AND NOT ${ROBOT_EVENT_SQL}`; |       `;
 * @mutate scripts/lib/analyticsFreshness.mjs | export const ROBOT_EVENT_SQL = `(coalesce(e.properties, '{}'::jsonb) -> 'automated' IS NOT DISTINCT FROM 'true'::jsonb | export const ROBOT_EVENT_SQL = `(false
 */
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROBOT_EVENT_SQL } from "../../scripts/lib/analyticsFreshness.mjs";

const ROOTS = ["src", "supabase/functions", "scripts", "e2e"];
const SKIP = /(\.test\.|\/pglite\/|\/test\/fixtures\/|node_modules)/;

const NOT_A_PEOPLE_COUNT: Record<string, string> = {
  "scripts/probes/user-fks-q331.probe.mjs": "a PGlite schema probe counting its own fixture rows to prove anonymisation keeps them",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const READ = /from\s+(?:public\.)?analytics_events\b(?!_real)|\.from\(\s*["']analytics_events["']\s*\)\s*\.select/gi;

/** Each raw read, and whether the robot filter sits in its own statement. */
function reads() {
  const rows: { file: string; filtered: boolean }[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const s = readFileSync(file, "utf8");
      for (const m of s.matchAll(READ)) {
        // The statement: up to its alias (`)::int AS events`, `) AS last_event_at`) or the
        // template's closing backtick, at most 400 characters.
        const rest = s.slice(m.index!, m.index! + 400);
        const end = rest.search(/\)(?:::int)?\s+AS\s|`/);
        const tail = end === -1 ? rest : rest.slice(0, end);
        rows.push({ file, filtered: /ROBOT_EVENT_SQL|analytics_events_real/.test(tail) });
      }
    }
  }
  return rows;
}

describe("analytics counts read the people's rows only (Q2112)", () => {
  it("every raw analytics_events read carries the robot filter, or is listed with why", () => {
    const rows = reads();
    // Floor: 5 raw analytics_events reads found on 2026-10-21.
    expect(rows.length).toBeGreaterThan(4);
    const bad = [...new Set(rows.filter((r) => !r.filtered && !(r.file in NOT_A_PEOPLE_COUNT)).map((r) => r.file))];
    expect(bad).toEqual([]);
  });

  it("NOT_A_PEOPLE_COUNT is exact: each entry still reads the raw table unfiltered", () => {
    const unfiltered = new Set(reads().filter((r) => !r.filtered).map((r) => r.file));
    expect(Object.keys(NOT_A_PEOPLE_COUNT).filter((f) => !unfiltered.has(f))).toEqual([]);
  });

  it("the inventory is not empty: the freshness monitor and the SLO page loads are found and filtered", () => {
    const files = new Set(reads().filter((r) => r.filtered).map((r) => r.file));
    expect(files).toContain("scripts/lib/analyticsFreshness.mjs");
    expect(files).toContain("scripts/slo.mjs");
  });

  it("ROBOT_EVENT_SQL is the exact complement of analytics_events_real's WHERE", () => {
    const mig = readFileSync("supabase/migrations/20261018035943_analytics_tag_automated.sql", "utf8");
    const view = mig.slice(mig.indexOf("CREATE OR REPLACE VIEW public.analytics_events_real"));
    // The view keeps rows that are NOT tagged automated AND NOT from an is_seed profile.
    expect(view).toContain("WHERE NOT (coalesce(e.properties, '{}'::jsonb) -> 'automated' IS NOT DISTINCT FROM 'true'::jsonb)");
    expect(view).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM public\.profiles p\s+WHERE p\.user_id = e\.user_id\s+AND p\.is_seed/);
    // The robot filter is (tagged automated) OR (from an is_seed profile).
    expect(ROBOT_EVENT_SQL.replace(/\s+/g, " ")).toBe(
      "(coalesce(e.properties, '{}'::jsonb) -> 'automated' IS NOT DISTINCT FROM 'true'::jsonb OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = e.user_id AND p.is_seed))",
    );
  });
});
