// connectReadiness — the ONE answer to "will Stripe take a TRANSFER to this
// Connect account right now?" for the money crons (declutter-money's seller,
// delivery-Helpr and shop payout loops; /code-review of f6551863a).
//
// transferReady = the account's transfers capability is "active". That is what
// Stripe needs to accept a transfer. It is NOT the payout gate: payouts_enabled
// (the account can pay out to its bank) is a separate rule, cached on
// profiles.stripe_payouts_enabled by connectGateSync and read by release-payout
// (jobs), which requires payouts_enabled AND charges_enabled for its own reasons.
// A transfer to an account whose bank payouts are paused still lands in its
// Stripe balance.
//
// declutter-money reads it live before every transfer, AFTER the reconcile and
// the charge check; a not-ready payee's row is deferred without using a try
// (payout_defer, 20261019070737).
//
// A failed read NEVER counts as a failed payout try:
//   unusable   the account is gone (404 "No such account") / a sandbox account
//              under the live key (isUnusableConnectAccountError). A 403 /
//              account_invalid / "does not have access" is NOT unusable: it is an
//              access error (see below).
//   error      transient = a real Stripe connection error, 429 or 5xx: retried
//              quietly. Anything else (401/403 on OUR key, or an error with no
//              Stripe status at all, i.e. a code bug) is the PLATFORM's fault:
//              the caller defers quietly and alerts ops once per mode per day,
//              never a payee wait or reminder.
// One read per (Stripe mode, account) per run (the caller passes the run's cache).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { isUnusableConnectAccountError } from "../_shared/stripeAccountUsable.ts";

export type ConnectReadiness =
  | { kind: "ready"; account: Stripe.Account }
  | { kind: "not_ready"; account: Stripe.Account; reason: string; category: "setup_unfinished" | "under_review" | "rejected" }
  | { kind: "unusable"; reason: string }
  | { kind: "error"; message: string; transient: boolean; accountSpecific: boolean };

/** Stripe will accept a transfer to this account: its transfers capability is active. */
export function transferReady(account: Pick<Stripe.Account, "capabilities"> | null | undefined): boolean {
  return account?.capabilities?.transfers === "active";
}

/** A real Stripe connection failure, rate limit or server error (retry later, quietly). */
export function isTransientStripeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { type?: unknown; statusCode?: unknown };
  if (e.type === "StripeConnectionError" || e.type === "StripeRateLimitError") return true;
  return typeof e.statusCode === "number" && (e.statusCode === 429 || e.statusCode >= 500);
}

/**
 * Why an account is not ready: rejected by Stripe (no waiting fixes it), under Stripe's
 * review (transfers "pending": nothing for the payee to do), or setup unfinished.
 */
function notReadyReason(account: Stripe.Account): { reason: string; category: "setup_unfinished" | "under_review" | "rejected" } {
  const disabled = account.requirements?.disabled_reason ?? null;
  const transfers = account.capabilities?.transfers ?? "missing";
  const category = typeof disabled === "string" && disabled.startsWith("rejected") ? "rejected"
    : transfers === "pending" ? "under_review" : "setup_unfinished";
  return { reason: `transfers ${transfers}${disabled ? `, ${disabled}` : ""}`.slice(0, 200), category };
}

export type ReadinessCache = Map<string, Promise<ConnectReadiness>>;
const cacheKey = (mode: string, accountId: string) => `${mode}:${accountId}`;

/** This run's answer for an account, if it was already read (no Stripe call). */
export function peekConnectReadiness(cache: ReadinessCache, mode: string, accountId: string): Promise<ConnectReadiness> | undefined {
  return cache.get(cacheKey(mode, accountId));
}

/** Read one account's readiness, once per run per (mode, account). Never throws. */
export function readConnectReadiness(stripe: Stripe, mode: string, accountId: string, cache: ReadinessCache): Promise<ConnectReadiness> {
  const key = cacheKey(mode, accountId);
  const hit = cache.get(key);
  if (hit) return hit;
  const read = (async (): Promise<ConnectReadiness> => {
    try {
      const account = await stripe.accounts.retrieve(accountId);
      if (transferReady(account)) return { kind: "ready", account };
      return { kind: "not_ready", account, ...notReadyReason(account) };
    } catch (e) {
      const message = String((e as { message?: string })?.message ?? e).slice(0, 200);
      const status = (e as { statusCode?: unknown })?.statusCode;
      const code = (e as { code?: unknown })?.code;
      // Stripe's "does not have access to account 'acct_…' (or that account does not exist)": the
      // account was deauthorized or deleted for this platform. That payee's account is gone:
      // unusable (held, "set up payouts again"), not our key.
      if (/does not have access to account/i.test(message) && /does not exist/i.test(message)) {
        return { kind: "unusable", reason: `account_unusable: ${message}`.slice(0, 200) };
      }
      // Any other 403 / account_invalid / "does not have access": an ACCESS error. accountSpecific
      // when the error names this account (the caller counts those per account and only blames
      // our key after several AND a failed platform read); otherwise it is the key itself.
      if (status === 403 || status === 401 || code === "account_invalid" || /does not have access/i.test(message)) {
        return { kind: "error", message, transient: false, accountSpecific: message.includes(accountId) };
      }
      // A 404 "No such account" (or a sandbox account under the live key) is unusable.
      if (isUnusableConnectAccountError(e)) return { kind: "unusable", reason: `account_unusable: ${message}`.slice(0, 200) };
      return { kind: "error", message, transient: isTransientStripeError(e), accountSpecific: message.includes(accountId) };
    }
  })();
  cache.set(key, read);
  return read;
}
