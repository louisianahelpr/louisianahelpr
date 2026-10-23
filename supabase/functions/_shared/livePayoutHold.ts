// livePayoutHold — the ONE "hold this transfer unless Stripe says the account
// is payable" step every sender of money to a Helpr's Connect account runs
// immediately before transfers.create (lead, 2026-10-23: Stripe rejected the
// platform and its connected accounts; prod gets no Connect events, Q876).
//
// It reads the account live (_shared/livePayoutGate.ts readLivePayoutGate) and,
// when the answer is anything but payable:
//   - closes the cached gate on profiles for a rejected or gone account
//     (towards false only; never for "cannot verify" or a refused platform);
//   - tells ops ONCE a day: per Helpr (`payout-held-not-payable-<helper>`, the
//     same key every sender uses, so one Helpr is one alert a day whatever is
//     held), or once for the whole platform when Stripe refuses OUR account;
//   - returns a defect only when the read failed for an unknown reason (or the
//     cache close failed), so a known, already-told hold never turns a run red.
// The caller then takes its own "held" exit (the same one a payout hold takes)
// and moves no money. Never throws.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { closeCachedConnectGate, holdClosesCache, readLivePayoutGate, type ConnectAccountFacts, type LivePayoutGate } from "../_shared/livePayoutGate.ts";

export type LivePayoutHold =
  | { held: false; account: ConnectAccountFacts }
  | {
    held: true;
    kind: "not_payable" | "rejected" | "unusable" | "platform_rejected" | "cannot_verify";
    reason: string;
    /** Set when the run should count a defect (an unexplained failed read, or a failed cache close). */
    defect: string | null;
  };

export interface LivePayoutHoldInput {
  stripe: Stripe;
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any;
  helperId: string;
  accountId: string;
  /** The calling function, for the alert and the defect. */
  fn: string;
  /** What is held, for the alert: "the payout", "a cancellation fee", "a tip re-payment"... */
  what: string;
  /** What happens next, one sentence: "It is tried again on the next run." */
  then: string;
  /** The subject is seed/E2E data (routes the alert to the digest). */
  seed?: boolean;
  fields?: Record<string, string | number | null | undefined>;
  /** One live read per account per run, when the caller passes its run's map. */
  cache?: Map<string, Promise<LivePayoutGate>>;
}

export async function holdUnlessPayable(i: LivePayoutHoldInput): Promise<LivePayoutHold> {
  let read = i.cache?.get(i.accountId);
  if (!read) {
    read = readLivePayoutGate(i.stripe, i.accountId);
    i.cache?.set(i.accountId, read);
  }
  const gate = await read;
  if (gate.ok) return { held: false, account: gate.account };

  console.warn(`[${i.fn}] ${i.what} HELD for Helpr ${i.helperId}: Connect account ${i.accountId} ${gate.kind} (${gate.reason}); no transfer attempted.`);
  const defects: string[] = [];
  if (holdClosesCache(gate)) {
    const shut = await closeCachedConnectGate(i.supabaseAdmin, i.helperId, i.accountId);
    if (shut.error) defects.push(`cached gate close ${i.helperId}: ${shut.error}`);
  }
  const platformRefused = gate.kind === "platform_rejected";
  await postSlackOpsAlert({
    kind: "payout_wait",
    severity: "warning",
    oncePerDayKey: platformRefused ? "payout-held-platform-rejected" : `payout-held-not-payable-${i.helperId}`,
    seed: i.seed === true,
    title: platformRefused
      ? "Payouts held: Stripe refuses the platform's account"
      : "Payout held: Stripe does not say the Helpr's account is payable",
    message: platformRefused
      ? `Stripe answered that the platform's own account has been rejected, so no Helpr's account can be verified: ${i.what} was held, not sent. ${i.then}`
      : gate.kind === "cannot_verify"
        ? `The Helpr's payout account could not be read from Stripe, so ${i.what} was held, not sent. ${i.then}`
        : `Stripe says the Helpr's payout account cannot be paid out now, so ${i.what} was held, not sent. ${i.then}`,
    fields: { ...i.fields, fn: i.fn, helper_id: i.helperId, account_id: i.accountId, gate: gate.kind, reason: gate.reason },
  });
  if (gate.kind === "cannot_verify") defects.push(`live payout gate ${i.helperId}: ${gate.reason}`);
  return { held: true, kind: gate.kind, reason: gate.reason, defect: defects.length ? defects.join("; ") : null };
}
