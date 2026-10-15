/**
 * Q1491 (lh-money-escrow review of Q1417, finding #2): a gift-card difference
 * payment whose gift was not there any more paged "job underfunded" but still
 * put the job in escrow, and nothing stopped a payout: the Helpr could be paid
 * the full budget from the platform balance before anyone reconciled. Now
 * stripe-webhook places a JOB payout hold (public.job_payout_holds) and
 * refuse_payout_claim_while_held refuses every payout claim on a held job
 * (20261015022636_job_payout_hold.sql); the paths that transfer before writing
 * their ledger row (Quick Release, the dispute split) and release-payout ask
 * checkJobPayoutHold first. Behaviour: src/test/pglite/jobPayoutHold.pglite.mjs
 * (live: FAILS; migration 3x: ALL PASS), src/test/edge/payoutHold.test.ts and
 * the stripe-webhook edge cases.
 *
 * Rebuilt 2026-10-15 on main from the 4-round reviewed build on
 * wip/stranded-1013-money-holds @ 47247f33d (lane B, 2026-10-12), Q1491 half
 * only (its Q1490 half reached main another way, 709b04e9e).
 *
 * @mutate supabase/migrations/20261015022636_job_payout_hold.sql |     IF EXISTS (SELECT 1 FROM public.job_payout_holds jh WHERE jh.job_id = NEW.job_id) THEN | IF false THEN
 * @mutate supabase/migrations/20261015022636_job_payout_hold.sql | ALTER TABLE public.job_payout_holds ENABLE ROW LEVEL SECURITY; | SELECT 1;
 * @mutate supabase/functions/execute-dispute-split/index.ts |     const jobHold = await checkJobPayoutHold(supabaseAdmin, job.id); |     const jobHold = { kind: "clear" as const };
 * @mutate supabase/functions/create-payment/index.ts |   const jobHold = await checkJobPayoutHold(supabaseAdmin, jobId); |   const jobHold = { kind: "clear" as const };
 * @mutate supabase/functions/_shared/crewBlockFees.ts |     jobHold ??= await checkJobPayoutHold(admin, job.id); |     jobHold ??= { kind: "clear" as const };
 * @mutate supabase/functions/execute-dispute-split/index.ts |       await markFailed(supabaseAdmin, disputeId, PAYOUT_JOB_HOLD_SPLIT_ERROR, | await markFailed(supabaseAdmin, disputeId, PAYOUT_HOLD_SPLIT_ERROR,
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));

describe("Q1491: a job payout hold stops every payout claim on the job", () => {
  it("the claim trigger refuses a held job, in its pending-claim branch", () => {
    const b = blankSqlComments(defs.get("refuse_payout_claim_while_held")?.stmt ?? "");
    const pending = b.search(/IF NEW\.status = 'pending' AND NEW\.stripe_transfer_id IS NULL THEN/);
    const hold = b.search(/EXISTS \(SELECT 1 FROM public\.job_payout_holds jh WHERE jh\.job_id = NEW\.job_id\) THEN\s+RAISE EXCEPTION 'payout_held'/);
    expect(pending).toBeGreaterThan(-1);
    expect(hold).toBeGreaterThan(pending);
  });

  it("the hold table is server-only and the release is admin-only", () => {
    const mig = blankSqlComments(read(`supabase/migrations/${defs.get("admin_release_job_payout_hold")!.file}`));
    expect(mig).toMatch(/ALTER TABLE public\.job_payout_holds ENABLE ROW LEVEL SECURITY;/);
    expect(mig).toMatch(/REVOKE ALL ON TABLE public\.job_payout_holds FROM PUBLIC, anon, authenticated;/);
    expect(mig).not.toMatch(/CREATE POLICY[^;]*job_payout_holds/i);
    expect(blankSqlComments(defs.get("admin_release_job_payout_hold")!.stmt)).toMatch(/IF NOT \(public\.is_server_context\(\)\s+OR \(v_uid IS NOT NULL AND COALESCE\(public\.has_role\(v_uid, 'admin'::public\.app_role\), false\)\)\) THEN/);
  });

  it("stripe-webhook places the hold in the underfunded branch and fails closed when it cannot", () => {
    const src = blankComments(read("supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts"));
    const hold = src.search(/\.from\("job_payout_holds"\)\s*\.upsert\(/);
    const page = src.search(/title: "Gift card difference payment — job underfunded",/);
    expect(hold).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(hold);
    expect(src.slice(hold, page)).toMatch(/throw new Error\(`job_payout_holds insert failed/);
  });
});

/**
 * THE CLASS (lh-money-escrow review of the first cut): the claim trigger only
 * stops paths that INSERT a pending payout_transfers row before the transfer.
 * Inventory, from source: every file under supabase/functions that calls
 * stripe.transfers.create. Each one either asks checkJobPayoutHold, takes a
 * payout claim (claimPayout, which the trigger refuses on a held job), or is
 * listed here with why a job hold does not apply. Exact, two-way.
 */
const TRANSFERS_THAT_ARE_NOT_A_JOB_PAYOUT: Record<string, string> = {
  "supabase/functions/instant-payout/index.ts": "pays out the Helpr's own Stripe balance, money already theirs; no job escrow",
  "supabase/functions/cash-out-credits/index.ts": "pays out referral credit; no job escrow",
  "supabase/functions/void-cancelled-payments/index.ts": "cancellation fees on a cancelled job, withheld from the poster's own captured charge (source_transaction), never the budget",
  "supabase/functions/_shared/chargebackClawback.ts": "repays a clawback the platform reversed from this Helpr earlier; returns their own money",
  "supabase/functions/_shared/heldTipRepay.ts": "repays a held tip, the poster's separate tip charge, not job escrow",
};

describe("Q1491: every transfer that pays a Helpr for a job honours a job payout hold", () => {
  const root = join(ROOT, "supabase/functions");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name)) files.push(f);
    }
  };
  walk(root);
  const transferring = files
    .map((f) => ({ rel: f.slice(ROOT.length + 1), code: blankComments(readFileSync(f, "utf8")) }))
    .filter((x) => /stripe\.transfers\.create\(/.test(x.code));

  it("finds the transfer sites (inventory floor)", () => {
    expect(transferring.length).toBeGreaterThan(8);
  });

  it("each asks checkJobPayoutHold, takes a payout claim, or is a listed non-payout transfer (exact)", () => {
    const unhandled = transferring
      .filter((x) => !/checkJobPayoutHold\(/.test(x.code) && !/claimPayout\(/.test(x.code))
      .map((x) => x.rel)
      .sort();
    expect(unhandled).toEqual(Object.keys(TRANSFERS_THAT_ARE_NOT_A_JOB_PAYOUT).sort());
  });

  it("per call, not per file: a payout file has a hold check or claim for every transfer it makes", () => {
    const short = transferring
      .filter((x) => !(x.rel in TRANSFERS_THAT_ARE_NOT_A_JOB_PAYOUT))
      .map((x) => ({
        rel: x.rel,
        transfers: (x.code.match(/stripe\.transfers\.create\(/g) ?? []).length,
        gates: (x.code.match(/checkJobPayoutHold\(|claimPayout\(/g) ?? []).length,
      }))
      .filter((x) => x.gates < x.transfers)
      .map((x) => `${x.rel}: ${x.transfers} transfer(s), ${x.gates} hold check(s) or claim(s)`);
    expect(short).toEqual([]);
  });

  it("the dispute split records a job hold with its OWN error text, not the Helpr-hold one (review #1)", () => {
    const code = blankComments(read("supabase/functions/execute-dispute-split/index.ts"));
    const ask = code.search(/const jobHold = await checkJobPayoutHold\(supabaseAdmin, job\.id\);/);
    expect(ask).toBeGreaterThan(-1);
    const held = code.slice(ask, ask + 1500);
    expect(held).toMatch(/markFailed\(supabaseAdmin, disputeId, PAYOUT_JOB_HOLD_SPLIT_ERROR,/);
    expect(held).not.toMatch(/markFailed\(supabaseAdmin, disputeId, PAYOUT_HOLD_SPLIT_ERROR,/);
  });

  it("Quick Release, the dispute split and release-payout ask before their transfer", () => {
    for (const rel of ["supabase/functions/create-payment/index.ts", "supabase/functions/execute-dispute-split/index.ts", "supabase/functions/release-payout/index.ts"]) {
      const code = blankComments(read(rel));
      const ask = code.search(/checkJobPayoutHold\(supabaseAdmin, /);
      expect(ask, rel).toBeGreaterThan(-1);
      expect(code.indexOf("stripe.transfers.create(", ask), rel).toBeGreaterThan(ask);
    }
  });
});

