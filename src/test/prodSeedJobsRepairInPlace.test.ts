/**
 * THE SEED REPAIRS ITS JOBS IN PLACE; IT NEVER RE-INSERTS AN EXISTING ONE.
 *
 * `enforce_open_job_limit` is a BEFORE INSERT row trigger on jobs, and
 * Postgres fires BEFORE INSERT row triggers for INSERT ... ON CONFLICT DO
 * UPDATE even when the row already exists. prod-seed.mjs used to write its
 * fixed-id jobs with `upsert("jobs", ...)` (PostgREST merge-duplicates), so
 * every run was judged as posting new open jobs: whenever poster-e2e already
 * held 5 cap-counted open jobs, --apply died on
 * `POST jobs → 400 P0001 "You can have a maximum of 5 open jobs at a time"`
 * while inserting nothing (prod-audit run 38689259675, 2026-10-15, legs 1+2).
 *
 * The class: every jobs write in a seed script that targets fixed ids goes
 * through writeSeedJobs (PATCH what exists, INSERT only what is missing).
 *
 * @mutate scripts/audit/prod-seed.mjs |   await writeSeedJobs([...posterJobs, ...heavyJobs]); |   await upsert("jobs", [...posterJobs, ...heavyJobs]);
 * @mutate scripts/audit/prod-seed.mjs |   const missing = rows.filter((r) => !existing.has(r.id)); |   const missing = rows;
 * @mutate scripts/audit/prod-seed.mjs | `jobs?id=${inList(chunk)}&is_seed=eq.true` | `jobs?id=${inList(chunk)}`
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SEED = blankComments(readFileSync(resolve(ROOT, "scripts/audit/prod-seed.mjs"), "utf8"));

/** Every .mjs under scripts/ that POSTs to the jobs table with merge-duplicates. */
function seedScriptsUpsertingJobs(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".mjs")) {
        const src = blankComments(readFileSync(p, "utf8"));
        if (/merge-duplicates/.test(src) && /["'`]jobs\?on_conflict|upsert\(\s*["']jobs["']/.test(src)) out.push(p.slice(ROOT.length + 1));
      }
    }
  };
  walk(resolve(ROOT, "scripts"));
  return out;
}

describe("prod-seed repairs its fixed-id jobs in place (open-job cap trigger fires on upsert)", () => {
  it("prod-seed.mjs is the only script that upserts jobs", () => {
    expect(seedScriptsUpsertingJobs()).toEqual(["scripts/audit/prod-seed.mjs"]);
  });

  it("every jobs write in prod-seed.mjs goes through writeSeedJobs", () => {
    const calls = [...SEED.matchAll(/upsert\(\s*"jobs"\s*,\s*([^\n]*)/g)].map((m) => m[1]);
    expect(calls.length, "the one insert, inside writeSeedJobs").toBeGreaterThan(0);
    expect(calls, "the only upsert of jobs inserts the rows that are missing, marked is_seed").toEqual([
      "missing.map((r) => ({ ...r, is_seed: true })));",
    ]);
    const writes = SEED.match(/await writeSeedJobs\(/g) ?? [];
    expect(writes.length, "the poster/heavy set and the group job").toBeGreaterThanOrEqual(2);
  });

  it("writeSeedJobs PATCHes rows that exist and inserts only the missing ones", () => {
    const body = SEED.slice(SEED.indexOf("async function writeSeedJobs("), SEED.indexOf("async function", SEED.indexOf("async function writeSeedJobs(") + 10));
    expect(body).toMatch(/select\(`jobs\?id=\$\{inList\(/);
    // Only a seed row can be repaired: a non-seed row with a seed id matches
    // nothing and the count check throws (lh-money-escrow review, 2026-10-17).
    expect(body).toMatch(/rest\("PATCH", `jobs\?id=\$\{inList\(chunk\)\}&is_seed=eq\.true`/);
    expect(body).toMatch(/const missing = rows\.filter\(\(r\) => !existing\.has\(r\.id\)\);/);
    expect(body, "a PATCH is read back by count").toMatch(/out\.length !== chunk\.length/);
  });
});
