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

// VACUITY REGISTRATION (2026-09-19). This file was grandfathered into
// src/test/vacuity.baseline.json as "declares no mutation"; the two mutations
// below take it off that list, and the baseline entry goes with them — it may
// only shrink. Each breaks one side of a parity this file claims to hold:
//
//   1. the tracker's Confirmed step back to being derived from jobs.status,
//      which is the prod-bb2c3732 bug this describe block was added for;
//   2. the "I'm On My Way" gate back to being POSITIONAL (job_confirmed only),
//      which is what let that derivation route around it.
//
// @mutate src/components/JobTracking.tsx | "revision_requested") {\n    atLeast(STATUS_IDX.assigned) | "revision_requested") {\n    atLeast(STATUS_IDX.job_confirmed)
// @mutate src/components/JobTracking.tsx | (nextStatus.key === "job_confirmed" \|\| nextStatus.key === "on_the_way") | (nextStatus.key === "job_confirmed")

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

/**
 * The newest migration text that (re)defines a TRIGGER by name. A trigger and
 * the function it calls need not live in the same migration: 20260915101102
 * rebuilds enforce_helper_completion_gates' BODY (the NULL-uid trust swap) with
 * a plain CREATE OR REPLACE FUNCTION and does not touch the trigger, which
 * 20260915044137 last (re)created on (helper_completed_at, status). Pinning the
 * trigger to liveDefinition()'s file would go blind the moment a later migration
 * rewrites only the function — so search the whole ledger for the trigger.
 */
function liveTriggerSql(triggerName: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const defining = files.filter((f) =>
    readFileSync(resolve(MIGRATIONS, f), "utf8").includes(`TRIGGER ${triggerName}`),
  );
  expect(
    defining.length,
    `No migration defines trigger ${triggerName}. If it was renamed, point this test at the new name — do not delete the check.`,
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

    it("keeps helper_arrived_at out of the list too — only the arrival RPC writes it", () => {
      // While it was on the list, a helper 2000 miles away could mark
      // themselves arrived with a plain PATCH and no location at all. That is
      // STILL not allowed after the 2026-09-19 reversal: the RPC now records a
      // far or fix-less arrival, but it records the DISTANCE with it, and only
      // it may stamp the verification. A direct PATCH would launder a claim
      // into a row with no measurement at all.
      expect(
        allowed,
        "jobs.helper_arrived_at is on the helper allow-list again. A helper can mark " +
          "themselves arrived with a direct PATCH, bypassing mark_helper_arrival's " +
          "server-side distance measurement entirely.",
      ).not.toContain("helper_arrived_at");
      expect(guard).toMatch(/'helper_arrival_verified_at',\s*'helper_arrived_at'/);
    });

    /**
     * THE OWNER'S 2026-09-19 REVERSAL, PINNED IN SQL.
     *
     * VN-33 (2026-09-14) made arrival take GPS **AND** the poster's confirm,
     * and enforced the GPS half by having `mark_helper_arrival` REFUSE a far or
     * fix-less arrival and write NOTHING. `helper_arrived_at` therefore stayed
     * NULL — and the poster's "Confirm They Arrived" control renders only once
     * that stamp exists, so the poster was never offered the tap the Helpr's
     * own blocked CTA was telling them to go ask for. Deadlock.
     *
     * OWNER, 2026-09-19 (verbatim): "if gps is not on, they can mark themselves
     * as arrived but can not move on until the poster marks them arrived … but
     * even if gps does confirm they are there the poster still needs ro cfnrm
     * wither way".
     *
     * These assertions exist because the reversal is only safe as a PAIR: the
     * RPC must record, AND the gates must read one stamp. Shipping either half
     * alone is a bug — record-without-regating leaves the old GPS gate on a
     * Helpr who can now check in but never work; regate-without-recording
     * leaves the poster with no control to tap.
     */
    it("mark_helper_arrival RECORDS every arrival instead of refusing it", () => {
      const rpc = liveDefinition("mark_helper_arrival");
      for (const code of ["arrival_too_far", "arrival_location_required", "arrival_location_invalid"]) {
        expect(
          rpc,
          `mark_helper_arrival raises '${code}' again. A refusal writes nothing, so ` +
            `helper_arrived_at stays NULL, the poster's "Confirm They Arrived" control ` +
            `never renders, and the job deadlocks — the exact bug the owner reversed on ` +
            `2026-09-19.`,
        ).not.toMatch(new RegExp(`RAISE EXCEPTION '${code}'`));
      }
      // The claim is stamped on every path…
      expect(
        rpc,
        "mark_helper_arrival no longer stamps helper_arrived_at unconditionally.",
      ).toMatch(/helper_arrived_at\s*=\s*COALESCE\(helper_arrived_at, v_now\)/);
      // …but the VERIFICATION is still conditional on the server's own verdict,
      // and a later claim can never clear or move it.
      expect(
        rpc,
        "helper_arrival_verified_at is no longer conditional on v_verified — a Helpr " +
          "with Location off would now be recorded as GPS-verified.",
      ).toMatch(/helper_arrival_verified_at\s*=\s*CASE\s+WHEN v_verified THEN COALESCE\(helper_arrival_verified_at, v_now\)/);
      // The 500ft measurement itself is still done server-side.
      expect(rpc, "the server no longer measures the distance at all").toMatch(/v_dist <= 500/);
      // And the verdict tells the Helpr the poster is still owed.
      expect(rpc).toMatch(/poster_confirmation_required/);
    });

    it("gates helper completion on the poster's confirmation ALONE (owner, 2026-09-19)", () => {
      const gates = liveDefinition("enforce_helper_completion_gates");
      expect(
        gates,
        "enforce_helper_completion_gates still reads a GPS stamp. The tracker's Working " +
          "step no longer does, so a Helpr with Location off is waved into the work and " +
          "then refused payment for a stamp nobody can produce.",
      ).toMatch(/IF OLD\.poster_confirmed_arrival_at IS NULL THEN/);
      expect(
        gates,
        "the superseded VN-33 predicate (GPS or near miss, AND poster) is back in the " +
          "completion gate.",
      ).not.toMatch(/OLD\.helper_arrival_verified_at IS NULL AND OLD\.helper_arrival_near_miss_at IS NULL/);
      expect(gates, "the pre-2026-08-28 grandfather clause is back").not.toMatch(/timestamptz '2026-08-28/);
    });

    it("gates the tracker's Working step on the same one stamp", () => {
      const tracker = liveDefinition("enforce_job_tracking_arrival_gate");
      const working = tracker.match(/IF NEW\.status = 'working'[\s\S]*?END IF;/);
      expect(working, "the 'working' branch of enforce_job_tracking_arrival_gate is gone").toBeTruthy();
      expect(
        working![0],
        "the Working step reads a GPS stamp again — the owner's rule is the poster's " +
          "confirmation, GPS or no GPS.",
      ).not.toMatch(/helper_arrival_verified_at|helper_arrival_near_miss_at/);
      expect(working![0]).toMatch(/v_job\.poster_confirmed_arrival_at IS NULL/);
      // A claim alone still has to exist before the tracker can say 'arrived'.
      expect(tracker).toMatch(/NEW\.status = 'arrived' AND v_job\.helper_arrived_at IS NULL/);
    });

    it("rpc_helper_mark_done's pre-check matches the trigger it mirrors", () => {
      // The pre-check and the trigger drifted before: the RPC never learned
      // about VN-33(b)'s near-miss stand-in, so a bad-pin arrival the trigger
      // accepted was refused here. One predicate on both sides removes the
      // whole class — so assert they are the SAME predicate, not just that each
      // is present.
      const rpc = liveDefinition("rpc_helper_mark_done");
      expect(rpc).toMatch(/v_job\.poster_confirmed_arrival_at IS NULL/);
      expect(
        rpc,
        "rpc_helper_mark_done reads a GPS stamp the completion trigger does not, so it " +
          "refuses completions the database would have allowed.",
      ).not.toMatch(/v_job\.helper_arrival_verified_at IS NULL/);
    });

    it("the app's shared predicate agrees with the database", async () => {
      // The app, create-payment and the two triggers must not be able to
      // disagree about what "arrived" means. This is the TS half of the same
      // rule; jobsGuardRpcParity owns the SQL half above.
      const { arrivalEstablished } = await import("../../supabase/functions/_shared/arrivalRule");
      const T = "2026-09-19T10:00:00Z";
      expect(arrivalEstablished({ poster_confirmed_arrival_at: T })).toBe(true);
      expect(arrivalEstablished({ helper_arrived_at: T, helper_arrival_verified_at: T })).toBe(false);
      expect(arrivalEstablished({ helper_arrived_at: T, helper_arrival_near_miss_at: T })).toBe(false);
    });

    it("closes the side doors the VN-33 review found", () => {
      const gates = liveDefinition("enforce_helper_completion_gates");
      // A helper's direct status = 'completed' is a completion too.
      expect(gates).toMatch(/NEW\.status::text = 'completed'/);
      // The trigger lives in whichever migration last (re)created it, which is
      // NOT necessarily the one that last rewrote the function body.
      expect(liveTriggerSql("trg_helper_completion_gates")).toMatch(/BEFORE UPDATE OF helper_completed_at, status ON public\.jobs/);
      // The poster cannot write the GPS half.
      const posterLock = sqlArrayLiteral(liveDefinition("enforce_poster_jobs_money_lock"), "locked_always");
      expect(posterLock).toEqual(expect.arrayContaining(["helper_arrived_at", "helper_arrival_verified_at"]));
      // The tracker row must belong to the job's helper.
      expect(liveDefinition("enforce_job_tracking_arrival_gate")).toMatch(/v_job\.helper_id IS DISTINCT FROM NEW\.helper_id/);
      // No no-show report once the helper has arrived (the reopen would erase the proof).
      expect(liveDefinition("report_helper_no_show")).toMatch(/RAISE EXCEPTION 'helper_already_arrived'/);
      // A helper cannot complete a job by writing its status.
      expect(gates).toMatch(/RAISE EXCEPTION 'helper_cannot_complete_by_status'/);
      // A re-awarded job starts with no arrival.
      expect(liveDefinition("enforce_jobs_arrival_integrity")).toMatch(/NEW\.helper_arrival_verified_at := NULL/);
    });
  });

  /**
   * THE TRACKER'S "I'M ON MY WAY" CTA ↔ `helper_mark_on_the_way`.
   *
   * THE BUG, FOUND LIVE (owner, 2026-09-19). Prod job bb2c3732: `in_progress`
   * with `helper_confirmed_at`, `poster_confirmed_at` and
   * `helper_dayof_confirmed_at` all NULL. The tracker painted the Confirmed
   * step complete (off `jobs.status`, not off any stamp) and offered "I'm On
   * My Way" — and the server refused the tap with `helper_not_confirmed`.
   *
   * This predicate was NOT covered here, which is why the drift was invisible:
   * the client gate existed and was right, but nothing pinned it to the
   * server's, and nothing noticed when the derivation routed around it.
   */
  describe("tracker CTA ↔ helper_mark_on_the_way", () => {
    const rpc = liveDefinition("helper_mark_on_the_way");
    const tracker = readFileSync(resolve(ROOT, "src/components/JobTracking.tsx"), "utf8");

    it("the server's floor is `helper_confirmed_at`, and nothing else about confirmation", () => {
      // Verified live on prod fncmgoasalhdgfwzhsqa, 2026-09-19, via
      // pg_get_functiondef — this asserts the migration still says the same.
      expect(
        rpc,
        "helper_mark_on_the_way no longer refuses on helper_confirmed_at. If the floor moved, " +
          "move the client gate with it — a client that is stricter traps a helper the server " +
          "would have started, and one that is looser ships a button the server refuses.",
      ).toMatch(/IF v_job\.helper_confirmed_at IS NULL THEN\s*\n\s*RAISE EXCEPTION 'helper_not_confirmed'/);
      // The poster's confirmation is deliberately NOT a gate here (owner,
      // 2026-08-24: a poster who never confirms must not block the helper).
      expect(
        rpc.slice(rpc.indexOf("FUNCTION public.helper_mark_on_the_way")),
        "the RPC started reading poster_confirmed_at — the client does not, so they now disagree.",
      ).not.toMatch(/v_job\.poster_confirmed_at IS NULL/);
    });

    it("the client reads the SAME column, and withholds the step by NAME", () => {
      expect(
        tracker,
        "JobTracking's on-the-way gate no longer reads helperConfirmedAt.",
      ).toMatch(/const helperHasConfirmed = !!helperConfirmedAt;/);
      // BY NAME, not by position. The gate used to live inside the
      // `job_confirmed` branch of the next-step CTA, so a rail that arrived at
      // `on_the_way` by any other route skipped it entirely — which is exactly
      // what the status-derived Confirmed floor did.
      expect(
        tracker,
        'the "I\'m On My Way" step is no longer withheld by step key. A positional gate is ' +
          "skippable by any change to deriveCurrentStatusIdx — that is how bb2c3732 shipped.",
      ).toMatch(/!helperHasConfirmed && \(nextStatus\.key === "job_confirmed" \|\| nextStatus\.key === "on_the_way"\)/);
    });

    it("the rail's Confirmed step is derived from stamps, never from jobs.status", () => {
      const derive = tracker.slice(
        tracker.indexOf("export function deriveCurrentStatusIdx"),
        tracker.indexOf("Floor at 0: the tracker always shows at least"),
      );
      expect(derive.length, "deriveCurrentStatusIdx was restructured — re-read it").toBeGreaterThan(200);
      const statusFloor = derive.match(
        /if \(jobStatus === "in_progress" \|\| jobStatus === "revision_requested"\) \{\s*\n\s*atLeast\(STATUS_IDX\.(\w+)\)/,
      );
      expect(statusFloor, "the in_progress floor is gone or reshaped — re-read the derivation").toBeTruthy();
      expect(
        statusFloor![1],
        "jobs.status is being read as a confirmation again. `in_progress` evidences that somebody " +
          "is assigned and the job is underway — the Offered step. It evidences no confirmation, " +
          "and painting Confirmed off it is what offered the refused button on bb2c3732.",
      ).toBe("assigned");
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
