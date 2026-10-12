/**
 * Q1503 CLASS GUARD: every jobs column that describes the job's PLACE follows
 * jobs.location when the address changes.
 *
 * The class: a column written once at post time from the address (the map
 * point, the ZIP, the parish) goes stale when a later writer replaces
 * jobs.location (the poster's open-job edit, EditJobDialog; an agreed change
 * of a booked job's address, respond_job_detail_change). Q1499 fixed the map
 * point (zzzzzz_jobs_location_clears_coords); parish and zip_code kept
 * describing the old place until 20261012070813 (lh-authz-rls@054942e80#3).
 *
 * Read from the migrations (comments blanked, any dollar-quote tag, the
 * definitions the migrations actually leave):
 *   1. INVENTORY: each place column has a standing BEFORE UPDATE OF location
 *      trigger on jobs whose function assigns NEW.<column>.
 *   2. Those triggers sort after every other BEFORE trigger on jobs, so the
 *      poster's lock and the Helpr's column whitelist judge the write as the
 *      client sent it (a derived parish never reads as a Helpr writing it).
 *   3. The parish/ZIP derivation is SECURITY DEFINER with a pinned
 *      search_path (it runs as the Helpr on an agreed change) and nobody can
 *      call it (REVOKE ... FROM PUBLIC, anon, authenticated).
 *
 * Behaviour (real jobs chain, poster + Helpr, applied 3x; RED without it):
 *   npx tsx src/test/pglite/jobAddressRederivesPlace.pglite.mjs
 *
 * @mutate supabase/migrations/20261012070813_job_address_rederives_zip_and_parish.sql |   NEW.zip_code := v_zip; |   v_zip := v_zip;
 * @mutate supabase/migrations/20261012070813_job_address_rederives_zip_and_parish.sql |     SELECT z.parish INTO NEW.parish FROM | SELECT z.parish INTO v_city FROM
 * @mutate supabase/migrations/20261012070813_job_address_rederives_zip_and_parish.sql | CREATE TRIGGER zzzzzz_jobs_location_rederives_place | CREATE TRIGGER aaa_jobs_location_rederives_place
 * @mutate supabase/migrations/20261012070813_job_address_rederives_zip_and_parish.sql |   BEFORE UPDATE OF location ON public.jobs\n  FOR EACH ROW EXECUTE FUNCTION public.jobs_location_rederives_place(); |   BEFORE UPDATE OF title ON public.jobs\n  FOR EACH ROW EXECUTE FUNCTION public.jobs_location_rederives_place();
 * @mutate supabase/migrations/20261012070813_job_address_rederives_zip_and_parish.sql | REVOKE ALL ON FUNCTION public.jobs_location_rederives_place() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.jobs_location_rederives_place() FROM PUBLIC;
 * @mutate supabase/migrations/20261012070813_job_address_rederives_zip_and_parish.sql |  SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_zip | SET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_zip
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory, triggersOn } from "./helpers/migrationTriggers";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = migrationFiles(MIG);
const sqlOf = (f: string) => readFileSync(join(MIG, f), "utf8");
const defs = effectiveDefs(MIG);
const jobsTriggers = triggersOn(triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) }))), "jobs");
const before = jobsTriggers.filter((t) => t.timing === "BEFORE");

/** The jobs columns that describe the job's place, all derived from jobs.location. */
const PLACE_COLUMNS = ["latitude", "longitude", "zip_code", "parish"];

const onLocationUpdate = before.filter((t) => /\bUPDATE\s+OF\b[\s\S]*\blocation\b/i.test(t.events));
const assigns = (fn: string, col: string) => {
  const d = defs.get(fn);
  return !!d && new RegExp(`\\bNEW\\.${col}\\s*:=|\\bINTO\\s+NEW\\.${col}\\b`, "i").test(blankSqlComments(bodyOf(d.stmt)));
};

describe("Q1503: a job's place columns follow its address", () => {
  it("inventory floor: the migrations leave BEFORE triggers on jobs to read", () => {
    expect(before.length).toBeGreaterThan(10);
  });

  for (const col of PLACE_COLUMNS) {
    it(`jobs.${col} is re-derived or cleared by a BEFORE UPDATE OF location trigger`, () => {
      const owners = onLocationUpdate.filter((t) => assigns(t.fn, col)).map((t) => t.name);
      expect(owners, `no standing BEFORE UPDATE OF location trigger on jobs assigns NEW.${col}`).not.toEqual([]);
    });
  }

  it("the place triggers fire after every other BEFORE trigger on jobs (the lock and whitelist see the client's write)", () => {
    const place = onLocationUpdate.filter((t) => PLACE_COLUMNS.some((c) => assigns(t.fn, c))).map((t) => t.name);
    const others = before.map((t) => t.name).filter((n) => !place.includes(n));
    for (const p of place) for (const o of others) expect(o < p, `${o} sorts after ${p}`).toBe(true);
  });

  it("the parish/ZIP derivation is SECURITY DEFINER, pinned, and nobody's to call", () => {
    const d = defs.get("jobs_location_rederives_place");
    expect(d, "jobs_location_rederives_place is not defined").toBeDefined();
    const head = blankSqlComments(d!.stmt).split(/\bAS\s+\$/i)[0];
    expect(head).toMatch(/SECURITY\s+DEFINER/i);
    expect(head).toMatch(/SET\s+search_path\s+TO\s+'public',\s*'pg_temp'/i);
    expect(blankSqlComments(sqlOf(d!.file))).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.jobs_location_rederives_place\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i,
    );
  });
});
