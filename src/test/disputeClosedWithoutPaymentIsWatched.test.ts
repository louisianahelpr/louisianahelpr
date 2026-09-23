/*
 * CLASS GUARD: a money-owing state that no automatic path will act on must be
 * WATCHED, and the watcher's premise must stay true.
 *
 * The defect (measured on prod 2026-09-22): `auto-resolve-disputes` stamps
 * `disputes.execution_status = 'executed'` having moved zero cents — deliberately,
 * because `closeDisputeRecord()` passes `_helper_cents: null, _transfer_id: null`
 * and a fabricated $0 "would be a claim about money that is simply false". After
 * that, BOTH automatic doors are shut by DIFFERENT rules, and nothing was told:
 *
 *   process-scheduled-payouts  `.is("disputed_at", null)`         -> excluded
 *   claim_dispute_settlement   `execution_status IS DISTINCT      -> excluded
 *                               FROM 'executed'`
 *
 * Dispute 9756a585 / job e6979a12 sat `payout_pending` from 2026-09-16 with the
 * Helpr owed 100% and every execution_* money field NULL.
 *
 * WHY A DRIFT GUARD AND NOT A ROW ASSERTION. The sweep is only correct while
 * those two gates still shut. If someone widens either one — drops the
 * `disputed_at` filter, or lets `claim_dispute_settlement` re-run on an
 * 'executed' row — then the automatic door reopens, the sweep's alert text
 * ("neither ... will ever pay it") becomes a false statement, and it starts
 * paging about a state that now resolves itself. A detector that keeps firing
 * about something already fixed is how a detector gets muted. So this test
 * pins the sweep TO ITS PREMISE, in the sources that own it.
 *
 * Every string below was read out of the live database or the deployed source
 * on 2026-09-22, not inferred:
 *   `pg_get_functiondef(claim_dispute_settlement)` -> the IS DISTINCT FROM gate
 *   process-scheduled-payouts/index.ts:82          -> the .is("disputed_at") gate
 *   auto-resolve-disputes/index.ts:232,234,752,754 -> the two null-cents sites
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The migration that owns the sweep — found by content, not by filename. */
const sweepSql = (() => {
  const dir = join(root, "supabase", "migrations");
  // The LAST definition wins on replay, and that is the one prod runs.
  // This asserted "exactly one migration" until 2026-09-22, which was wrong in
  // a way that only showed when the function was legitimately replaced:
  // 20260922224023 added the `FOR SHARE OF j` row lock the race-class guard
  // requires, and a correct follow-up migration broke the test. A CREATE OR
  // REPLACE chain is the normal way this schema evolves; pinning the count
  // forbids fixing the thing it guards.
  const hits = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, body: readFileSync(join(dir, f), "utf8") }))
    .filter(({ body }) => body.includes("FUNCTION public.sweep_disputes_closed_without_payment"));
  expect(hits.length, "the sweep must be defined somewhere").toBeGreaterThan(0);
  return hits[hits.length - 1].body;
})();

/**
 * The EXECUTABLE body only, between the $fn$ delimiters.
 *
 * The prose above it says "No `net.http_post` of its own" — and the first draft
 * of the detection-only test read that sentence as evidence of the thing it
 * denies. Same trap as trusting a comment beside a CSS declaration: a claim
 * about the code is not the code. Assertions about what the sweep DOES run
 * against this; assertions about the predicate's shape may use the file, since
 * the predicate is unambiguous there.
 */
const sweepBody = (() => {
  const m = sweepSql.match(/AS \$fn\$([\s\S]*?)\$fn\$;/);
  expect(m, "the sweep body must be delimited by $fn$").not.toBeNull();
  return m![1];
})();

describe("a dispute closed without moving money is watched", () => {
  it("the sweep exists, is scheduled, and is not callable by a client", () => {
    // SETUP lives in whichever migration performs it, which is NOT necessarily
    // the one holding the newest body: 20260922224023 replaced the function to
    // add a row lock and does not re-schedule the cron. Asserting all of this
    // against the latest definition made a correct follow-up migration fail.
    const dir = join(root, "supabase", "migrations");
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((b) => b.includes("sweep_disputes_closed_without_payment"));
    expect(all.length, "the sweep must be defined somewhere").toBeGreaterThan(0);
    const anywhere = all.join("\n");

    expect(sweepSql).toContain("CREATE OR REPLACE FUNCTION public.sweep_disputes_closed_without_payment");
    expect(anywhere).toMatch(/cron\.schedule\('sweep-disputes-unsettled'/);
    // Money-shaped state: anon and authenticated have no business reading it.
    expect(anywhere).toMatch(/REVOKE ALL ON FUNCTION public\.sweep_disputes_closed_without_payment\(\)\s*FROM PUBLIC, anon, authenticated;/);
    // A watcher nobody watches is the gap this closes.
    expect(anywhere).toContain("'sweep-disputes-unsettled', interval");
  });

  it("PREMISE 1: process-scheduled-payouts still excludes disputed jobs", () => {
    // CODE only: the same text sits in a comment further down (line ~148), and a
    // plain toContain() passed with the real filter deleted — vacuity showed
    // this guard SURVIVING its own mutation (2026-09-23).
    const src = read("supabase/functions/process-scheduled-payouts/index.ts")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(
      src,
      "The sweep's message says process-scheduled-payouts will never pay a disputed job. " +
        "If this gate is gone, the automatic door has REOPENED: re-check whether the sweep " +
        "is still describing a real strand before changing this test.",
    ).toContain('.is("disputed_at", null)');
  });

  it("PREMISE 2: claim_dispute_settlement still refuses an 'executed' dispute", () => {
    const dir = join(root, "supabase", "migrations");
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((b) => b.includes("FUNCTION public.claim_dispute_settlement"));
    expect(defs.length, "claim_dispute_settlement must be defined somewhere").toBeGreaterThan(0);
    // The LAST definition wins on replay, which is the one prod runs.
    expect(
      defs[defs.length - 1],
      "The sweep's message says claim_dispute_settlement will never pay it. If this gate " +
        "is gone, that sentence is false and the sweep would page about a self-resolving state.",
    ).toContain("execution_status IS DISTINCT FROM 'executed'");
  });

  it("PREMISE 3: auto-resolve-disputes still closes the record with NO cents", () => {
    const src = read("supabase/functions/auto-resolve-disputes/index.ts");
    // This is what CREATES the watched state. If it ever starts recording a
    // real transfer, the state stops occurring and the sweep goes quiet on its
    // own — but silently dropping these would mean it now moves money by some
    // other route, which must be read before this test is relaxed.
    expect(src).toContain("_helper_cents: null");
    expect(src).toContain("_transfer_id: null");
  });

  it("does NOT key on the transfer id alone — that false-positives on every refund", () => {
    // Prod 2026-09-22 had TWO 'executed' disputes with a NULL transfer id, and
    // only one was owed anything: 28c4943d was a poster-100% decision settled by
    // refund re_3UH3JZKp2H4b7tEC14591UJd (2689 cents). A poster-100% split moves
    // money by REFUND, not by Connect transfer, so a NULL transfer id is the
    // ORDINARY case there. Keying on it would page on the most common outcome
    // there is — which is how an alert gets muted and stops being read.
    for (const required of [
      "execution_refund_id   IS NULL",
      "COALESCE(d.execution_helper_cents, 0) = 0",
      "COALESCE(d.execution_refund_cents, 0) = 0",
    ]) {
      expect(sweepSql, `the predicate must also require: ${required}`).toContain(required);
    }
    // A FAILED split is already a visible state with its own message; re-reporting
    // it here would duplicate it under a wrong name.
    expect(sweepSql).toContain("d.execution_error IS NULL");
    // And the funds must still be held — a refunded or paid job is settled.
    expect(sweepSql).toContain("j.payment_status IN ('escrow', 'payout_pending')");
  });

  it("reports each dispute ONCE (identity dedupe, not a time window)", () => {
    // 20260914183932 records what a looping alert costs: 616 rows in three days.
    // Hourly x forever on one unfixed row would repeat that more slowly.
    expect(sweepSql).toContain("e.context ->> 'dispute_id' = d.id::text");
    expect(sweepSql).toContain("e.tags ->> 'area' = 'dispute-unsettled'");
  });

  it("real money pages; a seed fixture goes to the digest — under DIFFERENT sources", () => {
    expect(sweepSql).toContain("CASE WHEN r.is_seed THEN 'error' ELSE 'fatal' END");
    // Separate tags.source per severity. trg_error_logs_slack suppresses a post
    // when another row with the SAME source was written in the last 10 minutes,
    // so a shared source would let a seed row silence a real page written by the
    // very same sweep — the bug 20260922155258 records and avoids.
    expect(sweepSql).toContain("'dispute-unsettled-seed'");
    expect(sweepSql).toMatch(/ELSE 'dispute-unsettled' END/);
  });

  it("is DETECTION ONLY — it must never move money itself", () => {
    // A sweep that paid out on its own would be a worse thing to have written
    // than the gap it closes. Releasing a held payout is an admin decision.
    for (const forbidden of ["net.http_post", "UPDATE public.jobs", "UPDATE public.disputes", "stripe"]) {
      expect(
        sweepBody.toLowerCase(),
        `the sweep must not contain "${forbidden}" — it reports, it does not settle`,
      ).not.toContain(forbidden.toLowerCase());
    }
  });
});

// Proof this is able to fail. Each mutation breaks a different premise:
// @mutate supabase/functions/process-scheduled-payouts/index.ts | .is("disputed_at", null)          // defense-in-depth | .is("disputed_at2", null)          // defense-in-depth
// @mutate supabase/migrations/20260922224023_dispute_sweep_locks_the_job_row_it_judges.sql | AND d.execution_refund_id   IS NULL | AND true
