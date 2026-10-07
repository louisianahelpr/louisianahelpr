/**
 * The cached payout gate, re-synced from one live read of a Helpr's Connect
 * account. One writer, two callers:
 *   - stripe-connect `status`, when the Helpr opens Profile or Activity;
 *   - the recheck-pending-accepts cron function (Q1186), which runs
 *     it for every Helpr with an accept waiting on setup, so an accept
 *     completes without the Helpr coming back to the app.
 * Prod's webhook receives no Connect events (Q876), so before Q1186 a Helpr
 * who finished Stripe and never reopened the app lost the offer at its
 * deadline. The profiles write is what fires
 * trg_profiles_complete_pending_accepts.
 *
 * Moved verbatim from stripe-connect's `status` action (Q1186); the reasons
 * for each step are kept beside it.
 */
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { stripeIdentityVerified } from "../_shared/stripeIdentity.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { enforceConnectAccountFingerprints } from "../_shared/paymentFingerprint.ts";
import { isTestObjectUnderLiveKey, isUnusableConnectAccountError, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

interface GateProfile {
  stripe_account_id: string;
  stripe_identity_verified: boolean | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
}

type GateSyncOutcome =
  | { kind: "banned" }
  /** `opened`: this write moved the gate INTO enabled (the Helpr was told). */
  | { kind: "synced"; opened: boolean; writeError: string | null };

export async function syncConnectGate(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  userId: string,
  profile: GateProfile,
  account: Stripe.Account,
): Promise<GateSyncOutcome> {
  // Q1324: the payout bank accounts (and payout debit cards) on this
  // Connect account are checked against banned people's (owner rule,
  // 2026-10-05: a match AUTO-BANS). This sync is the check point because it
  // is the one writer that sees a Helpr become payable (Q876: prod's
  // endpoint receives no Connect events). The refusal names nothing: a
  // helpful message would turn this into a lookup of whose bank is banned.
  const fpCheck = await enforceConnectAccountFingerprints(stripe, supabaseAdmin, userId, account);
  if (fpCheck.kind === "banned") {
    await postSlackOpsAlert({
      kind: "fraud_flag",
      severity: "warning",
      title: "Ban evasion: a banned person's payout account was attached",
      message: fpCheck.already_banned
        ? "The account was already banned; its ban was left as it was. The fraud console has the details."
        : "The account was banned automatically (owner rule Q1324). The fraud console has the details.",
      fields: { user_id: userId, account_id: account.id, matched_on: fpCheck.matched_on },
    });
    return { kind: "banned" };
  }
  if (fpCheck.kind === "not_deployed") {
    console.warn(`[stripe-connect] Q1324 payout-account check not deployed yet: ${fpCheck.message}`);
  }
  // A check that could not run is never read as "clear": it pages, and the
  // cached payout gate is not moved INTO enabled on this call (below). A
  // Helpr who is already payable stays payable; nobody new becomes payable
  // unchecked.
  const fpCheckFailed = fpCheck.kind === "failed";
  if (fpCheck.kind === "failed") {
    console.error(`[stripe-connect] Q1324 payout-account check did not run for ${userId}: ${fpCheck.message}`);
    await postSlackOpsAlert({
      kind: "security",
      severity: "critical",
      title: "Ban-evasion payout-account check did not run",
      message: "A Helpr's payout bank account was NOT checked against banned people's. Their payout gate was not opened on this read.",
      fields: { user_id: userId, account_id: account.id, reason: fpCheck.message },
      oncePerDayKey: "stripe-connect-q1324-check-failed",
    });
  }

  // Re-sync the cached gate columns from this live read.
  //
  // The acceptance gate (migration 20260827191647) is enforced in Postgres
  // against `profiles.stripe_payouts_enabled` / `stripe_identity_verified`,
  // which are normally written by the `account.updated` webhook. Those
  // columns default FALSE with no backfill, so a helper who onboarded
  // BEFORE they existed — and has had no Connect event since — would be
  // blocked by a cache that is merely empty rather than by anything Stripe
  // actually says.
  //
  // This write-back makes that self-healing instead of requiring a bulk job
  // against live Stripe: the client re-runs `status` on the very attempt
  // that is about to be blocked, so a stale cache corrects itself on the
  // first try. It costs no extra Stripe call — the account is already
  // retrieved by the caller — and it can only ever move the columns towards
  // what Stripe currently reports.
  //
  // Failure is logged, not thrown: the caller asked for a status, and the
  // stale value it replaces is the conservative one (gate stays closed).
  //
  // Q862 — scoped to the id this call RETRIEVED, not just the user. A
  // status call that read the old account before a concurrent clear
  // (Q859 stale-account clear, or `reset`) would otherwise write
  // payouts_enabled=true back onto a profile that no longer has any
  // account. With the id in the WHERE clause that write matches zero rows,
  // which is the correct outcome, so zero rows is legitimate here and not
  // treated as a failure.
  //
  // Q873 — this is a compare-and-set on the flags just read, the same
  // transition CAS the account.updated webhook runs (Q870). Prod's live
  // webhook endpoint receives no Connect events (Q876, measured
  // 2026-10-02), so this sync is usually the ONLY writer that sees a helper
  // become payable; before this it moved the cache silently and the
  // helper never got the "Payout account verified" notice. Now the one
  // write that moves the cache INTO enabled sends it. Zero rows is still
  // legitimate (a concurrent writer — the webhook or a second `status` —
  // got there first and owns the notice, or the account was replaced).
  const nowCharges = account.charges_enabled === true;
  const nowPayouts = account.payouts_enabled === true;
  const wasEnabled = profile.stripe_charges_enabled === true && profile.stripe_payouts_enabled === true;
  const { data: cacheRows, error: cacheErr } = fpCheckFailed && !wasEnabled
    ? { data: [] as Array<{ id: string }>, error: null }
    : await supabaseAdmin
      .from("profiles")
      .update({
        stripe_charges_enabled: nowCharges,
        stripe_payouts_enabled: nowPayouts,
        stripe_identity_verified: stripeIdentityVerified(account),
        ...(stripeIdentityVerified(account)
          ? { stripe_identity_verified_at: new Date().toISOString() }
          : {}),
      })
      .eq("user_id", userId)
      .eq("stripe_account_id", profile.stripe_account_id)
      .eq("stripe_identity_verified", profile.stripe_identity_verified === true)
      .eq("stripe_charges_enabled", profile.stripe_charges_enabled === true)
      .eq("stripe_payouts_enabled", profile.stripe_payouts_enabled === true)
      .select("id");
  if (cacheErr) {
    console.error(`[stripe-connect] status cache write-back failed for ${userId}:`, cacheErr);
    return { kind: "synced", opened: false, writeError: String(cacheErr.message ?? cacheErr) };
  }
  const opened = (cacheRows?.length ?? 0) === 1 && nowCharges && nowPayouts && !wasEnabled;
  if (opened) {
    // insertNotifications logs its own failure and returns false; the
    // status answer does not depend on the notice.
    await insertNotifications(supabaseAdmin, {
      user_id: userId,
      title: "Payout account verified",
      message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
      type: "success",
      link: "/profile?tab=payment",
    });
  }
  return { kind: "synced", opened, writeError: null };
}

/** Most Helprs one scheduled run re-reads (one Stripe read each). */
const PENDING_ACCEPT_RECHECK_CAP = 100;

interface PendingAcceptRecheck {
  waiting: number;
  checked: number;
  opened: number;
  skipped: number;
  defects: string[];
}

/**
 * Q1186: every Helpr with an accept waiting on setup (job_accept_pending)
 * whose Connect account exists but whose cached gate is not open yet is
 * re-read from Stripe and synced, exactly as their own `status` call would.
 * When the sync opens the gate, trg_profiles_complete_pending_accepts
 * completes the accept and tells the poster. A Helpr with no Connect account
 * has nothing to re-read and is left alone. A test-mode account under the
 * live key, or one Stripe calls unusable, is skipped (counted, not a defect:
 * the Helpr's own `status` call owns clearing it).
 */
export async function recheckPendingAccepts(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
): Promise<PendingAcceptRecheck> {
  const out: PendingAcceptRecheck = { waiting: 0, checked: 0, opened: 0, skipped: 0, defects: [] };
  const { data: pending, error: pendingErr } = await supabaseAdmin
    .from("job_accept_pending")
    .select("helper_id")
    .order("requested_at", { ascending: true })
    .limit(1000);
  if (pendingErr) {
    out.defects.push(`job_accept_pending read failed: ${pendingErr.message}`);
    return out;
  }
  const helperIds = [...new Set(((pending ?? []) as Array<{ helper_id: string }>).map((r) => String(r.helper_id)))];
  out.waiting = helperIds.length;
  if (helperIds.length === 0) return out;

  const { data: profiles, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("user_id, stripe_account_id, stripe_identity_verified, stripe_charges_enabled, stripe_payouts_enabled")
    .in("user_id", helperIds)
    .not("stripe_account_id", "is", null);
  if (profErr) {
    out.defects.push(`profiles read failed: ${profErr.message}`);
    return out;
  }
  // Already open on both facts the accept waits on: nothing to re-read (an
  // accept still pending then waits on idv, which Stripe Identity reports).
  const due = ((profiles ?? []) as Array<GateProfile & { user_id: string }>)
    .filter((p) => !(p.stripe_payouts_enabled === true && p.stripe_identity_verified === true));
  if (due.length > PENDING_ACCEPT_RECHECK_CAP) {
    out.defects.push(`${due.length} Helprs wait on setup; ${PENDING_ACCEPT_RECHECK_CAP} are re-read this run, the rest on later runs`);
  }
  for (const p of due.slice(0, PENDING_ACCEPT_RECHECK_CAP)) {
    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieve(p.stripe_account_id);
    } catch (e) {
      if (isTestObjectUnderLiveKey(e) || isUnusableConnectAccountError(e)) {
        if (isTestObjectUnderLiveKey(e)) {
          logTestObjectUnderLiveKey("recheck-pending-accepts", { helper_id: p.user_id, object: "account", id: p.stripe_account_id });
        }
        out.skipped++;
        continue;
      }
      out.defects.push(`Helpr ${p.user_id}: Connect account ${p.stripe_account_id} could not be read (${caughtMessage(e)})`);
      continue;
    }
    out.checked++;
    const gate = await syncConnectGate(stripe, supabaseAdmin, p.user_id, p, account);
    if (gate.kind === "synced") {
      if (gate.writeError) out.defects.push(`Helpr ${p.user_id}: gate write-back failed (${gate.writeError})`);
      if (gate.opened) out.opened++;
    }
  }
  return out;
}
