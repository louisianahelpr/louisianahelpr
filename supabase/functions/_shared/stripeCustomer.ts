/**
 * One wallet (owner 2026-10-18, "verify ONCE, use EVERYWHERE"): the ONE way an
 * edge function gets a member's Stripe Customer. Plan:
 * ~/.lh-wt/handoffs-1017/one-wallet-plan.md; table and claim function:
 * supabase/migrations/20261018090700_one_wallet_stripe_customers.sql.
 *
 * 1. Read public.stripe_customers (user, mode). A read error THROWS: the
 *    caller answers "try again" instead of minting a second customer.
 * 2. None stored: create one, keyed by an idempotency key per member and mode
 *    so repeated taps inside Stripe's idempotency window get the same object.
 * 3. Claim it with claim_stripe_customer(): first writer wins, and the id the
 *    function returns is the one used, so racing taps converge.
 *
 * It NEVER searches Stripe by email. Email is not a key in Stripe: a member
 * can own several customers, and an address reused by a new account would
 * inherit the old customer and its saved cards. The email is set on a new
 * customer only so Stripe can send receipts.
 *
 * `mode` must be the mode the caller's Stripe client runs in (from
 * stripeModeForParties / jobMoneyMode): a test customer does not exist under
 * the live key, so the row is per mode.
 *
 * ZERO imports on purpose (the edge test harness runs this real module).
 */

type WalletStripeMode = "live" | "test";

/** The Stripe surface this needs: customers.create only. */
interface CustomerCreator {
  customers: {
    create(
      params: { email?: string; name?: string; metadata?: Record<string, string> },
      options?: { idempotencyKey?: string },
    ): Promise<{ id: string }>;
  };
}

/** The supabase-js surface this needs (service-role client). */
interface WalletDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}

export class StripeCustomerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeCustomerUnavailable";
  }
}

const CUSTOMER_ID_RE = /^cus_[A-Za-z0-9]+$/;

/** The stored customer for (user, mode), or null when none is stored. Throws on a read error. */
export async function storedStripeCustomer(
  admin: WalletDb,
  userId: string,
  mode: WalletStripeMode,
): Promise<string | null> {
  const { data, error } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("wallet_mode", mode)
    .maybeSingle();
  if (error) throw new StripeCustomerUnavailable(`wallet read failed: ${error.message}`);
  const id = (data as { stripe_customer_id?: unknown } | null)?.stripe_customer_id;
  return typeof id === "string" && CUSTOMER_ID_RE.test(id) ? id : null;
}

/** The member's one Stripe customer in `mode`: the stored one, else a new one claimed for them. */
export async function resolveStripeCustomer(
  admin: WalletDb,
  stripe: CustomerCreator,
  user: { id: string; email?: string | null },
  mode: WalletStripeMode,
): Promise<string> {
  const stored = await storedStripeCustomer(admin, user.id, mode);
  if (stored) return stored;

  const created = await stripe.customers.create(
    {
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id, wallet_mode: mode },
    },
    { idempotencyKey: `lh-wallet-customer-${user.id}-${mode}` },
  );
  if (!created?.id || !CUSTOMER_ID_RE.test(created.id)) {
    throw new StripeCustomerUnavailable("Stripe returned no wallet id");
  }
  const { data, error } = await admin.rpc("claim_stripe_customer", {
    p_user: user.id,
    p_mode: mode,
    p_customer: created.id,
  });
  if (error) throw new StripeCustomerUnavailable(`wallet claim failed: ${error.message}`);
  if (typeof data !== "string" || !CUSTOMER_ID_RE.test(data)) {
    throw new StripeCustomerUnavailable("wallet claim returned no id");
  }
  return data;
}
