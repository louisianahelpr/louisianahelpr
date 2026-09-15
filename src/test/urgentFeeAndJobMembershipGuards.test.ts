import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * DURABLE HALF of the 2026-09-15 hole-hunt fixes for
 *   • silent-client H-001 — free urgent placement (is_urgent=true with a
 *     NULL/0 urgent_fee slipped past PostgREST and reached the urgent
 *     notification fan-out for free), and
 *   • authz AUTHZ-01 / AUTHZ-03 — job_tracking / job_checkins writes checked
 *     only "am I who I say I am?" (auth.uid() = own actor column), never "am I
 *     a party to this job?", a live-location spoof surface.
 *
 * The migrations were EXECUTED against real Postgres in PGlite before shipping
 * (red-first: the bypass reproduced, then the fix refused it; replay-safe 3x;
 * legacy free-urgent rows demoted; the assigned helper and both parties still
 * pass). PGlite is deliberately absent from package.json (see CLAUDE.md and
 * jobsGuardRpcParity.test.ts) — a test that imported it would fail in CI, so
 * this file is the durable, CI-safe half: it pins the SHAPE of the guards in
 * the live migration text so narrowing one is what turns this red.
 *
 * The LIVE definition of an object is the one in the newest migration that
 * mentions it (filename sort), the same rule the sibling parity tests use.
 */
const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

function newestMigrationContaining(needle: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const hits = files.filter((f) =>
    readFileSync(resolve(MIGRATIONS, f), "utf8").includes(needle),
  );
  expect(
    hits.length,
    `No migration contains "${needle}". If it was renamed, point this test at the new text — do not delete the check.`,
  ).toBeGreaterThan(0);
  return readFileSync(resolve(MIGRATIONS, hits[hits.length - 1]), "utf8");
}

/** Collapse whitespace so predicate assertions ignore formatting. */
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("urgent placement requires a paid fee (H-001)", () => {
  const sql = flat(newestMigrationContaining("jobs_urgent_fee_required"));

  it("re-authors jobs_urgent_fee_required so an urgent job MUST carry a fee at/above the floor", () => {
    // The floor written the natural way is vacuously true on a NULL fee; the
    // fix must reject NULL explicitly AND enforce the >= floor bound.
    expect(sql).toMatch(/ADD CONSTRAINT jobs_urgent_fee_required/i);
    expect(sql).toContain("is_urgent IS NOT TRUE");
    expect(sql).toContain("urgent_fee IS NOT NULL");
    expect(sql).toMatch(/urgent_fee >= 5/);
  });

  it("drops the stale prod-only constraint before re-adding, and is jobs-guarded (replay-safe)", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS jobs_urgent_fee_required/i);
    expect(sql).toContain("to_regclass('public.jobs')");
  });

  it("demotes legacy free-urgent rows rather than inventing a fee the poster never agreed to", () => {
    expect(sql).toMatch(/UPDATE public\.jobs SET is_urgent = false WHERE is_urgent IS TRUE/i);
  });
});

describe("job-scoped writes require job membership (AUTHZ-01 / AUTHZ-03)", () => {
  const sql = flat(newestMigrationContaining('CREATE POLICY "Helpers can insert tracking"'));

  it("job_tracking INSERT binds the caller to the job's ASSIGNED helper, not just self-identity", () => {
    // The old policy was WITH CHECK (auth.uid() = helper_id) alone.
    const insert = sql.slice(sql.indexOf('CREATE POLICY "Helpers can insert tracking"'));
    expect(insert).toContain("auth.uid() = helper_id");
    expect(insert).toMatch(/EXISTS \( SELECT 1 FROM public\.jobs j WHERE j\.id = job_tracking\.job_id AND j\.helper_id = auth\.uid\(\)/i);
  });

  it("job_tracking UPDATE carries the same membership guard on both USING and WITH CHECK", () => {
    const upd = sql.slice(sql.indexOf('CREATE POLICY "Helpers can update their tracking"'));
    // Two membership EXISTS blocks (USING + WITH CHECK) reference jobs.helper_id.
    const matches = upd.match(/j\.id = job_tracking\.job_id AND j\.helper_id = auth\.uid\(\)/gi) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("job_checkins INSERT requires the caller be a PARTY to the job (poster or assigned helper)", () => {
    const chk = sql.slice(sql.indexOf('CREATE POLICY "Users can create their own checkins"'));
    expect(chk).toContain("auth.uid() = user_id");
    expect(chk).toMatch(/j\.id = job_checkins\.job_id AND \(j\.customer_id = auth\.uid\(\) OR j\.helper_id = auth\.uid\(\)\)/i);
  });
});

describe("create-payment recomputes the urgent fee, never trusts the stored column", () => {
  const src = readFileSync(
    resolve(ROOT, "supabase/functions/create-payment/index.ts"),
    "utf8",
  );

  it("charges the urgent tip only when is_urgent, floored at $5 and ceilinged at $5,000", () => {
    expect(src).toContain("URGENT_FEE_FLOOR_CENTS = 500");
    expect(src).toContain("URGENT_FEE_CEILING_CENTS = 500000");
    // The charge branches on is_urgent and floors via Math.max, never reads the
    // raw column back into the line item.
    expect(flat(src)).toMatch(/urgentFeeCents = job\.is_urgent \? Math\.min\( Math\.max\(storedUrgentFeeCents, URGENT_FEE_FLOOR_CENTS\)/);
    expect(src).toContain("if (urgentFeeCents > 0) {");
    expect(src).toContain("unit_amount: urgentFeeCents,");
  });
});
