/**
 * Q2557: the crew half of create-payment's cancel_quote. Read only; moves no money and writes nothing.
 *
 * poster_cancel_job (20261102074317) prices a crew per hired member: that member's frozen share
 * (group_job_helpers.share_cents, or the would-be slot share in hire order) on the cancellation ladder, counted
 * as committed only when they confirmed (CREW_FEE_PAYS_UNCONFIRMED), are not waiting on their ID check before
 * heading out (payout_waits_on_identity), and are not banned or under an open ban review
 * (cancel_fee_payee_frozen, service role only). The client's crewCancellationFeeQuote cannot read either of the
 * last two, so its number could be higher than the fee charged. This reads them as the server, so the dialog
 * can show what poster_cancel_job will record, without telling the poster which member is frozen (only the
 * total goes back).
 *
 * Any failed read answers null: the quote then carries no amount and the dialog keeps its own estimate.
 */
import { cancellationFeePercent, hoursUntilJob } from "./cancellationFee.ts";
import { allocateCents, crewMemberCommitted, crewMemberFeeCents } from "./crewShares.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

interface RosterRow {
  id: string;
  helper_id: string | null;
  share_cents: number | null;
  helper_confirmed_at: string | null;
  helper_on_the_way_at: string | null;
  helper_arrived_at: string | null;
  joined_at: string | null;
}

/** One crew member as poster_cancel_job sees them. */
export interface CrewQuoteMember {
  share_cents: number | null;
  confirmed: boolean;
  /** Waiting on their ID check and not yet on the way or arrived. */
  idWaits: boolean;
  /** Banned or under an open ban review. */
  frozen: boolean;
}

/** poster_cancel_job's crew fee in cents, members in hire order (joined_at NULLS LAST, id). */
export function crewCancelFeeCents(
  members: CrewQuoteMember[],
  budget: number,
  needed: number,
  hoursUntilStart: number,
): { cents: number; percent: number } {
  const k = Math.max(1, Math.floor(needed || 1));
  const budgetCents = Math.round(Number(budget || 0) * 100);
  let cents = 0;
  let anyCommitted = false;
  members.forEach((m, i) => {
    const committed = crewMemberCommitted(m.confirmed) && !m.idWaits && !m.frozen;
    anyCommitted ||= committed;
    cents += crewMemberFeeCents(m.share_cents ?? allocateCents(budgetCents, k, i), committed, hoursUntilStart);
  });
  return { cents, percent: cents > 0 ? cancellationFeePercent(anyCommitted, hoursUntilStart) : 0 };
}

const byHireOrder = (a: RosterRow, b: RosterRow) => {
  if (a.joined_at !== b.joined_at) {
    if (a.joined_at === null) return 1;
    if (b.joined_at === null) return -1;
    return a.joined_at < b.joined_at ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** True / false from a service-role boolean RPC; PGRST202 (not deployed) reads false; any other error is null. */
async function flag(db: Db, fn: string, args: Record<string, unknown>): Promise<boolean | null> {
  const { data, error } = await db.rpc(fn, args);
  if (error) return error.code === "PGRST202" ? false : null;
  return data === true;
}

export async function readCrewCancelFee(
  db: Db,
  job: { id: string; budget: number | null; helpers_needed: number | null; date_needed: string | null; start_time: string | null },
  nowIso: string,
): Promise<{ cents: number; percent: number } | null> {
  const { data, error } = await db
    .from("group_job_helpers")
    .select("id, helper_id, share_cents, helper_confirmed_at, helper_on_the_way_at, helper_arrived_at, joined_at")
    .eq("job_id", job.id);
  if (error || !Array.isArray(data)) return null;
  const rows = (data as RosterRow[]).filter((r) => r.helper_id).sort(byHireOrder);
  const members: CrewQuoteMember[] = [];
  for (const r of rows) {
    const idWaits = !r.helper_on_the_way_at && !r.helper_arrived_at
      ? await flag(db, "payout_waits_on_identity", { p_user_id: r.helper_id })
      : false;
    const frozen = await flag(db, "cancel_fee_payee_frozen", { p_user: r.helper_id });
    if (idWaits === null || frozen === null) return null;
    members.push({ share_cents: r.share_cents, confirmed: !!r.helper_confirmed_at, idWaits, frozen });
  }
  const hours = job.date_needed ? hoursUntilJob(job.date_needed, nowIso, job.start_time ?? null) : Number.POSITIVE_INFINITY;
  return crewCancelFeeCents(members, Number(job.budget ?? 0), Number(job.helpers_needed ?? 1), hours);
}
