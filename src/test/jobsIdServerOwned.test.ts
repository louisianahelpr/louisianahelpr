/**
 * Q1253 — jobs.id is the database's on a poster's INSERT.
 *
 * A poster could insert a job with an id it picked (e.g. one whose
 * deleted_jobs_log row was pruned). The client-INSERT branch of
 * enforce_jobs_insert_column_lock now resets NEW.id, the way Q1189 resets
 * created_at. Two layers:
 *   1. DB: the effective function assigns NEW.id := gen_random_uuid() after
 *      its server-context early return (so service_role keeps its own id).
 *   2. Client: the post payload (buildJobInsertPayload) never sends an id,
 *      so the reset changes nothing the app does; the post reads its id back
 *      with .select("id").
 * Behaviour, red then green: src/test/pglite/jobsIdServerOwned.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 2 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();

describe("Q1253: the database picks a new job's id", () => {
  const def = effectiveDefs(join(ROOT, "supabase/migrations")).get("enforce_jobs_insert_column_lock");
  const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

  it("the client branch of the insert lock resets NEW.id", () => {
    expect(def?.file).toBeTruthy();
    const serverReturn = body.search(/IF public\.is_server_context\(\) OR auth\.uid\(\) IS DISTINCT FROM NEW\.customer_id THEN RETURN NEW; END IF;/);
    const reset = body.search(/NEW\.id\s*:=\s*gen_random_uuid\(\);/);
    expect(serverReturn, "the server-context early return moved or went").toBeGreaterThan(-1);
    expect(reset, "NEW.id is no longer reset for a client insert").toBeGreaterThan(serverReturn);
  });

  it("the post payload never sends an id (and still reads it back)", () => {
    const helpers = blankComments(readFileSync(join(ROOT, "src/pages/post-job/jobSubmitHelpers.ts"), "utf8"));
    const start = helpers.indexOf("export function buildJobInsertPayload");
    expect(start).toBeGreaterThan(-1);
    const fn = helpers.slice(start, helpers.indexOf("\n}\n", start));
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).not.toMatch(/(?<![\w.])id\s*:/);
    const submit = blankComments(readFileSync(join(ROOT, "src/pages/post-job/useJobSubmit.ts"), "utf8"));
    expect(submit).toMatch(/\.from\("jobs"\)\s*\.insert\(\{[\s\S]{0,200}\}\)\s*\.select\("id"\)/);
  });
});

// @mutate supabase/migrations/20261004191544_jobs_id_server_owned.sql |   NEW.id                          := gen_random_uuid();\n |
// @mutate src/pages/post-job/jobSubmitHelpers.ts |     ...(department && department.trim() |     id: crypto.randomUUID(),\n    ...(department && department.trim()
