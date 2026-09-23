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
 *
 * Shown able to fail: the first mutation re-opens H-001 by writing the floor
 * the VACUOUS way (true on a NULL fee); the second strips the job-membership
 * EXISTS back to the old self-identity-only WITH CHECK (AUTHZ-01); the third
 * un-floors the fee create-payment actually charges.
 * @mutate supabase/migrations/20260915055413_fix_urgent_placement_requires_paid_fee.sql | OR (urgent_fee IS NOT NULL AND urgent_fee >= 5) | OR (urgent_fee >= 5)
 * @mutate supabase/migrations/20260915055415_job_tracking_checkins_require_job_membership.sql | FOR INSERT\n      WITH CHECK (\n        auth.uid() = helper_id\n        AND EXISTS (\n          SELECT 1 FROM public.jobs j\n          WHERE j.id = job_tracking.job_id\n            AND j.helper_id = auth.uid()\n        )\n      ); | FOR INSERT\n      WITH CHECK (auth.uid() = helper_id);
 * @mutate supabase/migrations/20260915055415_job_tracking_checkins_require_job_membership.sql |         auth.uid() = user_id\n        AND EXISTS (\n          SELECT 1 FROM public.jobs j\n          WHERE j.id = job_checkins.job_id\n            AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())\n        )\n |         auth.uid() = user_id\n
 * @mutate supabase/functions/create-payment/index.ts | const URGENT_FEE_FLOOR_CENTS = 500; | const URGENT_FEE_FLOOR_CENTS = 0;
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
  return stripSqlComments(readFileSync(resolve(MIGRATIONS, hits[hits.length - 1]), "utf8"));
}

/**
 * Drop `-- ...` line comments before any assertion.
 *
 * Every check below is a text pin, and a text pin a COMMENT can satisfy is
 * not a pin. Proved 2026-09-20: rewriting the H-001 predicate as
 * `OR (true) -- urgent_fee IS NOT NULL AND urgent_fee >= 5` restores free
 * urgent placement and left this file GREEN. A `--` inside a single-quoted
 * literal is left alone (odd quote count before it on the line).
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") quoted = !quoted;
        else if (!quoted && line[i] === "-" && line[i + 1] === "-") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Collapse whitespace so predicate assertions ignore formatting. */
const flat = (s: string) => s.replace(/\s+/g, " ");

/**
 * ONE policy's text, bounded at the next CREATE POLICY.
 *
 * This used to slice from the policy name to the END of the file, so the
 * INSERT assertion was satisfied by the UPDATE policy's identical membership
 * clause further down: deleting the EXISTS from the INSERT policy — AUTHZ-01,
 * exactly what this guard exists to catch — left it GREEN (proved 2026-09-20
 * by the second @mutate registration above, which now kills it).
 */
function policyBody(sql: string, name: string): string {
  const start = sql.indexOf(name);
  expect(start, `policy not found: ${name}`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("CREATE POLICY", start + name.length);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

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
    const insert = policyBody(sql, 'CREATE POLICY "Helpers can insert tracking"');
    expect(insert).toContain("auth.uid() = helper_id");
    expect(insert).toMatch(/EXISTS \( SELECT 1 FROM public\.jobs j WHERE j\.id = job_tracking\.job_id AND j\.helper_id = auth\.uid\(\)/i);
  });

  it("job_tracking UPDATE carries the same membership guard on both USING and WITH CHECK", () => {
    const upd = policyBody(sql, 'CREATE POLICY "Helpers can update their tracking"');
    // Two membership EXISTS blocks (USING + WITH CHECK) reference jobs.helper_id.
    const matches = upd.match(/j\.id = job_tracking\.job_id AND j\.helper_id = auth\.uid\(\)/gi) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("job_checkins INSERT requires the caller be a PARTY to the job (poster or assigned helper)", () => {
    const chk = policyBody(sql, 'CREATE POLICY "Users can create their own checkins"');
    expect(chk).toContain("auth.uid() = user_id");
    expect(chk).toMatch(/j\.id = job_checkins\.job_id AND \(j\.customer_id = auth\.uid\(\) OR j\.helper_id = auth\.uid\(\)\)/i);
  });
});

describe("create-payment recomputes the urgent fee, never trusts the stored column", () => {
  const src = readFileSync(
    resolve(ROOT, "supabase/functions/create-payment/index.ts"),
    "utf8",
  );

  it("charges the urgent tip only when is_urgent, floored at $5 and ceilinged at the shared MAX_URGENT_FEE_DOLLARS ($250 since Q210(c))", () => {
    // Anchored at the start of a line so a trailing `// ... = 500` comment
    // cannot satisfy the pin while the real constant is lowered (proved
    // 2026-09-20: `= 1; // was URGENT_FEE_FLOOR_CENTS = 500;` kept this green).
    expect(src).toMatch(/^\s*const URGENT_FEE_FLOOR_CENTS = 500;/m);
    expect(src).toMatch(/^\s*const URGENT_FEE_CEILING_CENTS = MAX_URGENT_FEE_DOLLARS \* 100;/m);
    // The charge branches on is_urgent and floors via Math.max, never reads the
    // raw column back into the line item.
    expect(flat(src)).toMatch(/urgentFeeCents = job\.is_urgent \? Math\.min\( Math\.max\(storedUrgentFeeCents, URGENT_FEE_FLOOR_CENTS\)/);
    expect(src).toContain("if (urgentFeeCents > 0) {");
    expect(src).toContain("unit_amount: urgentFeeCents,");
  });
});
