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

/** The Stripe surface this needs: customers.create (and customers.search, only to adopt a tagged customer). */
interface CustomerCreator {
  customers: {
    create(
      params: { email?: string; name?: string; metadata?: Record<string, string> },
      options?: { idempotencyKey?: string },
    ): Promise<{ id: string }>;
    search?(params: { query: string; limit?: number }): Promise<{
      data: Array<{
        id: string; created?: number; deleted?: unknown; metadata?: Record<string, string> | null;
        invoice_settings?: { default_payment_method?: unknown } | null;
      }>;
    }>;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Q2139: a member who paid for a job before the wallet existed already has a
 * Stripe customer that create-payment made and TAGGED with their user id
 * (metadata.supabase_user_id), holding the card they saved. It is adopted by
 * that exact tag, NEVER by email (an email can belong to a deleted member's
 * customer). The search runs under the caller's mode key, so it only sees
 * that mode's customers. Newest exact match wins. A search that fails returns
 * null (a fresh customer is made instead: no card is charged wrongly, the
 * member just saves a card again).
 */
async function adoptTaggedCustomer(stripe: CustomerCreator, userId: string): Promise<string | null> {
  if (!stripe.customers.search || !UUID_RE.test(userId)) return null;
  try {
    const found = await stripe.customers.search({ query: `metadata['supabase_user_id']:'${userId}'`, limit: 100 });
    const mine = (found?.data ?? [])
      // A customer that already HAS a default card is never adopted: its default
      // was set outside a save (the Pro billing portal), and the wallet default
      // is the off-session consent auto-tip charges (lh-money-escrow review of 05df69882 #3).
      .filter((c) => !c.deleted && c.metadata?.supabase_user_id === userId && CUSTOMER_ID_RE.test(c.id)
        && !c.invoice_settings?.default_payment_method)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    return mine[0]?.id ?? null;
  } catch (err) {
    console.error(`[stripeCustomer] tagged-customer search failed for ${userId}; making a new wallet customer: ${(err as { message?: unknown } | null)?.message ?? "unknown error"}`);
    return null;
  }
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
async function resolveStripeCustomer(
  admin: WalletDb,
  stripe: CustomerCreator,
  user: { id: string; email?: string | null },
  mode: WalletStripeMode,
  options: { adoptTagged?: boolean } = {},
): Promise<string> {
  const stored = await storedStripeCustomer(admin, user.id, mode);
  if (stored) return stored;

  let candidate = options.adoptTagged ? await adoptTaggedCustomer(stripe, user.id) : null;
  if (!candidate) {
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
    candidate = created.id;
  }
  const { data, error } = await admin.rpc("claim_stripe_customer", {
    p_user: user.id,
    p_mode: mode,
    p_customer: candidate,
  });
  if (error) throw new StripeCustomerUnavailable(`wallet claim failed: ${error.message}`);
  if (typeof data !== "string" || !CUSTOMER_ID_RE.test(data)) {
    throw new StripeCustomerUnavailable("wallet claim returned no id");
  }
  return data;
}

/**
 * Q2140: Stripe refused `customerId` because it no longer exists (deleted in the Dashboard, or test data wiped):
 * `resource_missing` naming the customer. Any other error is not this.
 */
export function isMissingCustomerError(err: unknown, customerId: string): boolean {
  const e = err as { code?: unknown; param?: unknown; message?: unknown; raw?: { code?: unknown; param?: unknown } } | null;
  const code = e?.code ?? e?.raw?.code;
  if (code !== "resource_missing") return false;
  const param = e?.param ?? e?.raw?.param;
  return param === "customer" || (typeof e?.message === "string" && e.message.includes(customerId));
}

/**
 * Q2140: run `fn` with the member's wallet customer. No extra Stripe call on the happy path (owner: nothing slow).
 * ONLY when Stripe answers that the stored customer is missing does it make a new customer, swap it in with the
 * guarded replace_stripe_customer (20261103053759: only while the dead id is still the stored one; the dead
 * Declutter card goes with it), and run `fn` ONCE more. A failure while replacing throws StripeCustomerUnavailable
 * ("try again"); any other error from `fn` is rethrown as it was.
 */
export async function withWalletCustomer<T>(
  admin: WalletDb,
  stripe: CustomerCreator,
  user: { id: string; email?: string | null },
  mode: WalletStripeMode,
  /** `walletRetry` is true on the one retry: a caller with a fixed idempotency key changes it, as the params changed. */
  fn: (customerId: string, walletRetry: boolean) => Promise<T>,
  options: { adoptTagged?: boolean } = {},
): Promise<T> {
  const customerId = await resolveStripeCustomer(admin, stripe, user, mode, options);
  return await replacingDeadCustomer(admin, stripe, user, mode, customerId, fn);
}

/**
 * Q2140, the pre-fill callers (declutter-checkout's order, raise and tip pages, shop-checkout): they never make a
 * wallet customer, they only pre-fill the page with the stored one. `customerId` is the caller's own
 * storedStripeCustomer read; with none stored, `fn` runs once with undefined and nothing is made in Stripe. A stored
 * customer Stripe no longer has is replaced and `fn` retried once, exactly as withWalletCustomer does.
 */
export async function withStoredWalletCustomer<T>(
  admin: WalletDb,
  stripe: CustomerCreator,
  user: { id: string; email?: string | null },
  mode: WalletStripeMode,
  customerId: string | undefined,
  fn: (customerId: string | undefined, walletRetry: boolean) => Promise<T>,
): Promise<T> {
  if (!customerId) return await fn(undefined, false);
  return await replacingDeadCustomer(admin, stripe, user, mode, customerId, fn);
}

async function replacingDeadCustomer<T>(
  admin: WalletDb,
  stripe: CustomerCreator,
  user: { id: string; email?: string | null },
  mode: WalletStripeMode,
  customerId: string,
  fn: (customerId: string, walletRetry: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await fn(customerId, false);
  } catch (err) {
    if (!isMissingCustomerError(err, customerId)) throw err;
    console.warn(`[stripeCustomer] wallet customer ${customerId} (${mode}) is gone in Stripe; replacing it for ${user.id}.`);
    let created: { id: string };
    try {
      created = await stripe.customers.create(
        { email: user.email ?? undefined, metadata: { supabase_user_id: user.id, wallet_mode: mode } },
        { idempotencyKey: `lh-wallet-customer-${user.id}-${mode}-after-${customerId}` },
      );
    } catch (createErr) {
      throw new StripeCustomerUnavailable(`replacement wallet create failed: ${(createErr as { message?: unknown } | null)?.message ?? "unknown error"}`);
    }
    if (!created?.id || !CUSTOMER_ID_RE.test(created.id)) throw new StripeCustomerUnavailable("Stripe returned no replacement wallet id");
    const { data, error } = await admin.rpc("replace_stripe_customer", {
      p_user: user.id,
      p_mode: mode,
      p_old: customerId,
      p_new: created.id,
    });
    if (error) throw new StripeCustomerUnavailable(`wallet replace failed: ${error.message}`);
    if (typeof data !== "string" || !CUSTOMER_ID_RE.test(data) || data === customerId) {
      throw new StripeCustomerUnavailable("wallet replace returned no new id");
    }
    return await fn(data, true);
  }
}
