/**
 * The words a "$X will be sent" notice opens with. A Helpr's first payout loses the
 * one-time setup fee (release-payout, process-scheduled-payouts), so a notice sent
 * before that payout must not promise the figure before the fee: a first payout was
 * promised $2 too much. The giveaway job takes no fee from its $50 (owner 2026-10-30),
 * so its figure stays $50. An unreadable fee promises no figure: never a number we
 * could not check. Only a notice reads this; the payout paths work it out themselves.
 */
import { formatPayoutDollars, roundPayoutDownCents } from "./money.ts";
import { type FlatFeeStamp, isGiveawayFixedPayJob } from "./helprFlatFee.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const NO_FIGURE = "Your payment";

export async function payoutPromiseWords(
  supabaseAdmin: Db,
  helperId: string,
  job: FlatFeeStamp,
  payoutDollars: number,
): Promise<string> {
  const figure = (cents: number) => `$${formatPayoutDollars(cents / 100)}`;
  const payoutCents = Math.round(payoutDollars * 100);
  if (isGiveawayFixedPayJob(job)) return figure(payoutCents);

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles").select("onboarding_fee_paid").eq("user_id", helperId).maybeSingle();
  if (profileErr) {
    console.error(`[payoutPromise] setup fee read failed for ${helperId}; the notice names no figure:`, profileErr);
    return NO_FIGURE;
  }
  if (profile?.onboarding_fee_paid !== false) return figure(payoutCents);

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("platform_settings").select("onboarding_fee_cents").limit(1).maybeSingle();
  if (settingsErr || settings?.onboarding_fee_cents == null) {
    console.error(`[payoutPromise] setup fee setting unreadable; the notice names no figure:`, settingsErr);
    return NO_FIGURE;
  }
  const afterFeeCents = roundPayoutDownCents(payoutCents - Number(settings.onboarding_fee_cents));
  return afterFeeCents > 0 ? figure(afterFeeCents) : NO_FIGURE;
}
