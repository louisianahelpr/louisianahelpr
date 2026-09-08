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

    /**
     * THE FOURTH INSTANCE, found 2026-09-07 — the same statement's other table.
     *
     * The block at the foot of this file pins `rpc_withdraw_dispute`'s
     * `UPDATE public.disputes`. It writes `UPDATE public.jobs` too:
     *
     *     SET status = …, dispute_status = 'resolved', dispute_resolved_at = now()
     *
     * and `dispute_resolved_at` was not on the helper allow-list. So the RPC
     * worked for a poster (the guard exits early for them) and refused the
     * OPENER-HELPER with `42501 Helpers may not modify jobs.dispute_resolved_at`
     * — reproduced against production job 67e8ccfe-fa63-45ca-87c3-b231cb46bc73
     * inside a rolled-back subtransaction. The poster's card meanwhile told the
     * poster "Your Helpr opened this, so only they can withdraw it", which was
     * true of the design and false of the running system.
     *
     * The fix is a flag, not a list entry, and this asserts BOTH halves —
     * because "fixing" it by adding the column to `allowed` would let any
     * helper stamp their own job resolved with a plain PATCH, skipping the
     * opener check that is the entire point of the RPC.
     */
    it("keeps the dispute-resolved stamp out of the list and behind its RPC flag", () => {
      expect(
        allowed,
        "jobs.dispute_resolved_at is on the helper allow-list. A helper can now stamp " +
          "their own job resolved with a direct PATCH, without passing " +
          "rpc_withdraw_dispute's opener check.",
      ).not.toContain("dispute_resolved_at");
      expect(
        guard,
        "enforce_helper_jobs_column_whitelist no longer reads app.dispute_withdraw_rpc. " +
          "rpc_withdraw_dispute sets that flag specifically to stamp " +
          "jobs.dispute_resolved_at; without it, a helper who opened a dispute can " +
          "never withdraw it and their only exit is an admin.",
      ).toContain("app.dispute_withdraw_rpc");
    });

    it("the withdrawal RPC still SETS that flag, and still restores a real status", () => {
      const rpc = liveDefinition("rpc_withdraw_dispute");
      expect(
        rpc,
        "rpc_withdraw_dispute stopped setting app.dispute_withdraw_rpc — the exemption " +
          "above silently stops applying and the helper's Withdraw button dies again, " +
          "with the guard still looking correct.",
      ).toContain("app.dispute_withdraw_rpc");
      // And it must not go back to a hardcoded status. `status = 'in_progress'`
      // on a job the poster had already approved moved it out of
      // process-scheduled-payouts' filter (`status = 'completed'`) and stranded
      // the escrow with nothing scheduled to release it.
      expect(
        /SET\s+status\s*=\s*'in_progress'/i.test(rpc),
        "rpc_withdraw_dispute writes a hardcoded status again. A dispute filed AFTER " +
          "poster approval must be withdrawn back to 'completed'/payout_pending, or the " +
          "payout batch can never see the job.",
      ).toBe(false);
      expect(rpc).toMatch(/poster_completed_at|payout_scheduled_at/);
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

/**
 * THE THIRD INSTANCE OF THE SAME BUG — found 2026-09-06, this time on
 * `public.disputes` rather than `public.jobs`.
 *
 * `rpc_withdraw_dispute` closes a dispute with
 *
 *     UPDATE public.disputes SET status = 'withdrawn', decided_at = now()
 *
 * and `enforce_dispute_opener_column_whitelist` pinned `decided_at` to its old
 * value for every non-admin caller. The RPC is SECURITY DEFINER, but
 * `auth.uid()` inside it is still the CALLER — the exact property the file
 * header above says buys you nothing — so the trigger raised
 * `only the evidence on a dispute may be changed` (42501) before it ever
 * reached the `status` carve-out written two lines below for this very RPC.
 * The poster's "Resolve & Pay" chip, which closes a dispute and releases
 * escrow, therefore failed 100% of the time from 20260901032007 until
 * 20260907034644. Reproduced in PGlite with all three bodies copied verbatim
 * from production; fixed and re-proven the same way.
 *
 * What makes it worth its own block: the migration that introduced the pin
 * ALMOST caught it. Its comment records that the PGlite suite proved a blanket
 * pin on `status` would break the withdrawal — so the carve-out was written for
 * `status` and stopped there, while the same UPDATE statement writes a second
 * column nobody drove. Reading either file alone shows nothing wrong.
 *
 * So this does not check `decided_at`. It derives the column list FROM THE
 * RPC's own UPDATE and requires the guard to have a carve-out for each one,
 * which is what makes it catch the next column added to that statement rather
 * than the last one that broke.
 */
describe("dispute opener whitelist ↔ rpc_withdraw_dispute", () => {
  const guard = liveDefinition("enforce_dispute_opener_column_whitelist");
  const rpc = liveDefinition("rpc_withdraw_dispute");

  /**
   * Columns `rpc_withdraw_dispute`'s `UPDATE public.disputes SET …` writes.
   *
   * SLICE THE FUNCTION BODY OUT FIRST. `liveDefinition` returns a whole
   * migration FILE, and 20260825190000 — the newest one defining this RPC —
   * also defines `rpc_open_dispute`, whose existing-dispute branch carries its
   * own `UPDATE public.disputes SET evidence_urls = …`. Searching the file
   * found that one instead, and `evidence_urls` is the single column the guard
   * has always allowed, so the check below passed on the BROKEN trigger. Caught
   * by running these assertions against the pre-fix definition; a test that
   * cannot fail on the bug it was written for is worse than no test.
   */
  function disputeColumnsWritten(src: string): string[] {
    const start = src.search(/CREATE OR REPLACE FUNCTION public\.rpc_withdraw_dispute\b/i);
    expect(
      start,
      "no `CREATE OR REPLACE FUNCTION public.rpc_withdraw_dispute` in the migration that " +
        "defines it — re-read the file before trusting this test.",
    ).toBeGreaterThan(-1);
    // plpgsql bodies here are `$function$ … $function$`; take the first pair
    // after the header so a later function in the same file cannot bleed in.
    const rest = src.slice(start);
    const bodyMatch = rest.match(/\$function\$([\s\S]*?)\$function\$/);
    expect(bodyMatch, "could not delimit rpc_withdraw_dispute's body").toBeTruthy();
    const body = bodyMatch![1];

    const m = body.match(/UPDATE\s+public\.disputes\s+SET\s+([\s\S]*?)\s+WHERE/i);
    expect(
      m,
      "rpc_withdraw_dispute no longer contains an `UPDATE public.disputes SET … WHERE`. " +
        "It was restructured — re-read it before trusting this test, do not delete the check.",
    ).toBeTruthy();
    const cols = [...m![1].matchAll(/(\w+)\s*=/g)].map((x) => x[1]);

    // The parse must see the status flip. If it does not, it has locked onto
    // some other statement and every assertion below is meaningless — which is
    // precisely how this helper first went green against the broken trigger.
    expect(
      cols,
      `parsed ${JSON.stringify(cols)} out of rpc_withdraw_dispute's UPDATE, which does ` +
        `not include the open -> withdrawn flip. The parse is wrong, not the guard.`,
    ).toContain("status");
    return cols;
  }

  it("permits every column the withdrawal writes", () => {
    for (const col of disputeColumnsWritten(rpc)) {
      // A column is PINNED when the guard compares NEW.<col> to OLD.<col> with
      // nothing qualifying it. A bare comparison is a hard refusal; one carrying
      // an `AND NOT <carve-out>` is conditional and therefore survivable.
      const bare = new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM\\s+OLD\\.${col}\\s*(?:\\r?\\n|$)`, "i");
      const carved = new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM\\s+OLD\\.${col}\\s+AND NOT`, "i");
      const pinnedOutright = bare.test(guard) && !carved.test(guard);
      expect(
        pinnedOutright,
        `enforce_dispute_opener_column_whitelist pins disputes.${col} unconditionally, ` +
          `but rpc_withdraw_dispute writes it in the same statement that flips the ` +
          `status. Every call raises 42501 "only the evidence on a dispute may be ` +
          `changed" and the poster's Resolve & Pay chip is a dead button — the ` +
          `2026-09-06 bug, exactly.`,
      ).toBe(false);
    }
  });

  it("carves out the withdrawal narrowly — opener only, first stamp only", () => {
    // The fix must not be "stop pinning decided_at". The carve-out is what
    // keeps a party from stamping a settlement timestamp in any other context,
    // and from re-stamping a row that already carries one.
    expect(
      guard,
      "the decided_at carve-out no longer requires the caller to be the opener — " +
        "the counterparty can now stamp a settlement timestamp.",
    ).toMatch(/_uid\s*=\s*OLD\.opener_id/);
    expect(
      guard,
      "the decided_at carve-out no longer requires the old value to be NULL — an " +
        "already-decided dispute can be re-stamped.",
    ).toMatch(/OLD\.decided_at IS NULL/);
    expect(
      guard,
      "the carve-out is no longer tied to the open -> withdrawn transition.",
    ).toMatch(/NEW\.status\s*=\s*'withdrawn'/);
  });

  it("still refuses the settlement columns outright", () => {
    // The forgeries the trigger was written for. Each must remain a BARE pin —
    // if one of these ever grows an `AND NOT`, that is a carve-out on the
    // denial-of-service path and needs justifying, not passing quietly.
    for (const col of ["decided_by", "decision_text", "payout_split", "opener_id", "reason"]) {
      const bare = new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM\\s+OLD\\.${col}\\s*(?:\\r?\\n|$)`, "i");
      expect(
        bare.test(guard),
        `disputes.${col} is no longer pinned outright. A party could forge it, which ` +
          `is what enforce_dispute_opener_column_whitelist exists to stop.`,
      ).toBe(true);
    }
    expect(guard, "the execution ledger guard is gone").toContain("execution_status");
  });

  it("the RPC still refuses a non-opener, which is the other half of the gate", () => {
    // If this ever relaxes, the trigger's opener-scoped carve-out becomes the
    // only thing standing between the counterparty and a settlement stamp.
    expect(rpc).toMatch(/_opener\s+IS DISTINCT FROM\s+_uid/i);
  });
});
