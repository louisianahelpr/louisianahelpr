/**
 * Q2291: a member's job address must be in Louisiana, on the SERVER (the client's single address box is not the
 * only way in: manual fields, CurrentLocationPill and direct inserts reached jobs with no state rule). This guard
 * reads the trigger the migrations LEAVE and the newest body of its function; behaviour is proven by
 * src/test/pglite/jobsAddressInLouisiana.pglite.mjs. The poster's copy maps through lifecycleErrorMessage.
 */
// @mutate supabase/migrations/20261021110531_jobs_address_in_louisiana.sql |   IF v_zip IS NOT NULL AND (v_zip < '70000' OR v_zip > '71499') THEN |   IF false THEN
// @mutate supabase/migrations/20261021110531_jobs_address_in_louisiana.sql | CREATE TRIGGER zz_jobs_address_in_louisiana | CREATE TRIGGER aa_jobs_address_in_louisiana
// @mutate supabase/migrations/20261021110531_jobs_address_in_louisiana.sql |   BEFORE INSERT OR UPDATE OF location, latitude, longitude ON public.jobs |   BEFORE UPDATE OF title ON public.jobs
// @mutate src/lib/lifecycleErrors.ts |   job_address_not_louisiana: "Helpr is in Louisiana only for now. Use a Louisiana address.", |
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";

const MIG = join(process.cwd(), "supabase/migrations");
const inv = triggerInventory(migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") })));
const defs = effectiveDefs(MIG);

describe("a job's address is in Louisiana (Q2291)", () => {
  const trg = inv.get("jobs.zz_jobs_address_in_louisiana");
  it("the trigger runs on insert and on every address change", () => {
    expect(trg, "zz_jobs_address_in_louisiana is gone").toBeDefined();
    expect(trg!.timing).toBe("BEFORE");
    expect(trg!.events).toMatch(/INSERT/);
    expect(trg!.events).toMatch(/UPDATE OF LOCATION, LATITUDE, LONGITUDE/);
    // After the insert lock that re-derives is_seed from the profile (review M1), or a forged is_seed skips it.
    expect(inv.get("jobs.trg_jobs_insert_column_lock"), "the insert lock was renamed: re-check the order").toBeDefined();
    expect(trg!.name > "trg_jobs_insert_column_lock").toBe(true);
  });
  it("it refuses a non-LA state, a non-LA ZIP and a point outside Louisiana", () => {
    const body = bodyOf(defs.get(trg!.fn)?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toContain("NOT IN ('la', 'louisiana')");
    expect(body).toContain("(v_zip < '70000' OR v_zip > '71499')");
    expect(body).toContain("NOT BETWEEN 28.8 AND 33.1");
    expect((body.match(/RAISE EXCEPTION 'job_address_not_louisiana'/g) ?? []).length).toBe(3);
  });
  it("the poster reads plain words, not the code", () => {
    expect(lifecycleErrorMessage({ message: 'job_address_not_louisiana' })).toBe("Helpr is in Louisiana only for now. Use a Louisiana address.");
  });
});
