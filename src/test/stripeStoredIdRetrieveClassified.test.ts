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
 * @mutate supabase/functions/auto-resolve-disputes/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/charge-recurring-visits/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/execute-dispute-split/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/money-reconciliation/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/release-payout/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/void-cancelled-payments/index.ts | import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false; const logTestObjectUnderLiveKey = (..._a: unknown[]) => {};
 * @mutate supabase/functions/release-payout/index.ts | if (isTestObjectUnderLiveKey(e)) {\n          logTestObjectUnderLiveKey("release-payout", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | if (false) {\n          logTestObjectUnderLiveKey("release-payout", { job_id: job.id, object: "payment_intent", id: paymentIntentId });
 * @mutate supabase/functions/release-payout/index.ts | logTestObjectUnderLiveKey("release-payout", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | void 0;
 * @mutate supabase/functions/charge-recurring-visits/index.ts | if (card.kind === "test_object") { | if (card.kind === "test_object") { void 0;
 * @mutate supabase/functions/create-payment/index.ts | import { isTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false;
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

/** The brace-balanced body of the first `catch` at or after `from`, or null. */
function catchBodyAfter(s: string, from: number): string | null {
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

interface Site { key: string; file: string; classified: boolean; logged: boolean }

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
    });
  }
}

/** Functions whose skip must also write the structured line. */
// @two-way src/test/stripeStoredIdRetrieveClassified.test.ts:SKIP_LOGGING_FILES entry still classifies a retrieve
const SKIP_LOGGING_FILES = [
  "auto-release-payment/index.ts",
  "auto-resolve-disputes/index.ts",
  "charge-recurring-visits/index.ts",
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
  "auto-release-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "auto-release-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "auto-resolve-disputes/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "auto-resolve-disputes/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "auto-resolve-disputes/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2",
  "charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(pi)",
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(previousSessionId)",
  "create-payment/index.ts::stripe.paymentIntents.retrieve(cancelPaymentIntentId)",
  "execute-dispute-split/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "execute-dispute-split/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "execute-dispute-split/index.ts::stripe.transfers.retrieve(dispute.execution_transfer_id)",
  "money-reconciliation/index.ts::stripe.paymentIntents.retrieve(piId)",
  "process-scheduled-payouts/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "process-scheduled-payouts/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "release-payout/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
  "release-payout/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)",
  "void-cancelled-payments/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id!)",
  "void-cancelled-payments/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id!)#2",
  "void-cancelled-payments/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)",
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
const ACCOUNT =
  "a Connect account id: Stripe answers a test account under the live key with a different sentence ('test account created with a testmode key', see isUnusableConnectAccountError), not the one isTestObjectUnderLiveKey matches. STILL OPEN: Q891 follow-up";
const EVENT =
  "an id taken from a Stripe webhook event, and stripe-webhook/index.ts refuses an event whose livemode differs from the key's mode, so it is of this key's mode";
const PLATFORM = "reads the platform's own account/balance, not a stored id";

/** The retrieves that do NOT go through it, each with why: EXACT. */
// @two-way src/test/stripeStoredIdRetrieveClassified.test.ts:toEqual(Object.keys(EXEMPT).sort())
const EXEMPT: Record<string, string> = {
  "charge-recurring-visits/index.ts::stripe.paymentIntents.retrieve(intent.id)": FRESH,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#2": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#3": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#4": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(job.stripe_session_id)#5": OUTER,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(previousSessionId)#2": REREAD,
  "create-payment/index.ts::stripe.checkout.sessions.retrieve(row.stripe_session_id)": ABSENT,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(captureResult.paymentIntentId)": REREAD,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#3": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#4": OUTER,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#5": REREAD,
  "create-payment/index.ts::stripe.paymentIntents.retrieve(priorPi.id)": REREAD,
  "execute-dispute-split/index.ts::stripe.accounts.retrieve(helper.stripe_account_id)": ACCOUNT,
  "execute-dispute-split/index.ts::stripe.charges.retrieve(charge)": REREAD,
  "execute-dispute-split/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": REREAD,
  "instant-payout/index.ts::stripe.accounts.retrieve()": PLATFORM,
  "instant-payout/index.ts::stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id })": ACCOUNT,
  "process-scheduled-payouts/index.ts::stripe.paymentIntents.retrieve(paymentIntentId)#2": REREAD,
  // Q1221: the held Helpr's Connect account, read for its payout schedule.
  "payout-hold-stripe-sync/index.ts::stripe.accounts.retrieve(accountId)": ACCOUNT,
  "release-payout/index.ts::stripe.accounts.retrieve(helper.stripe_account_id)": ACCOUNT,
  "stripe-connect/index.ts::stripe.accounts.retrieve(accountId)": ACCOUNT,
  "stripe-connect/index.ts::stripe.accounts.retrieve(created.id)": FRESH,
  "stripe-connect/index.ts::stripe.accounts.retrieve(profile.stripe_account_id)": ACCOUNT,
  "stripe-connect/index.ts::stripe.accounts.retrieve(profile.stripe_account_id)#2": ACCOUNT,
  "stripe-connect/index.ts::stripe.accounts.retrieve(profile.stripe_account_id)#3": ACCOUNT,
  "stripe-idv-start/index.ts::stripe.identity.verificationSessions.retrieve(profile.idv_session_id)": ABSENT,
  "stripe-idv-webhook/index.ts::stripe.identity.verificationSessions.retrieve(session.id)": EVENT,
  "stripe-payouts/index.ts::stripe.accounts.retrieve(accountId)": ACCOUNT,
  "stripe-payouts/index.ts::stripe.balance.retrieve({ stripeAccount: accountId })": ACCOUNT,
  "_shared/chargebackClawback.ts::stripe.transfers.retrieve(id)": EVENT,
  // Q1222: holdBackPaidTip runs only from checkout.session.completed; the
  // PaymentIntent is the event session's, the transfer that charge's.
  "_shared/heldTipRepay.ts::stripe.paymentIntents.retrieve(args.paymentIntentId)": EVENT,
  "_shared/heldTipRepay.ts::stripe.transfers.retrieve(transferId)": EVENT,
  // Q1324: the card that paid this event's own session.
  "stripe-webhook/handlers/_checkoutCardFingerprint.ts::stripe.paymentIntents.retrieve(session.payment_intent)": EVENT,
  "stripe-webhook/handlers/_checkoutCardFingerprint.ts::stripe.subscriptions.retrieve(session.subscription)": EVENT,
  "stripe-webhook/handlers/accountUpdated.ts::stripe.accounts.retrieve(account.id)": EVENT,
  "stripe-webhook/handlers/accountUpdated.ts::stripe.accounts.retrieve(accountId)": EVENT,
  "stripe-webhook/handlers/chargeDisputeClosed.ts::stripe.charges.retrieve(chargeId)": EVENT,
  "stripe-webhook/handlers/chargeRefundUpdated.ts::stripe.charges.retrieve(chargeId)": EVENT,
  "stripe-webhook/handlers/chargeDisputeClosed.ts::stripe.charges.retrieve(closedDispute.charge as string)": EVENT,
  "stripe-webhook/handlers/chargeDisputeCreated.ts::stripe.charges.retrieve(dispute.charge as string)": EVENT,
  "stripe-webhook/handlers/checkoutSessionCompleted.ts::stripe.paymentIntents.retrieve(piId)": EVENT,
  "stripe-webhook/handlers/checkoutSessionCompleted.ts::stripe.subscriptions.retrieve(subscriptionId)": EVENT,
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

  it("the exempt list is exact, both ways: no unlisted unclassified retrieve, no stale entry", () => {
    const actual = sites.filter((s) => !s.classified).map((s) => s.key).sort();
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
