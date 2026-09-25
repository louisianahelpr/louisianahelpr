// crewShares — a crew has no lead (docs/OPEN.md Q407, 2026-09-25).
//
// Every hired member of a group job is equal. Each holds one slot
// (0..helpers_needed-1) and that slot's share of the budget, frozen in cents
// at hire (group_job_helpers.slot_no / share_cents, migration 20260925154606).
// This module is the TypeScript twin of the SQL that freezes and prices them;
// the two must agree to the cent.
//
//   allocateCents     == public.crew_slot_share_cents
//   crewMemberFeeCents == poster_cancel_job's crew INSERT
//                         round(share_basis_cents * fee_percent / 100)
//   CREW_FEE_PAYS_UNCONFIRMED      == public.crew_fee_pays_unconfirmed()
//   CREW_COMPLETES_WHEN_HIRED_DONE == public.crew_completes_when_hired_done()
//
// src/test/crewShareAllocation.test.ts proves the split sums exactly and
// src/test/groupCrewNoLead.test.ts that the rule constants match the SQL.

import { cancellationFeePercent, hoursUntilJob } from "./cancellationFee.ts";

/**
 * OWNER RULE (Q407, pending the owner's answer; the money review's default).
 * true: every HIRED crew member counts as committed for the late-cancellation
 * fee and the poster's strike, so the fee is split evenly across the hired
 * crew. false: a member counts only once they confirmed their own spot, as a
 * single Helpr does. Flip it here AND in public.crew_fee_pays_unconfirmed().
 */
export const CREW_FEE_PAYS_UNCONFIRMED = true;

/**
 * OWNER RULE (money review MEDIUM-4, owner being asked). true: an under-filled
 * crew completes once every HIRED member is done, and the unfilled slots'
 * shares are refunded to the poster. Flip it here AND in
 * public.crew_completes_when_hired_done().
 */
export const CREW_COMPLETES_WHEN_HIRED_DONE = true;

/**
 * Slot `slot`'s share of `totalCents` split `n` ways by largest remainder:
 * floor(T / N), plus 1 cent for the first (T mod N) slots. The N shares add up
 * to T exactly (a $100 crew of 3 is 3334 + 3333 + 3333, never $99.99).
 */
export function allocateCents(totalCents: number, n: number, slot: number): number {
  const t = Math.round(totalCents);
  const k = Math.max(1, Math.floor(n || 1));
  if (!(t > 0) || !(slot >= 0)) return 0;
  return Math.floor(t / k) + (slot < t % k ? 1 : 0);
}

/** Every slot's share, in slot order. */
export function allocateAll(totalCents: number, n: number): number[] {
  const k = Math.max(1, Math.floor(n || 1));
  return Array.from({ length: k }, (_, i) => allocateCents(totalCents, k, i));
}

/** Whether a hired member counts as committed under the owner rule. */
export function crewMemberCommitted(confirmed: boolean): boolean {
  return CREW_FEE_PAYS_UNCONFIRMED || confirmed;
}

/** One member's late-cancellation fee in cents, from their frozen share. */
export function crewMemberFeeCents(basisCents: number, committed: boolean, hoursUntilStart: number): number {
  const pct = cancellationFeePercent(committed, hoursUntilStart);
  if (!(basisCents > 0) || pct <= 0) return 0;
  return Math.round((basisCents * pct) / 100);
}

/** The job fields a crew's cancellation fee is priced from. */
export interface CrewCancellationFeeJob {
  budget: number | null;
  date_needed: string | null;
  start_time: string | null;
  cancelled_at: string | null;
}

/** A crew_cancellation_fee_shares row as the money paths read it. */
export interface CrewFeeShareRow {
  helper_id: string | null;
  committed: boolean;
  share_basis_cents: number | string | null;
  share_amount: number | string | null;
}

/**
 * Re-price every ledger row from trusted job fields (F-MONEY-32): the stored
 * fee must equal round(basis * ladder% / 100) to the cent, and the bases must
 * not add up to more than the budget. Returns the total to charge in dollars,
 * or `mismatch` naming what is wrong — the caller then moves NO money.
 */
export function crewCancellationFee(
  job: CrewCancellationFeeJob,
  shares: CrewFeeShareRow[],
): { total: number; mismatch: null | { helper_id: string | null; stored: number; expected: number; reason: string } } {
  const budgetCents = Math.round(Number(job.budget ?? 0) * 100);
  const hours = job.date_needed ? hoursUntilJob(job.date_needed, job.cancelled_at, job.start_time) : Number.POSITIVE_INFINITY;
  let totalCents = 0;
  let basisTotal = 0;
  for (const s of shares) {
    const basis = Number(s.share_basis_cents ?? 0);
    const storedCents = Math.round(Number(s.share_amount ?? 0) * 100);
    const expectedCents = crewMemberFeeCents(basis, !!s.committed, hours);
    if (!Number.isFinite(basis) || !Number.isFinite(storedCents) || storedCents !== expectedCents) {
      return { total: 0, mismatch: { helper_id: s.helper_id, stored: storedCents / 100, expected: expectedCents / 100, reason: "share does not match its price" } };
    }
    basisTotal += basis;
    totalCents += storedCents;
  }
  if (basisTotal > budgetCents) {
    return { total: 0, mismatch: { helper_id: null, stored: basisTotal / 100, expected: budgetCents / 100, reason: "shares exceed the budget" } };
  }
  return { total: totalCents / 100, mismatch: null };
}

/**
 * The POSTER's quote before cancelling a crew (CancellationDialog; display
 * only, the server prices it). `members` are the hired members with their
 * frozen shares; the result is exactly what poster_cancel_job will charge.
 */
export function crewCancellationFeeQuote(
  members: Array<{ share_cents: number | null; confirmed: boolean }>,
  budget: number,
  needed: number,
  hoursUntilStart: number,
): { total: number; perMember: number[]; counted: number; percent: number } {
  const k = Math.max(1, Math.floor(needed || 1));
  const budgetCents = Math.round(Number(budget || 0) * 100);
  const perMember = members.map((m, i) =>
    crewMemberFeeCents(m.share_cents ?? allocateCents(budgetCents, k, i), crewMemberCommitted(m.confirmed), hoursUntilStart) / 100,
  );
  const counted = members.filter((m) => crewMemberCommitted(m.confirmed)).length;
  const total = Math.round(perMember.reduce((a, b) => a + b, 0) * 100) / 100;
  return { total, perMember, counted, percent: cancellationFeePercent(counted > 0, hoursUntilStart) };
}
