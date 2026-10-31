/**
 * Q891 class guard. Prod went live on Stripe 2026-09-27; every id stored on a
 * row before that was minted under the TEST key, and the live key answers a
 * retrieve of one with 404 resource_missing "a similar object exists in test
 * mode, but a live mode key was used". One function (create-payment) 500'd on
 * it and stranded a job in 'cancelling'; nine more read stored ids unclassified.
 *
 * The CLASS: every `stripe.<resource>.retrieve(<id>)` in supabase/functions is
 * either
 *   - CLASSIFIED: the catch that follows it calls the shared
 *     `isTestObjectUnderLiveKey` (and, in the money crons, writes the one
 *     structured skip line via `logTestObjectUnderLiveKey`), or
 *   - EXEMPT, listed below with the reason it cannot meet this error.
 * Both lists are EXACT and two-way: a new retrieve that is in neither fails,
 * and an entry whose retrieve no longer exists fails. Keys are
 * `<function file>::<call text>(<first arg>)` with `#n` for the nth repeat.
 *
 * The behaviour at each classified site is pinned in that function's own edge
 * test (red on the old code); this file pins that no site is forgotten and
 * that nobody shadows the shared classifier with a local stand-in.
 *
 * @mutate supabase/functions/auto-release-payment/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * (auto-resolve-disputes left both lists 2026-10-30, Q2362: it no longer reads Stripe at all.)
 * @mutate supabase/functions/charge-recurring-visits/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/execute-dispute-split/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/money-reconciliation/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/release-payout/index.ts | import { isTestObjectUnderLiveKey, isUnusableConnectAccountError, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | import { isUnusableConnectAccountError } from "../_shared/stripeAccountUsable.ts"; const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/void-cancelled-payments/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/release-payout/index.ts | if (isTestObjectUnderLiveKey(e)) {\n          logTestObjectUnderLiveKey("release-payout", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | if (false) {\n          logTestObjectUnderLiveKey("release-payout", { job_id: job.id, object: "payment_intent", id: paymentIntentId });
 * @mutate supabase/functions/release-payout/index.ts | logTestObjectUnderLiveKey("release-payout", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | void 0;
 * @mutate supabase/functions/charge-recurring-visits/index.ts | if (card.kind === "test_object") { | if (card.kind === "test_object") { void 0;
 * @mutate supabase/functions/create-payment/index.ts | import { isTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false;
 * @mutate supabase/functions/create-payment/index.ts | if (!isTestObjectUnderLiveKey(rowPiErr)) throw rowPiErr; | throw rowPiErr;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FUNCTIONS = resolve(__dirname, "../../supabase/functions");
const SHARED = "../_shared/stripeAccountUsable.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

/**
 * The brace-balanced body of the first `catch` at or after `from`, or null.
 * Null too when `from` sits directly in a catch body: the next catch then
 * belongs to a later try, not to this call (create-payment's priorPi.id
 * re-read inside its cancel's catch read as classified by the row-PI check's
 * handler below it, 2026-10-18).
 */
function catchBodyAfter(s: string, from: number): string | null {
  let open = -1;
  for (let k = from - 1, depth = 0; k >= 0; k--) {
    if (s[k] === "}") depth++;
    else if (s[k] === "{" && --depth < 0) { open = k; break; }
  }
  if (open >= 0 && /\bcatch\s*(\([^)]*\))?\s*$/.test(s.slice(Math.max(0, open - 80), open))) return null;
  const re = /\bcatch\s*(\([^)]*\))?\s*\{/g;
  re.lastIndex = from;
  const m = re.exec(s);
  if (!m) return null;
  let i = m.index + m[0].length;
  const start = i;
  for (let depth = 1; i < s.length && depth > 0; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") depth--;
  }
  return s.slice(start, i - 1);
}

interface Site { key: string; file: string; classified: boolean; logged: boolean; connectClassified: boolean }

const files = walk(FUNCTIONS);
const sites: Site[] = [];
const sources = new Map<string, string>();
for (const f of files) {
  const rel = relative(FUNCTIONS, f);
  const s = blankComments(readFileSync(f, "utf8"));
  sources.set(rel, s);
  const re = /\bstripe\.((?:\w+\.)?\w+)\.retrieve\(\s*([^,)]*)/g;
  const seen: Record<string, number> = {};
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const base = `${rel}::stripe.${m[1]}.retrieve(${m[2].trim()})`;
    seen[base] = (seen[base] ?? 0) + 1;
    const body = catchBodyAfter(s, m.index) ?? "";
    sites.push({
      key: seen[base] > 1 ? `${base}#${seen[base]}` : base,
      file: rel,
      classified: body.includes("isTestObjectUnderLiveKey("),
      logged: body.includes("logTestObjectUnderLiveKey("),
      connectClassified: body.includes("isUnusableConnectAccountError("),
    });
  }
}

/** Functions whose skip must also write the structured line. */
// @two-way src/test/stripeStoredIdRetrieveClassified.test.ts:SKIP_LOGGING_FILES entry still classifies a retrieve
const SKIP_LOGGING_FILES = [
  "auto-release-payment/index.ts",
  "charge-recurring-visits/index.ts",
  "execute-dispute-split/clearTestModeRecords.ts",
  "execute-dispute-split/index.ts",
  "money-reconciliation/index.ts",
  "process-scheduled-payouts/index.ts",
  "release-payout/index.ts",
  "void-cancelled-payments/index.ts",
];

/** Classified sites whose skip line is written by their caller, not their catch. */
const LOGS_AT_CALLER = ["charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)"];

/** The retrieves that go through the classifier: EXACT. */
const CLASSIFIED = [
  "_shared/connectGateSync.ts::stripe.accounts.retrieve(p.stripe_account_id)",
  "_shared/connectGateSync.ts::stripe.accounts.retrieve(p.stripe_account_id)#2",
  "_shared/livePayoutGate.ts::stripe.accounts.retrieve(accountId)",
  "auto-release-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "auto-release-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "charge-recurring-visits/index.ts::stripe.checkout.sessions.retrieve(sessionId)",
  "charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(pi)",
  // J4 (Q2170): admin_bill_helpr_fault reads the job's stored session, then its PaymentIntent; a test-mode
  // id is rethrown to the outer catch's 409 (no money moved), never the local 503 "try again".
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(billJob.stripe_session_id)",
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(previousSessionId)",
  "create-payment/index.ts::stripe.paymentIntents.retrieve(cancelPaymentIntentId)",
  "create-payment/index.ts::stripe.paymentIntents.retrieve(piId)",
  // Q2074: the PaymentIntent a bounced bank payment left on the row; a test-mode one is dead and cleared.
  "create-payment/index.ts::stripe.paymentIntents.retrieve(rowPaymentIntentId)",
  // Q1732: the admin button's Stripe check; a test-mode id is the ONLY answer that lets the clear run.
  "execute-dispute-split/clearTestModeRecords.ts::stripe.checkout.sessions.retrieve(escrowId)",
  "execute-dispute-split/clearTestModeRecords.ts::stripe.paymentIntents.retrieve(escrowId)",
  "execute-dispute-split/clearTestModeRecords.ts::stripe.refunds.retrieve(id)",
  "execute-dispute-split/clearTestModeRecords.ts::stripe.transfers.retrieve(id)",
  "execute-dispute-split/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "execute-dispute-split/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "execute-dispute-split/index.ts::stripe.transfers.retrieve(dispute.execution_transfer_id)",
  "money-reconciliation/index.ts::stripe.paymentIntents.retrieve(piId)",
  "process-scheduled-payouts/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "process-scheduled-payouts/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "release-payout/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "release-payout/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "stuck-payment-check/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "void-cancelled-payments/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id!)",
  "void-cancelled-payments/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id!)#2",
  "void-cancelled-payments/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "void-cancelled-payments/index.ts::stripe.paymentIntents.retrieve(fj.stripe_payment_intent_id)",
  "void-cancelled-payments/index.ts::stripe.paymentIntents.retrieve(job.stripe_payment_intent_id)",
  "void-cancelled-payments/index.ts::stripe.paymentIntents.retrieve(job.stripe_payment_intent_id)#2",
  "void-cancelled-payments/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "void-cancelled-payments/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2",
];

const OUTER =
  "no local catch swallows it: the throw reaches create-payment's outer catch, which answers 409 through isTestObjectUnderLiveKey (create-payment.test.ts)";
const REREAD =
  "re-read, in the same request or loop iteration and under the same key, of an id a classified retrieve just answered; the answer cannot differ";
const FRESH = "an object this run created under this key moments earlier, not a stored id";
const ABSENT =
  "swallow-to-absent by design: an unreadable prior object is replaced by a fresh one; no money moves on it";
const EVENT =
  "an id taken from a Stripe webhook event, and stripe-webhook/index.ts hands each handler the client of the event's own mode (a live-endpoint event of the other mode is refused; a test-endpoint event runs on the test key, 2026-10-12), so it is of this key's mode";
const PLATFORM = "reads the platform's own account/balance, not a stored id";
/** Boards 66/172 slice 2: cancel_quote only shows a number; its local catch answers "unreadable" (no number), and the cancel's money moves later in void-cancelled-payments, whose retrieves are classified above. */
const READ_ONLY_QUOTE =
  "a read-only cancel quote: a test-mode id under the live key throws into the quote's own catch, which answers unreadable (no number shown); no money moves here (the cancel's refund runs in void-cancelled-payments, classified above)";

/**
 * Q1251: a stored CONNECT ACCOUNT id. Stripe answers a sandbox account under
 * the live key with "…was a test account created with a testmode key", which
 * is `isUnusableConnectAccountError`'s sentence, not `isTestObjectUnderLiveKey`'s.
 * Every such read goes through THAT classifier: in the catch right after the
 * retrieve (CONNECT_CLASSIFIED), or, where the read sits inside a larger try,
 * in the catch or callback named in CONNECT_AT_CALLER. EXACT, both ways.
 * Before Q1251, execute-dispute-split and release-payout answered 502 "retry"
 * (and the split marked the dispute failed) and instant-payout 500'd.
 */
const CONNECT_CLASSIFIED = [
  "_shared/connectReadiness.ts::stripe.accounts.retrieve(accountId)",
  // execute-dispute-split's read moved into _shared/livePayoutGate.ts (lead
  // 2026-10-23), which classifies it (CLASSIFIED: a sandbox id under the live
  // key is logged, then answered "unusable", as execute-dispute-split did).
  "instant-payout/index.ts::stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id })",
  "release-payout/index.ts::stripe.accounts.retrieve(helper.stripe_account_id)",
  "stripe-connect/index.ts::stripe.accounts.retrieve(accountId)",
  "stripe-connect/index.ts::stripe.accounts.retrieve(created.id)",
  "stripe-webhook/handlers/accountUpdated.ts::stripe.accounts.retrieve(account.id)",
  "stripe-webhook/handlers/accountUpdated.ts::stripe.accounts.retrieve(accountId)",
  "stripe-payouts/index.ts::stripe.accounts.retrieve(accountId)",
  "stripe-payouts/index.ts::stripe.balance.retrieve({ stripeAccount: accountId })",
];
/** Connect reads classified by a caller's catch or callback: key -> the text that does it. */
const CONNECT_AT_CALLER: Record<string, RegExp> = {
  // The handler's outer catch: `const isStaleAccountErr = isUnusableConnectAccountError(err);`
  "stripe-connect/index.ts::stripe.accounts.retrieve(profile.stripe_account_id)": /const isStaleAccountErr = isUnusableConnectAccountError\(err\)/,
  "stripe-connect/index.ts::stripe.accounts.retrieve(profile.stripe_account_id)#2": /const isStaleAccountErr = isUnusableConnectAccountError\(err\)/,
  "stripe-connect/index.ts::stripe.accounts.retrieve(profile.stripe_account_id)#3": /const isStaleAccountErr = isUnusableConnectAccountError\(err\)/,
  // Owner 2026-10-25 (freshIfRejected): its own catch keeps only a "has been rejected" answer;
  // anything else (an unusable id included) is rethrown to the handler's outer catch.
  "stripe-connect/index.ts::stripe.accounts.retrieve(accountId)#2": /const isStaleAccountErr = isUnusableConnectAccountError\(err\)/,
  // Q1221: the sync hands its retrieve to syncPayoutHold, which asks isAccountGone.
  "payout-hold-stripe-sync/index.ts::stripe.accounts.retrieve(accountId)": /isAccountGone:\s*\(err: unknown\) => isUnusableConnectAccountError\(err\)/,
};

/** The retrieves that do NOT go through either classifier, each with why: EXACT. */
// @two-way src/test/stripeStoredIdRetrieveClassified.test.ts:toEqual(Object.keys(EXEMPT).sort())
const EXEMPT: Record<string, string> = {
  // Q2399 card hold at post (20261027185146, 2026-10-25): a job's own card hold. Every hold was minted after the
  // 2026-09-27 live switch (the feature did not exist before), and each is read on the client of the mode it was
  // placed in: create-payment's job money mode, card-hold-sweep's hold row stripe_mode, or the webhook event's own.
  "_shared/cardHold.ts::stripe.paymentIntents.retrieve(piId)": "the hold being captured or released, re-read after Stripe refused the capture / cancel, on the hold's own mode; minted after the live switch",
  "_shared/cardHold.ts::stripe.paymentIntents.retrieve(piId)#2": "the hold being released, re-read after Stripe refused the cancel, on the hold's own mode; minted after the live switch",
  "_shared/cardHold.ts::stripe.paymentIntents.retrieve(hold.payment_intent_id)": "a resumed off-session charge this claim recorded while it was processing (round 4): read, never re-created; on the hold's own mode (the claim refuses another); minted after the live switch",
  "_shared/cardHold.ts::stripe.paymentIntents.retrieve(hold.payment_intent_id)#2": "a closed job's stale claim on a SAVED card: did its recorded off-session charge go through? On the hold's own mode; minted after the live switch",
  "_shared/cardHold.ts::stripe.paymentIntents.retrieve(hold.payment_intent_id)#3": "a closed job's stale capture claim: is the hold captured at Stripe? On the hold's own mode; minted after the live switch",
  "_shared/cardHold.ts::stripe.paymentIntents.retrieve(hold.payment_intent_id)#4": "a failing hold, re-read after Stripe refused its cancel, on the hold's own mode; minted after the live switch",
  "card-hold-sweep/index.ts::stripe.paymentIntents.retrieve(hold.payment_intent_id)": "a superseded hold, re-read after Stripe refused its cancel, on the hold row's stripe_mode; minted after the live switch",
  "card-hold-sweep/index.ts::stripe.paymentIntents.retrieve(oldPi)": "an expiring hold read before its renewal, on the hold row's stripe_mode; minted after the live switch",
  "stripe-webhook/handlers/cardHoldCheckout.ts::stripe.setupIntents.retrieve(siId)": "the setup session's own SetupIntent, from the event, on the event's mode",
  "stripe-webhook/handlers/cardHoldCheckout.ts::stripe.paymentIntents.retrieve(piId)": "the hold session's own PaymentIntent, from the event, on the event's mode",
  "stripe-webhook/handlers/cardHoldCheckout.ts::stripe.paymentIntents.retrieve(pi.id)": "the same event's PaymentIntent, re-read after Stripe refused cancelling it as a duplicate, on the event's mode",
  // Declutter (slice 3b): ids from the webhook event itself, read on the client of the event's own mode
  // (stripe-webhook builds the test-key client for a test-endpoint event), never a stored id.
  "stripe-webhook/handlers/declutterCheckout.ts::stripe.paymentIntents.retrieve(paymentIntentId)": "the paid session's own PaymentIntent, from the event, on the event's mode",
  "stripe-webhook/handlers/declutterCheckout.ts::stripe.setupIntents.retrieve(setupIntentId)": "the setup session's own SetupIntent, from the event, on the event's mode",
  // Declutter (slice 4): a Declutter order's PaymentIntent, read on the client its parties pick (the mode it was paid
  // in). No Declutter order predates the 2026-09-27 live switch (prod had no declutter_orders table, 2026-10-15); a
  // failed read is a failed payout attempt that backs off (declutter_payout_executed).
  "declutter-money/index.ts::stripe.balance.retrieve()": "the platform's own balance (a probe that our key still works); no stored id",
  "declutter-money/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)": "a Declutter order's own payment (wholeCharge, before a seller or Helpr payout), on its parties' mode; minted after the live switch",
  "shop-checkout/index.ts::stripe.refunds.retrieve(refundId)": "an id an admin TYPES (Record a refund made in Stripe, Shops M3), not a stored one; a test-mode, foreign or bad id is Stripe's resource_missing, which retrieveRefund turns into null (refund_not_found, nothing recorded)",
  // Q2138 (one wallet): the poster's wallet customer is stored PER MODE (stripe_customers keyed
  // user_id + wallet_mode) and read on the client of that same mode, so a test customer never meets the
  // live key; a missing one (resource_missing) is handled as deleted (Q2140), anything else retries.
  "auto-tip-charge/index.ts::stripe.customers.retrieve(customerId)": "the poster's stored wallet customer, keyed by the job's mode and read on that mode's client; minted after the live switch",
  // Shops M1 (20261018164442): a Shops order's own hold, read on the client of the mode the order recorded
  // (shopOrderMode: payment_livemode / the page's cs_test_ prefix, else its parties). No Shops order predates the
  // 2026-09-27 live switch (prod had no shop_orders table, 2026-10-18); a failed read is a capture or release attempt
  // that the money cron retries.
  "_shared/shopHolds.ts::stripe.paymentIntents.retrieve(paymentIntentId)": "a Shops order's own hold after capture (its charge and fee), on the order's recorded mode; minted after the live switch",
  "_shared/shopHolds.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": "a Shops order's own hold, re-read when a capture is refused, on the order's recorded mode; minted after the live switch",
  "_shared/shopHolds.ts::stripe.paymentIntents.retrieve(piId)": "a Shops order's own hold before it is cancelled, on the order's recorded mode; minted after the live switch",
  "stripe-webhook/handlers/shopCheckout.ts::stripe.paymentIntents.retrieve(piId)": "the completed session's own PaymentIntent, from the event, on the event's mode",
  // Board 177: ONE PAYOUT. The id is one the member picked from their own payout list (stripe-payouts' list, read on
  // their own account and key); a test-mode, foreign or stale id is Stripe's resource_missing, which stripe-payouts'
  // detailErr catch answers as 404 "not found", and an unusable account goes through isUnusableConnectAccountError there.
  "stripe-payouts/payoutDetail.ts::stripe.payouts.retrieve(payoutId)": "a payout id from the member's own payout list, read on their own account; resource_missing answers 404 not found (detailErr catch), never a 500",
  "charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(intent.id)": FRESH,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#2": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#3": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#4": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#5": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(previousSessionId)#2": REREAD,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(qJob.stripe_session_id)": READ_ONLY_QUOTE,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(qPiId)": READ_ONLY_QUOTE,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(row.stripe_session_id)": ABSENT,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(captureResult.paymentIntentId)": REREAD,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#3": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#4": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#5": REREAD,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(priorPi.id)": REREAD,
  "execute-dispute-split/index.ts::stripe.charges.retrieve(charge)": REREAD,
  "execute-dispute-split/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": REREAD,
  "instant-payout/index.ts::stripe.accounts.retrieve()": PLATFORM,
  "instant-payout/index.ts::stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id })#2": REREAD,
  "process-scheduled-payouts/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": REREAD,
  // Q1390: the crew block-fee charge link, read after the main loop has
  // already retrieved and classified this job's PaymentIntent.
  "process-scheduled-payouts/index.ts::stripe.paymentIntents.retrieve(a.paymentIntentId)": REREAD,
  "stripe-idv-start/index.ts::stripe.identity.verificationSessions.retrieve(profile.idv_session_id)": ABSENT,
  "stripe-idv-webhook/index.ts::stripe.identity.verificationSessions.retrieve(session.id)": EVENT,
  "_shared/chargebackClawback.ts::stripe.transfers.retrieve(id)": EVENT,
  // Q1222: holdBackPaidTip runs only from checkout.session.completed; the
  // PaymentIntent is the event session's, the transfer that charge's.
  "_shared/heldTipRepay.ts::stripe.paymentIntents.retrieve(args.paymentIntentId)": EVENT,
  "_shared/heldTipRepay.ts::stripe.transfers.retrieve(transferId)": EVENT,
  // Review of 9c498193ff #2: the fee transfer whose reversals listReversals just read under the same key.
  "_shared/instantPayoutFeeReturn.ts::stripe.transfers.retrieve(transferId)": REREAD,
  // Q1324: the card that paid this event's own session.
  "stripe-webhook/handlers/_checkoutCardFingerprint.ts::stripe.paymentIntents.retrieve(session.payment_intent)": EVENT,
  "stripe-webhook/handlers/_walletDefaultCard.ts::stripe.paymentIntents.retrieve(session.payment_intent)": EVENT,
  "stripe-webhook/handlers/_walletDefaultCard.ts::stripe.customers.retrieve(stored)": "the member's stored wallet customer, keyed by the event's mode and read on that mode's client; minted after the live switch",
  "stripe-webhook/handlers/_checkoutCardFingerprint.ts::stripe.subscriptions.retrieve(session.subscription)": EVENT,
  "stripe-webhook/handlers/chargeDisputeClosed.ts::stripe.charges.retrieve(chargeId)": EVENT,
  "stripe-webhook/handlers/chargeRefundUpdated.ts::stripe.charges.retrieve(chargeId)": EVENT,
  "stripe-webhook/handlers/_visitTaxReversal.ts::stripe.paymentIntents.retrieve(piId)": EVENT,
  // items-c-refund-notice (2026-10-12): undoVisitTaxForFailedRefund runs from the
  // charge.refund.updated event; piId is that refund's own PaymentIntent.
  "stripe-webhook/handlers/_visitTaxReversal.ts::stripe.paymentIntents.retrieve(piId)#2": EVENT,
  // Q1724: reverseVisitTaxForLostDispute runs from the charge.dispute.closed
  // event; piId is that dispute's own PaymentIntent.
  "stripe-webhook/handlers/_visitTaxReversal.ts::stripe.paymentIntents.retrieve(piId)#3": EVENT,
  // Q1724: the same handler reads the dispute's own charge for what was
  // refunded before the dispute.
  "stripe-webhook/handlers/_visitTaxReversal.ts::stripe.charges.retrieve(chargeId)": EVENT,
  "stripe-webhook/handlers/chargeRefunded.ts::stripe.paymentIntents.retrieve(refundPiId)": EVENT,
  "stripe-webhook/handlers/chargeDisputeClosed.ts::stripe.charges.retrieve(closedDispute.charge as string)": EVENT,
  "stripe-webhook/handlers/chargeDisputeCreated.ts::stripe.charges.retrieve(dispute.charge as string)": EVENT,
  // Q1829: the duplicate-funding redelivery reads the job's STORED funding PaymentIntent; a test
  // object under the live key answers 404 resource_missing, caught right there: the gift is kept
  // spent and the alert says why (no money moves on it).
  "stripe-webhook/handlers/checkoutSessionCompleted.ts::stripe.paymentIntents.retrieve(fundingPi)":
    "stored id, caught at the call: 404/resource_missing (which a test object under the live key answers) keeps the gift spent and pages ops; no money moves on it",
  "stripe-webhook/handlers/checkoutSessionCompleted.ts::stripe.paymentIntents.retrieve(piId)": EVENT,
  // Q1876: session.payment_intent of the completed session in this event.
  "stripe-webhook/handlers/checkoutSessionCompleted.ts::stripe.paymentIntents.retrieve(sessionPi)": EVENT,
  "stripe-webhook/handlers/checkoutSessionCompleted.ts::stripe.subscriptions.retrieve(subscriptionId)": EVENT,
  // ME-046: checkSessionStatus retrieves the session by its stored id to check live status before
  // any DB write. The session id is set by create-payment under the same mode key; a test-mode
  // session id under the live key re-throws from checkSessionStatus (no isTestObjectUnderLiveKey
  // check), causing a 500 and a Stripe retry. Money-safe: no DB write precedes this call.
  "stripe-webhook/handlers/paymentIntentPaymentFailed.ts::stripe.checkout.sessions.retrieve(sessionId)":
    "session id written by create-payment under the same mode key; a test id under the live key re-throws (no writes committed before this call), so Stripe retries cleanly",
  // Q1970: the funded-job branch re-reads the same event PaymentIntent live before taking the job
  // out of escrow; piId is the event's own pi.id, routed to that mode's client (Q891).
  "stripe-webhook/handlers/paymentIntentPaymentFailed.ts::stripe.paymentIntents.retrieve(piId)": EVENT,
  // #2, ME-046 fallback: when expand: [payment_intent] is not honoured, retrieve the PI directly.
  // piId = pi.id from the payment_intent.payment_failed event; stripe-webhook routes each event
  // to the client of the event's own mode (Q891), so this cannot be a test id under the live key.
  "stripe-webhook/handlers/paymentIntentPaymentFailed.ts::stripe.paymentIntents.retrieve(piId)#2": EVENT,
  // #3, cancelDeadBankPayment (lane-b-money-1): re-reads the same event PaymentIntent live before
  // cancelling it; piId is the event's own pi.id (every caller passes piId / pi.id), routed to that mode's client (Q891).
  "stripe-webhook/handlers/paymentIntentPaymentFailed.ts::stripe.paymentIntents.retrieve(piId)#3": EVENT,
  "stripe-webhook/handlers/customerSubscriptionDeleted.ts::stripe.customers.retrieve(customerId)": EVENT,
  "stripe-webhook/handlers/customerSubscriptionUpdated.ts::stripe.customers.retrieve(customerId)": EVENT,
  "subscription-reconciliation/index.ts::stripe.customers.retrieve(customerId)":
    "the id comes from this run's own stripe.subscriptions.list under the live key, so it is a live id",
  "subscription-reconciliation/index.ts::stripe.prices.retrieve(priceId)":
    "a Price id from the PRO_PRICE_MAP code constant, not a stored row id: a test Price under the live key means checkout cannot sell, which must stay a visible `caps` finding",
};

describe("every stored-id Stripe retrieve is classified for a test-mode id under the live key (Q891)", () => {
  it("finds the inventory (floor)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(sites.length).toBeGreaterThan(60);
  });

  it("the classified list is exact, both ways", () => {
    const actual = sites.filter((s) => s.classified).map((s) => s.key).sort();
    expect(actual).toEqual([...CLASSIFIED].sort());
  });

  // @mutate supabase/functions/release-payout/index.ts |     if (isUnusableConnectAccountError(e)) { |     if (false) {
  // @mutate supabase/functions/instant-payout/index.ts |       if (!isUnusableConnectAccountError(balanceErr)) throw balanceErr; |       throw balanceErr;
  it("every stored Connect account read goes through the Connect classifier (Q1251), exact both ways", () => {
    const local = sites.filter((s) => !s.classified && s.connectClassified).map((s) => s.key).sort();
    expect(local).toEqual([...CONNECT_CLASSIFIED].sort());
    for (const [k, re] of Object.entries(CONNECT_AT_CALLER)) {
      const site = sites.find((s) => s.key === k);
      expect(site, `${k} still exists`).toBeDefined();
      expect(sources.get(site!.file), `${k}: its caller classifies`).toMatch(re);
    }
  });

  it("the exempt list is exact, both ways: no unlisted unclassified retrieve, no stale entry", () => {
    const actual = sites
      .filter((s) => !s.classified && !s.connectClassified && !(s.key in CONNECT_AT_CALLER))
      .map((s) => s.key)
      .sort();
    expect(actual).toEqual(Object.keys(EXEMPT).sort());
    for (const [k, why] of Object.entries(EXEMPT)) expect(why.length, `${k} needs a reason`).toBeGreaterThan(20);
  });

  it("a skip in a money cron also writes the structured line", () => {
    const missing = sites
      .filter((s) => s.classified && SKIP_LOGGING_FILES.includes(s.file) && !s.logged && !LOGS_AT_CALLER.includes(s.key))
      .map((s) => s.key);
    expect(missing).toEqual([]);
    // seriesCard() only RETURNS kind "test_object"; its one caller writes the line.
    expect(sources.get("charge-recurring-visits/index.ts")).toMatch(
      /card\.kind === "test_object"\)\s*\{\s*logTestObjectUnderLiveKey\(/,
    );
    expect(sites.filter((s) => s.logged).length).toBeGreaterThan(15);
    for (const f of SKIP_LOGGING_FILES) {
      expect(sites.some((s) => s.file === f && s.classified), `SKIP_LOGGING_FILES entry still classifies a retrieve: ${f}`).toBe(true);
    }
  });

  it("every function that classifies imports THE shared classifier and does not shadow it", () => {
    const classifyingFiles = [...new Set(sites.filter((s) => s.classified).map((s) => s.file))];
    expect(classifyingFiles.length).toBeGreaterThan(8);
    for (const f of classifyingFiles) {
      const s = sources.get(f)!;
      const imports = [...s.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/stripeAccountUsable\.ts["']/g)]
        .flatMap((m) => m[1].split(",").map((n) => n.trim()));
      expect(imports, `${f} imports from ${SHARED}`).toContain("isTestObjectUnderLiveKey");
      if (SKIP_LOGGING_FILES.includes(f)) expect(imports, `${f} imports the skip logger`).toContain("logTestObjectUnderLiveKey");
      expect(s, `${f} declares no local stand-in`).not.toMatch(
        /(?:\b(?:const|let|var|function)\s+(?:isTestObjectUnderLiveKey|logTestObjectUnderLiveKey)\b)|\bas\s+isTestObjectUnderLiveKey\b/,
      );
    }
  });
});
