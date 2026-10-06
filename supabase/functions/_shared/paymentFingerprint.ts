/**
 * Q1324: a banned person's card or payout bank account on a new account bans
 * that account (owner, 2026-10-05).
 *
 * The edge half of public.enforce_retained_payment_ban (migration
 * 20261006014801). Stripe gives every card and every bank account a
 * `fingerprint` that is the same each time the same card / account number is
 * added, on any customer or connected account of this platform. Only that
 * fingerprint is ever sent to the database, which stores a SALTED hash of it
 * (ban_fingerprint), never the value itself and never card or account numbers.
 *
 * Where fingerprints are read:
 *   - the card that PAID: stripe-webhook checkout.session.completed
 *     (handlers/_checkoutCardFingerprint.ts);
 *   - the payout ACCOUNT: stripe-connect `status` (the one writer that sees a
 *     Helpr become payable; prod's endpoint receives no Connect events, Q876)
 *     and stripe-webhook account.updated, both through
 *     enforceConnectAccountFingerprints below.
 *
 * Imports only caughtMessage (itself import-free), so the edge harness loads
 * the REAL module: what is sent to the RPC and how each answer is read stays
 * under test.
 */
import { caughtMessage } from "./caughtMessage.ts";

export type FingerprintKind = "card" | "bank";

/** What the RPC answers, as far as a caller needs it. */
interface PaymentBanVerdict {
  banned: boolean;
  matched_on: FingerprintKind | null;
  already_banned: boolean;
}

/**
 * - `ok`: the RPC ran; `verdict` says whether the account is now banned.
 * - `not_deployed`: the RPC does not exist yet (PGRST202 / 42883: the edge
 *   function deployed before its migration). Callers log it and go on.
 * - `failed`: anything else. The check did NOT run; callers must make that
 *   visible (an ops alert), never read it as "not banned".
 */
export type PaymentBanCheck =
  | { kind: "ok"; verdict: PaymentBanVerdict }
  | { kind: "not_deployed"; message: string }
  | { kind: "failed"; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The checkout metadata keys our own edge functions stamp with the PAYING
 * account's id (always the authenticated caller, never user input):
 * create-payment (customer_id, tipper_id, payer_id), create-boost-payment and
 * pay-onboarding-fee (customer_id), create-bgc-payment and create-pro-checkout
 * (user_id), create-gift-card-checkout (donor_id). `client_reference_id` is
 * the fallback create-pro-checkout also sets.
 */
const CHECKOUT_PAYER_KEYS = ["customer_id", "payer_id", "tipper_id", "user_id", "donor_id"] as const;

export function checkoutPayerId(session: {
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
}): string | null {
  const md = session?.metadata ?? {};
  for (const key of CHECKOUT_PAYER_KEYS) {
    const v = md[key];
    if (typeof v === "string" && UUID_RE.test(v)) return v;
  }
  const ref = session?.client_reference_id;
  return typeof ref === "string" && UUID_RE.test(ref) ? ref : null;
}

/** The card fingerprint of an EXPANDED PaymentMethod; null for an id string or a non-card method. */
export function cardFingerprintOf(paymentMethod: unknown): string | null {
  if (!paymentMethod || typeof paymentMethod !== "object") return null;
  const fp = (paymentMethod as { card?: { fingerprint?: unknown } | null }).card?.fingerprint;
  return typeof fp === "string" && fp.trim() !== "" ? fp : null;
}

/**
 * Fingerprints of a connected account's external accounts: a bank account is
 * `bank`, a payout debit card is `card` (the same card namespace a payment
 * card uses). Unknown objects and blank fingerprints are skipped.
 */
function externalAccountFingerprints(
  externalAccounts: unknown,
): Array<{ kind: FingerprintKind; fingerprint: string }> {
  const out: Array<{ kind: FingerprintKind; fingerprint: string }> = [];
  if (!Array.isArray(externalAccounts)) return out;
  const seen = new Set<string>();
  for (const ea of externalAccounts) {
    if (!ea || typeof ea !== "object") continue;
    const { object, fingerprint } = ea as { object?: unknown; fingerprint?: unknown };
    if (typeof fingerprint !== "string" || fingerprint.trim() === "") continue;
    const kind: FingerprintKind | null = object === "bank_account" ? "bank" : object === "card" ? "card" : null;
    if (!kind || seen.has(`${kind}:${fingerprint}`)) continue;
    seen.add(`${kind}:${fingerprint}`);
    out.push({ kind, fingerprint });
  }
  return out;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

/** Record one fingerprint for `userId` and apply any retained ban it matches. */
export async function enforcePaymentFingerprint(
  supabase: RpcClient,
  userId: string,
  kind: FingerprintKind,
  fingerprint: string,
): Promise<PaymentBanCheck> {
  let res: Awaited<ReturnType<RpcClient["rpc"]>>;
  try {
    res = await supabase.rpc("enforce_retained_payment_ban", {
      p_user_id: userId,
      p_kind: kind,
      p_stripe_fingerprint: fingerprint,
    });
  } catch (err) {
    return { kind: "failed", message: caughtMessage(err, "rpc threw") };
  }
  const { data, error } = res;
  if (error) {
    const message = error.message ?? "unknown error";
    if (error.code === "PGRST202" || error.code === "42883") return { kind: "not_deployed", message };
    return { kind: "failed", message };
  }
  const d = data as { banned?: unknown; matched_on?: unknown; already_banned?: unknown } | null;
  if (!d || typeof d.banned !== "boolean") {
    // A null error with no verdict is not a "not banned".
    return { kind: "failed", message: "enforce_retained_payment_ban returned no verdict" };
  }
  return {
    kind: "ok",
    verdict: {
      banned: d.banned,
      matched_on: d.matched_on === "card" || d.matched_on === "bank" ? d.matched_on : null,
      already_banned: d.already_banned === true,
    },
  };
}

type ExternalAccountLister = {
  accounts: {
    // deno-lint-ignore no-explicit-any
    listExternalAccounts: (id: string, params: any) => PromiseLike<unknown>;
  };
};

/**
 * Every external account on a connected account, checked. Reads the list the
 * account object already carries (Stripe returns `external_accounts` to the
 * platform that controls the account) and lists them only when it does not.
 *
 * - `banned`: at least one matched; the account is now banned.
 * - `clear`: every fingerprint was checked (or there were none).
 * - `not_deployed`: the RPC is missing; nothing was checked.
 * - `failed`: the list or a check failed; `message` says which. The caller
 *   must not treat this as clear.
 */
export type ConnectFingerprintOutcome =
  | { kind: "banned"; matched_on: FingerprintKind; already_banned: boolean; checked: number }
  | { kind: "clear"; checked: number }
  | { kind: "not_deployed"; message: string }
  | { kind: "failed"; message: string };

export async function enforceConnectAccountFingerprints(
  stripe: ExternalAccountLister,
  supabase: RpcClient,
  userId: string,
  account: { id: string; external_accounts?: { data?: unknown } | null },
): Promise<ConnectFingerprintOutcome> {
  let list: unknown = account.external_accounts?.data;
  if (!Array.isArray(list)) {
    try {
      const res = (await stripe.accounts.listExternalAccounts(account.id, { limit: 100 })) as
        | { data?: unknown }
        | undefined;
      list = res?.data ?? [];
    } catch (err) {
      return {
        kind: "failed",
        message: `could not list external accounts for ${account.id}: ${caughtMessage(err, "list threw")}`,
      };
    }
  }
  const fps = externalAccountFingerprints(list);
  let banned: { matched_on: FingerprintKind; already_banned: boolean } | null = null;
  for (const { kind, fingerprint } of fps) {
    const r = await enforcePaymentFingerprint(supabase, userId, kind, fingerprint);
    if (r.kind === "not_deployed") return r;
    if (r.kind === "failed") return { kind: "failed", message: `${kind} check failed: ${r.message}` };
    if (r.verdict.banned && !banned) {
      banned = { matched_on: r.verdict.matched_on ?? kind, already_banned: r.verdict.already_banned };
    }
  }
  if (banned) return { kind: "banned", ...banned, checked: fps.length };
  return { kind: "clear", checked: fps.length };
}
