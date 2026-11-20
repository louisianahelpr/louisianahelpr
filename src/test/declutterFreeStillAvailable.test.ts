/**
 * Owner 2026-11-20 (a screenshot of 4 pushes at once): "If it's still listed in the app it's still for sale no need to
 * send this out." The free-listing "Is it still available?" ask (20261030232231) is retired by 20261120155422: its cron
 * is unscheduled, its cron_work_expectations / cron_catchup_policy rows deleted, the sweep, the "Still available"
 * answer and their asks table dropped, and the app's sheet removed.
 *
 * The CLASS this guards: an unprompted "is it still there?" nudge to a seller. Read from every migration and the app:
 *   - the job is unscheduled by the newest migration that names it, and nothing schedules it again;
 *   - no newest function sends a notice asking whether a listing is still available / still there;
 *   - the catch-up policy restated last has no row for it;
 *   - the app has no sheet, link or RPC call for it. "It's gone" stays: declutter_mark_sold_elsewhere, the seller's own.
 *
 * @mutate supabase/migrations/20261120155422_declutter_free_still_available_retired.sql |     PERFORM cron.unschedule('declutter-free-still-available'); |     NULL;
 * @mutate supabase/migrations/20261120155422_declutter_free_still_available_retired.sql | DROP FUNCTION IF EXISTS public.declutter_free_still_available_sweep(); | SELECT 1;
 * @mutate supabase/migrations/20261120155422_declutter_free_still_available_retired.sql |     DELETE FROM public.cron_work_expectations WHERE jobname IN ('declutter-free-still-available'); |     NULL;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const FILE = "20261120155422_declutter_free_still_available_retired.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const MIGS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((file) => ({ file, sql: flat(readFileSync(join(DIR, file), "utf8")) }));
const JOB = "declutter-free-still-available";
const DEFS = effectiveDefs(DIR);

/** Words that ask a seller whether their listing is still there. */
const STILL_ASK = /still available\?|still there, or|Tap to say it''?s still there/i;

describe("Declutter: no unprompted 'still available?' ask (owner 2026-11-20, 20261120155422)", () => {
  it("reads a real inventory (floors)", () => {
    expect(MIGS.length).toBeGreaterThan(1000);
    expect(DEFS.size).toBeGreaterThan(1000);
    expect(MIGS.filter((m) => m.sql.includes(`cron.schedule('${JOB}'`)).length).toBe(1); // the original, 20261030232231
  });

  it("the cron: the last migration that names it unschedules it, and its rows go", () => {
    const naming = MIGS.filter((m) => m.sql.includes(`cron.schedule('${JOB}'`) || m.sql.includes(`cron.unschedule('${JOB}')`));
    const last = naming[naming.length - 1];
    expect(last.file).toBe(FILE);
    expect(last.sql).toContain(`PERFORM cron.unschedule('${JOB}');`);
    expect(last.sql).toContain(`DELETE FROM public.cron_work_expectations WHERE jobname IN ('${JOB}');`);
    expect(last.sql).toContain(`DELETE FROM public.cron_catchup_policy WHERE jobname IN ('${JOB}');`);
    // The policy restated last (cronCatchUpPolicy reads the newest seeding migration as the whole set) has no row for it.
    const seeding = MIGS.filter((m) => m.sql.includes("INSERT INTO public.cron_catchup_policy"));
    const policy = seeding[seeding.length - 1];
    expect(policy.file).toBe(FILE);
    const values = policy.sql.slice(policy.sql.indexOf("INSERT INTO public.cron_catchup_policy"));
    expect(values).not.toContain(`('${JOB}'`);
    expect(values).toContain("('gift-wish-list-prune'");
  });

  it("the sweep, the answer RPC and their table are dropped; nothing defines them again", () => {
    const m = MIGS.find((x) => x.file === FILE)!.sql;
    expect(m).toContain("DROP FUNCTION IF EXISTS public.declutter_free_still_available_sweep();");
    expect(m).toContain("DROP FUNCTION IF EXISTS public.declutter_free_still_available(uuid);");
    expect(m).toContain("DROP TABLE IF EXISTS public.declutter_free_still_asks;");
    expect(DEFS.has("declutter_free_still_available_sweep")).toBe(false);
    expect(DEFS.has("declutter_free_still_available")).toBe(false);
  });

  it("CLASS: no newest function sends a seller a 'still available?' ask", () => {
    const asking = [...DEFS].filter(([, d]) => STILL_ASK.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(asking).toEqual([]);
    // "It's gone" stays the seller's own action.
    expect(DEFS.has("declutter_mark_sold_elsewhere")).toBe(true);
  });

  it("the app has no sheet, link or call for it", () => {
    const hits: string[] = [];
    for (const f of trackedFiles("src")) {
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.|\/test\//.test(f) || f.endsWith("integrations/supabase/types.ts")) continue;
      const src = blankComments(readFileSync(join(ROOT, f), "utf8"));
      if (/declutter_free_still_available|StillAvailableSheet|[?&]still=|Is it still available\?/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});
