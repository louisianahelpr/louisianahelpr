/**
 * What an approval notice may promise a Helpr: what the payout will really send,
 * days later (10-30 jobs audit, item 6). The notice used to quote the job's
 * take-home, so a first-time Helpr was told $89 on a $100 job and received $87,
 * because the unpaid one-time setup fee comes off the transfer. Any money still
 * owed from a job they were ruled at fault on comes off too.
 *
 * READS ONLY. It moves no money and claims nothing: process-scheduled-payouts and
 * release-payout still decide at payout time. The arithmetic below is theirs:
 * whole dollars after the setup fee, then the debt off in exact cents, up to the
 * cap that keeps the transfer at $1 or more. The giveaway sends its exact amount:
 * Louisiana Helpr's share covers its setup fee, and a debt waits for the next payout.
 *
 * Any read that fails returns null, and the notice then names the day with no
 * figure. A wrong promise is worse than none.
 */
import { formatExactDollars, formatPayoutDollars, roundPayoutDownCents } from "./money.ts";
import { helprFaultFeeCapCents } from "./helprFaultFee.ts";
import { isGiveawayFixedPayJob } from "./helprFlatFee.ts";

export type PromisedPayout = {
  /** What lands in the Helpr's account. */
  cents: number;
  /** The one-time setup fee taken from it. */
  setupFeeCents: number;
  /** Money owed from an at-fault ruling taken from it. */
  debtCents: number;
};

/** The payer's arithmetic for the fee and debt, given what they are today. */
export function promisedPayoutCents(opts: {
  unroundedCents: number;
  setupFeeOwedCents: number;
  debtOwedCents: number;
  giveaway: boolean;
}): PromisedPayout {
  const setupFeeCents = opts.giveaway ? 0 : Math.max(0, opts.setupFeeOwedCents);
  const afterFee = roundPayoutDownCents(opts.unroundedCents - setupFeeCents);
  // Too small to cover the fee: the payer skips this payout and takes the fee from a later one.
  if (afterFee <= 0) return { cents: 0, setupFeeCents: 0, debtCents: 0 };
  const debtCents = opts.giveaway
    ? 0
    : Math.min(Math.max(0, opts.debtOwedCents), helprFaultFeeCapCents(opts.unroundedCents - setupFeeCents));
  return { cents: afterFee - debtCents, setupFeeCents, debtCents };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a supabase-js client, as in the callers
type Db = { from: (table: string) => any };

/** Today's fee and debt for this Helpr, or null when any read fails. */
export async function readPromisedPayout(
  supabaseAdmin: Db,
  helperId: string,
  job: Parameters<typeof isGiveawayFixedPayJob>[0],
  helperPayoutDollars: number,
): Promise<PromisedPayout | null> {
  try {
    const [settings, profile, debts] = await Promise.all([
      supabaseAdmin.from("platform_settings").select("onboarding_fee_cents").limit(1).single(),
      supabaseAdmin.from("profiles").select("onboarding_fee_paid").eq("user_id", helperId).maybeSingle(),
      supabaseAdmin.from("job_helpr_fault_rulings").select("card_fee_remaining_cents").eq("helper_id", helperId).gt("card_fee_remaining_cents", 0),
    ]);
    if (settings.error || profile.error || debts.error) return null;
    const feeSetting = settings.data?.onboarding_fee_cents;
    if (typeof feeSetting !== "number" || !profile.data) return null;
    const debtOwedCents = ((debts.data ?? []) as { card_fee_remaining_cents: number }[])
      .reduce((sum, row) => sum + Number(row.card_fee_remaining_cents), 0);
    if (!Number.isFinite(debtOwedCents)) return null;
    const promised = promisedPayoutCents({
      unroundedCents: Math.round(helperPayoutDollars * 100),
      setupFeeOwedCents: profile.data.onboarding_fee_paid === true ? 0 : feeSetting,
      debtOwedCents,
      giveaway: isGiveawayFixedPayJob(job),
    });
    return promised.cents > 0 ? promised : null;
  } catch (e) {
    console.error(`[payoutPromise] could not read the fee and debt for ${helperId}; the notice names no figure:`, e);
    return null;
  }
}

/**
 * The end of an approval notice: "$87 will be sent to your account Tue, Nov 3,
 * after the one-time $2 account setup fee."
 */
export function payoutPromiseSentence(promised: PromisedPayout | null, payDay: string): string {
  if (!promised) return `Your pay will be sent to your account ${payDay}.`;
  const dollars = promised.debtCents > 0 ? formatExactDollars(promised.cents / 100) : formatPayoutDollars(promised.cents / 100);
  const taken = [
    promised.setupFeeCents > 0 ? `the one-time $${formatExactDollars(promised.setupFeeCents / 100)} account setup fee` : "",
    promised.debtCents > 0 ? `$${formatExactDollars(promised.debtCents / 100)} owed from a job you were ruled at fault on` : "",
  ].filter(Boolean);
  return `$${dollars} will be sent to your account ${payDay}${taken.length > 0 ? `, after ${taken.join(" and ")}` : ""}.`;
}
