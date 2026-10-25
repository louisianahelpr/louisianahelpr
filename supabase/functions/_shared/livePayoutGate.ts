// livePayoutGate — "may a payout be SENT to this Connect account right now?",
// answered from ONE live Stripe read, and the one towards-false write of the
// cached gate on profiles.
//
// Why (lead, 2026-10-23): Stripe rejected the platform account (~07:33Z) and
// every connected account with it. Measured from function_logs 2026-10-23:
// stripe-connect answers "You cannot create new accounts because your account
// has been rejected." and "An account link cannot be created for this account
// because the account has been rejected." Prod's webhook receives no Connect
// events (Q876), so profiles kept stripe_payouts_enabled = true for 13 of the
// 34 profiles with an account (measured read-only 2026-10-23), and
// process-scheduled-payouts read no live state at all before its transfer.
//
// The rule: a payout goes out only when the live read SUCCEEDS and says the
// account is payable (payouts_enabled, charges_enabled, transfers capability
// active, not rejected). Anything else holds the payout without calling
// transfers.create:
//   not_payable       the read worked and the account is not payable;
//   rejected          the read worked and Stripe rejected the account, OR the
//                     read failed with "the account has been rejected";
//   unusable          the account is gone, or is a sandbox account under the
//                     live key (isUnusableConnectAccountError);
//   platform_rejected the read failed with "YOUR account has been rejected":
//                     Stripe refusing OUR platform, which says nothing about
//                     this Helpr's account (lead: "cannot verify");
//   cannot_verify     any other failed read (outage, rate limit, our key
//                     refused): never read as payable.
// Only `rejected` and `unusable` close the cached gate (closeCachedConnectGate):
// they are facts about the account. not_payable is left to the scheduled
// refresh (syncConnectGate), so the two writers never disagree on an account
// whose transfers capability alone is off (lh-money-escrow review #3); the
// unverifiable kinds leave the cache as it is.
// No remote import on purpose: src/test/livePayoutGateClassifiesRejections.test.ts
// imports this module, so the app project compiles it (tsconfig.app.json lists
// it). The Stripe shapes it reads are declared structurally below.
import { isTestObjectUnderLiveKey, isUnusableConnectAccountError } from "../_shared/stripeAccountUsable.ts";

/**
 * release-payout's 409 codes for a payout it refused before any transfer
 * because Stripe does not say the account is payable. auto-release-payment
 * reads them as a HELD payout (like PAYOUT_HELD_CODE), not a failed attempt:
 * ops are told once a day per Helpr here, so no give-up page per job.
 */
export const CONNECT_REJECTED_CODE = "connect_account_rejected";
export const CONNECT_NOT_PAYABLE_CODE = "connect_account_not_payable";
export const STRIPE_PLATFORM_REJECTED_CODE = "stripe_platform_rejected";
/**
 * The Helpr has no payout account yet (owner 2026-10-25: payout setup moved to
 * after the hire, so this is a normal wait, not a failed attempt; lh-money-escrow
 * review #1). release-payout answers it before any Stripe call.
 */
export const CONNECT_MISSING_CODE = "connect_account_missing";
export const CONNECT_HELD_CODES: ReadonlySet<string> = new Set([CONNECT_REJECTED_CODE, CONNECT_NOT_PAYABLE_CODE, STRIPE_PLATFORM_REJECTED_CODE, CONNECT_MISSING_CODE]);

/** The fields of a Stripe Account this module reads (Stripe.Account satisfies it). */
export interface ConnectAccountFacts {
  id?: string;
  payouts_enabled?: boolean | null;
  charges_enabled?: boolean | null;
  capabilities?: { transfers?: string | null } | null;
  requirements?: { disabled_reason?: string | null } | null;
}

/** The one Stripe call this module makes (a Stripe client satisfies it). */
export interface ConnectAccountReader {
  accounts: { retrieve(id: string): Promise<unknown> };
}

export type LivePayoutGate =
  | { ok: true; account: ConnectAccountFacts }
  | { ok: false; kind: "not_payable" | "rejected" | "unusable" | "platform_rejected" | "cannot_verify"; reason: string };

function messageOf(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/**
 * Stripe refusing OUR platform: "You cannot create new accounts because your
 * account has been rejected." (measured, function_logs 2026-10-23). Matched on
 * the wording, which is all Stripe gives (stripe_code was undefined).
 */
export function isPlatformRejectedError(err: unknown): boolean {
  return /\byour account has been rejected\b/i.test(messageOf(err));
}

/**
 * Stripe refusing a CONNECTED account as rejected: "An account link cannot be
 * created for this account because the account has been rejected."
 * (measured, function_logs 2026-10-23). Never the platform's own wording.
 */
export function isRejectedAccountError(err: unknown): boolean {
  const message = messageOf(err);
  return /\bhas been rejected\b/i.test(message) && !isPlatformRejectedError(err);
}

/** Stripe rejected this account (requirements.disabled_reason "rejected.*"). */
export function isRejectedAccount(account: Pick<ConnectAccountFacts, "requirements"> | null | undefined): boolean {
  const reason = account?.requirements?.disabled_reason;
  return typeof reason === "string" && reason.startsWith("rejected");
}

/** The live account may receive a payout: every fact true, and not rejected. */
function livePayable(account: ConnectAccountFacts): boolean {
  return account.payouts_enabled === true &&
    account.charges_enabled === true &&
    account.capabilities?.transfers === "active" &&
    !isRejectedAccount(account);
}

function errMessage(e: unknown): string {
  return String((e as { message?: unknown })?.message ?? e).slice(0, 200);
}

/** Read one account live and decide. Never throws. */
export async function readLivePayoutGate(stripe: ConnectAccountReader, accountId: string): Promise<LivePayoutGate> {
  let account: ConnectAccountFacts;
  try {
    account = (await stripe.accounts.retrieve(accountId)) as ConnectAccountFacts;
  } catch (e) {
    const message = errMessage(e);
    if (isPlatformRejectedError(e)) return { ok: false, kind: "platform_rejected", reason: message };
    if (isRejectedAccountError(e)) return { ok: false, kind: "rejected", reason: message };
    // A test-mode OBJECT id under the live key is a stored-id mismatch, not a fact
    // about a live account: it is not "unusable" here, only unverifiable.
    if (!isTestObjectUnderLiveKey(e) && isUnusableConnectAccountError(e)) return { ok: false, kind: "unusable", reason: message };
    return { ok: false, kind: "cannot_verify", reason: message };
  }
  if (!account || typeof account !== "object") return { ok: false, kind: "cannot_verify", reason: "Stripe returned no account" };
  if (livePayable(account)) return { ok: true, account };
  const disabled = account.requirements?.disabled_reason ?? null;
  const reason = `payouts_enabled=${account.payouts_enabled === true}, charges_enabled=${account.charges_enabled === true}, transfers=${account.capabilities?.transfers ?? "missing"}${disabled ? `, ${disabled}` : ""}`;
  return { ok: false, kind: isRejectedAccount(account) ? "rejected" : "not_payable", reason };
}

/** A hold that is a FACT that this account can never be paid as it stands. */
export function holdClosesCache(gate: LivePayoutGate): boolean {
  return !gate.ok && (gate.kind === "rejected" || gate.kind === "unusable");
}

/**
 * Close the cached payout gate on profiles: charges and payouts to false.
 * TOWARDS FALSE ONLY: it never writes true, and it matches only a row that
 * still points at `accountId` (a Helpr who replaced their account meanwhile is
 * not touched) and still reads either flag true (zero rows = already closed,
 * legitimate). Identity is not touched: it is a fact about the person, which a
 * rejected platform does not change. Returns the error message, or null.
 */
export async function closeCachedConnectGate(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  userId: string,
  accountId: string,
): Promise<{ closed: boolean; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ stripe_charges_enabled: false, stripe_payouts_enabled: false })
    .eq("user_id", userId)
    .eq("stripe_account_id", accountId)
    .or("stripe_charges_enabled.eq.true,stripe_payouts_enabled.eq.true")
    .select("id");
  if (error) return { closed: false, error: String(error.message ?? error) };
  return { closed: (data?.length ?? 0) > 0, error: null };
}
