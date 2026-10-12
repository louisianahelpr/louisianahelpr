/**
 * Q1502: when a job moves, its applications' frozen job point is VOIDED, never
 * left describing the old address and never refreshed (a refresh is the
 * move-and-ask ruler 20260907061408 closed).
 *
 * Executable proof: src/test/pglite/applicationJobPointVoid.pglite.mjs (OLD
 * STATE RED, chain 3x, the address-only edit path, the poster cannot un-void).
 * This file pins the newest definitions so a later migration cannot drop a
 * clause silently.
 *
 * @mutate supabase/migrations/20261012044309_application_job_point_voided_on_move.sql |   AFTER UPDATE ON public.jobs |   AFTER UPDATE OF latitude, longitude ON public.jobs
 * @mutate supabase/migrations/20261012044309_application_job_point_voided_on_move.sql |      AND a.job_longitude IS NULL\n     AND NOT a.job_point_void; |      AND a.job_longitude IS NULL;
 * @mutate supabase/migrations/20261012044309_application_job_point_voided_on_move.sql |   NEW.job_point_void := OLD.job_point_void;\n | \n
 * @mutate supabase/migrations/20261012044309_application_job_point_voided_on_move.sql |     NEW.job_point_void := false;\n    RETURN NEW; |     RETURN NEW;
 * @mutate src/lib/applicationColumns.ts | "offer_message_withheld", "job_point_void"] | "offer_message_withheld"]
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { APPLICATION_PRIVATE_COLUMNS, APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"));

function newestFunction(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = sqlOf(files[i]);
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag`);
    const open = sql.indexOf(tag, at);
    return sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length);
  }
  return "";
}

/** The newest CREATE TRIGGER <name> statement, up to its semicolon. */
function newestTrigger(name: string): string {
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = sqlOf(files[i]);
    const at = sql.lastIndexOf(`CREATE TRIGGER ${name}\n`);
    if (at >= 0) return sql.slice(at, sql.indexOf(";", at));
  }
  return "";
}

describe("Q1502: a job that moves voids its applications' frozen point", () => {
  const snapshot = newestFunction("snapshot_application_job_point");
  const fill = newestFunction("fill_application_job_point_on_first_geocode");
  const voider = newestFunction("void_application_job_point_on_move");
  const trigger = newestTrigger("trg_void_application_job_point");

  it("inventory: the three functions and the trigger exist", () => {
    expect(snapshot.length).toBeGreaterThan(200);
    expect(fill.length).toBeGreaterThan(200);
    expect(voider.length).toBeGreaterThan(200);
    expect(trigger.length).toBeGreaterThan(50);
  });

  it("the trigger watches every jobs update (an address-only edit clears the point in a BEFORE trigger)", () => {
    expect(trigger).toMatch(/AFTER UPDATE ON public\.jobs\s+FOR EACH ROW/);
    expect(trigger).toMatch(/round\(NEW\.latitude, 2\) IS DISTINCT FROM round\(OLD\.latitude, 2\)/);
    expect(trigger).toMatch(/EXECUTE FUNCTION public\.void_application_job_point_on_move\(\)/);
  });

  it("the void clears the point and sets the flag; the fill never touches a voided row", () => {
    expect(voider).toMatch(/SET job_latitude = NULL,\s+job_longitude = NULL,\s+job_point_void = true/);
    expect(fill).toMatch(/AND NOT a\.job_point_void;/);
  });

  it("insert starts unvoided; an end user can neither set nor clear the flag", () => {
    expect(snapshot).toMatch(/NEW\.job_point_void := false;\s+RETURN NEW;/);
    expect(snapshot).toMatch(/NEW\.job_point_void := OLD\.job_point_void;/);
    // The void path may only clear, never write a point.
    expect(snapshot).toMatch(/= 'on' THEN\s+NEW\.job_latitude\s+:= NULL;\s+NEW\.job_longitude\s+:= NULL;\s+NEW\.job_point_void := true;/);
  });

  it("the flag is server-only: never in the client's readable column list", () => {
    expect(APPLICATION_PRIVATE_COLUMNS).toContain("job_point_void");
    expect(APPLICATION_READABLE_COLUMN_LIST as readonly string[]).not.toContain("job_point_void");
  });
});
