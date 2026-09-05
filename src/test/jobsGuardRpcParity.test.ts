import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * JOBS COLUMN GUARDS ↔ THE RPCs THAT MUST PASS THROUGH THEM.
 *
 * Three of the five bugs found in the 2026-09-05 two-account end-to-end test
 * were the same bug, and none of them could be seen by reading either side on
 * its own:
 *
 *   dispute   `rpc_open_dispute` writes jobs.disputed_by; the helper column
 *             whitelist allowed disputed_at, dispute_status, dispute_reason,
 *             dispute_evidence_urls and dispute_helper_response — every
 *             sibling — but not disputed_by. A helper could never open a
 *             dispute. 403/42501, 100% of the time.
 *
 *   no-show   `report_helper_no_show` clears jobs.helper_id to reopen the job,
 *             and announces itself with `set_config('app.trusted_ladder_write',
 *             'on', true)` — whose own comment says it "releases the jobs
 *             field-lock for the server-owned unassign below". The poster money
 *             lock never read that flag. A poster could never report a no-show.
 *
 * Both features were complete: real UI, careful consequence copy, a correct
 * SECURITY DEFINER RPC with proper guards of its own. The only thing missing
 * was one entry in a list in a different file, and the symptom was a 403 that
 * no test, typecheck or code read would surface — you had to run the statement
 * through the trigger.
 *
 * SECURITY DEFINER does not save you here, which is what makes this worth a
 * test rather than a comment: both guards key off `auth.uid()`, not the current
 * role, so the definer's rights buy nothing and the caller's uid is still what
 * gets checked.
 *
 * WHAT THIS FILE PINS. The two holes above, so they cannot silently reopen, and
 * — more importantly — the SHAPE that made them possible: the guards' lists are
 * read out of the live migration rather than retyped here, so narrowing one is
 * what fails this test.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not execute SQL. PGlite is
 * deliberately absent from package.json (see CLAUDE.md — it is installed to a
 * scratch dir for one-off migration probes), so a test that imported it would
 * fail in CI. Both fixes WERE executed against real Postgres in PGlite before
 * shipping, three times each, with the negative cases asserted; this file is
 * the durable half of that, not a replacement for it.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/**
 * The LIVE definition of a function is the one in the newest migration that
 * defines it — same rule, and the same caveat, as
 * `consequenceCopyParity.test.ts`'s LADDER_SQL. Derived by filename sort rather
 * than hardcoded, so this keeps working when the next migration redefines one
 * of these. A hardcoded path is exactly how a parity test goes quietly blind.
 */
function liveDefinition(fnName: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const defining = files.filter((f) =>
    readFileSync(resolve(MIGRATIONS, f), "utf8").includes(`FUNCTION public.${fnName}`),
  );
  expect(
    defining.length,
    `No migration defines public.${fnName}. If it was renamed, point this test at the new name — do not delete the check.`,
  ).toBeGreaterThan(0);
  return readFileSync(resolve(MIGRATIONS, defining[defining.length - 1]), "utf8");
}

/** Pull a `name CONSTANT text[] := ARRAY[ 'a', 'b' ]` list out of plpgsql. */
function sqlArrayLiteral(src: string, varName: string): string[] {
  const m = src.match(new RegExp(`${varName}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([^\\]]*)\\]`, "i"));
  expect(m, `Could not find the ${varName} array — the guard was restructured; re-read it before trusting this test.`).toBeTruthy();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("jobs column guards ↔ the RPCs that must pass through them", () => {
  describe("helper whitelist ↔ rpc_open_dispute", () => {
    const guard = liveDefinition("enforce_helper_jobs_column_whitelist");
    const allowed = sqlArrayLiteral(guard, "allowed");

    it("allows every column rpc_open_dispute writes", () => {
      // Read off the RPC's own UPDATE rather than retyped here: it sets
      // status, disputed_by, disputed_at and dispute_status in one statement,
      // and ONE missing entry refuses the whole thing.
      for (const col of ["status", "disputed_by", "disputed_at", "dispute_status"]) {
        expect(
          allowed,
          `enforce_helper_jobs_column_whitelist does not permit jobs.${col}. ` +
            `rpc_open_dispute writes it, so a helper opening a dispute gets ` +
            `42501 "Helpers may not modify jobs.${col}" and the feature is ` +
            `unreachable — which is exactly the bug fixed on 2026-09-05.`,
        ).toContain(col);
      }
    });

    it("still refuses money and identity columns", () => {
      // The fix must not have widened the guard into a rubber stamp.
      for (const col of ["budget", "customer_id", "payment_status", "platform_fee_amount"]) {
        expect(allowed, `jobs.${col} must NOT be helper-writable`).not.toContain(col);
      }
    });

    it("keeps the arrival stamp out of the list and behind its RPC flag", () => {
      // helper_arrival_verified_at is deliberately NOT allowed: only
      // mark_helper_arrival may set it, gated on app.arrival_rpc, because the
      // proximity verdict is computed server-side. A future edit that "fixes"
      // the 42501 by adding it to `allowed` would let a client PATCH claim its
      // own arrival was GPS-verified.
      expect(allowed).not.toContain("helper_arrival_verified_at");
      expect(guard).toContain("app.arrival_rpc");
    });
  });

  describe("poster money lock ↔ report_helper_no_show", () => {
    const guard = liveDefinition("enforce_poster_jobs_money_lock");
    const lockedWhenFunded = sqlArrayLiteral(guard, "locked_when_funded");

    it("honours the trusted-ladder flag for the server-owned unassign", () => {
      // report_helper_no_show reopens the job with
      //   UPDATE jobs SET status='open', helper_id=NULL
      // after setting app.trusted_ladder_write. helper_id is locked when
      // funded, so without this exemption Confirm No-Show is a dead button.
      expect(lockedWhenFunded).toContain("helper_id");
      expect(
        guard,
        "enforce_poster_jobs_money_lock no longer reads app.trusted_ladder_write. " +
          "report_helper_no_show sets that flag specifically to release this lock " +
          "for its unassign; without it a poster can never report a no-show.",
      ).toContain("app.trusted_ladder_write");
    });

    it("scopes the exemption to clearing helper_id, never re-pointing it", () => {
      // The flag alone must not be enough. A trusted ladder write may clear
      // helper_id; nothing may aim it at a different person, or a compromised
      // ladder path could redirect a funded job's payout.
      expect(guard).toMatch(/NEW\.helper_id IS NULL/);
    });

    it("keeps the money columns locked once checkout has opened", () => {
      for (const col of ["budget", "payment_status", "platform_fee_amount", "helper_fee_percent"]) {
        expect(lockedWhenFunded, `jobs.${col} must stay locked once funded`).toContain(col);
      }
    });
  });

  describe("the flag contract itself", () => {
    it("app.trusted_ladder_write is still SET by the no-show RPC", () => {
      // If the RPC stops setting the flag, the exemption above silently stops
      // applying and the button dies again — with the guard looking correct.
      const rpc = liveDefinition("report_helper_no_show");
      expect(rpc).toContain("app.trusted_ladder_write");
      expect(rpc).toMatch(/helper_id\s*=\s*NULL/i);
    });
  });
});
