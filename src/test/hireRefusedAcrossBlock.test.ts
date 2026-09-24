/**
 * Q345 — no hire across a block, on EVERY hire RPC.
 *
 * WHAT WAS BROKEN (prod, 2026-09-24): Q341 refused new applications across a
 * block and hid blocked applicants from the poster, but an application filed
 * BEFORE the block stayed pending, and accept_application /
 * accept_group_application (SECURITY DEFINER, take the application id) never
 * looked at user_blocks — so it was still hireable by id.
 *
 * THE INVENTORY is derived from the migrations, not listed by hand: every
 * function whose EFFECTIVE definition hires someone — sets an application or
 * job to 'accepted', or inserts a group_job_helpers seat. On prod (pg_proc,
 * 2026-09-24) that same pattern matched exactly these three. Each must refuse
 * with applicant_blocked BEFORE its first hiring write, and each code must have
 * role-neutral copy that does not say who blocked whom.
 *
 * A new hire RPC fails "the hire-RPC inventory is exact" until it is added here
 * AND carries the check. Behavioural proof, red-before/green-after, 3x replay:
 * scripts/probes/hire-across-block.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

const HIRE_WRITE =
  /update\s+(public\.)?applications\s+set\s+status\s*=\s*'accepted'|insert\s+into\s+(public\.)?applications[^;]*'accepted'|insert\s+into\s+(public\.)?group_job_helpers|set\s+status\s*=\s*'accepted'/i;

const EXPECTED = ["accept_application", "accept_group_application", "respond_to_direct_offer"];

describe("Q345: every hire RPC refuses across a block", () => {
  const defs = effectiveDefs(MIG_DIR);
  // effectiveDefs does not model DROP FUNCTION; a function dropped in a file
  // after its last definition is not in the database (instant_book_claim,
  // dropped by 20260904034410, is the case that proves this matters).
  const droppedAfter = new Map<string, string>();
  for (const f of migrationFiles(MIG_DIR)) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) droppedAfter.set(m[1], f);
  }
  const hireFns = new Map<string, string>();
  for (const [name, def] of defs) {
    const dropped = droppedAfter.get(name);
    if (dropped && dropped > def.file) continue;
    const body = blankSqlComments(def.stmt);
    if (HIRE_WRITE.test(body)) hireFns.set(name, body);
  }

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(hireFns.size).toBeGreaterThan(2);
    expect(droppedAfter.get("instant_book_claim"), "DROP FUNCTION parsing is blind").toBeTruthy();
  });

  it("the hire-RPC inventory is exact", () => {
    expect([...hireFns.keys()].sort()).toEqual(EXPECTED);
  });

  for (const name of [...hireFns.keys()].sort()) {
    it(`${name} raises applicant_blocked on are_users_blocked before its first hiring write`, () => {
      const body = hireFns.get(name) ?? "";
      const check = body.search(
        /if\s+(public\.)?are_users_blocked\s*\([^;]*\)\s+then\s+raise\s+exception\s+'applicant_blocked'/i,
      );
      const write = body.search(HIRE_WRITE);
      expect(check, `${name} has no block check`).toBeGreaterThan(-1);
      expect(check).toBeLessThan(write);
    });

    it(`${name} has copy for applicant_blocked that does not say who blocked`, () => {
      const copy = (RPC_ERROR_COPY as Record<string, Record<string, string>>)[name]?.applicant_blocked;
      expect(copy).toBeTruthy();
      expect(copy).not.toMatch(/block/i);
      expect(copy).not.toMatch(/\bhelpr\b|\bposter\b/i);
    });
  }
});

// Each hire RPC's check removed, one at a time.
// @mutate supabase/migrations/20260924023314_hire_refused_across_block.sql | IF public.are_users_blocked(v_helper_id, v_job_customer) THEN | IF false THEN
// @mutate supabase/migrations/20260924023314_hire_refused_across_block.sql | IF public.are_users_blocked(v_job_customer, v_helper_id) THEN | IF false THEN
// @mutate supabase/migrations/20260924023314_hire_refused_across_block.sql | IF public.are_users_blocked(auth.uid(), v_customer) THEN | IF false THEN
// The accept copy removed.
// @mutate src/lib/lifecycleErrors.ts | applicant_blocked: "This person can no longer be hired for this job.", | x_unused: "x",
