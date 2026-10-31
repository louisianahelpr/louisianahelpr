/**
 * Test double for the Stripe SDK used by the Supabase edge functions.
 *
 * The real edge functions import Stripe from `https://esm.sh/stripe@18.5.0`.
 * The edge-function test harness (`../harness.ts`) rewrites that import to
 * point here so the Stripe branches can be exercised without network calls
 * or real API keys.
 *
 * Every method is a `vi.fn()` so individual tests can stub return values and
 * assert on call arguments. `createStripeMock()` returns a fresh instance per
 * test; the default export is the constructor the function code calls as
 * `new Stripe(key, opts)`.
 */
import { vi } from "vitest";

export interface StripeMock {
  /** The key the function constructed Stripe with — lets tests assert key mode. */
  __key: string;
  /** EVERY key a client was constructed with, in order (a function may build one per Stripe mode). */
  __keys: string[];
  __opts: unknown;
  /**
   * Opt-in (default false): when true, each `new Stripe(key)` returns a view of
   * this mock that records `{ key, method }` in `__calls` for every mocked
   * method called through it, so a test can tell WHICH client made a call (a
   * function that builds a live and a test client). Off, every client is this
   * one shared object, exactly as before.
   */
  __trackClients: boolean;
  __calls: Array<{ key: string; method: string }>;
  /** Shops M1b part 2: shop-checkout makes Stripe Tax locations through rawRequest (stripe@18.5.0 has no tax.locations). */
  rawRequest: ReturnType<typeof vi.fn>;
  customers: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  checkout: {
    sessions: {
      create: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
      /**
       * `checkout.sessions.expire` — create-payment calls it before minting a
       * replacement session for an unfunded job, so that an abandoned-but-still-
       * open checkout can never be paid alongside its successor.
       */
      expire: ReturnType<typeof vi.fn>;
      listLineItems: ReturnType<typeof vi.fn>;
      /** Q2082 (a): chargeTaxCentsFor reads a charge's tax from its Checkout Session. Unset = no session. */
      list: ReturnType<typeof vi.fn>;
    };
  };
  paymentIntents: {
    retrieve: ReturnType<typeof vi.fn>;
    /**
     * Off-session charge creation. auto-tip-charge is the only caller — it
     * confirms a saved card with no user present — and without this the whole
     * successful-charge path of that function was unreachable in tests: the
     * missing property threw inside the function's own try/catch, so every
     * scenario silently took the `giveUp()` decline branch instead.
     */
    create: ReturnType<typeof vi.fn>;
    /** Q202: an abandoned 3D Secure challenge's PaymentIntent is canceled on re-mint. */
    cancel: ReturnType<typeof vi.fn>;
    /** Q415 (e): charge-recurring-visits tags an intent whose refund withholds the fee. */
    update: ReturnType<typeof vi.fn>;
    /** Q1104: charge-recurring-visits asks for a prior visit charge before minting one. Defaults to none. */
    list: ReturnType<typeof vi.fn>;
    /** Q1345: void-cancelled-payments captures only the fee on an uncaptured hold. */
    capture: ReturnType<typeof vi.fn>;
  };
  /** Saved-card lookup — what makes an off-session auto-tip possible at all. */
  paymentMethods: {
    list: ReturnType<typeof vi.fn>;
  };
  /** Declutter card on file: the webhook reads the saved card off the setup page's SetupIntent. */
  setupIntents: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  refunds: {
    create: ReturnType<typeof vi.fn>;
    /** Used to derive the partial-refund idempotency sequence (see
     *  create-payment admin_refund_general). Defaults to an empty list. */
    list: ReturnType<typeof vi.fn>;
    /** Q1732: execute-dispute-split's clear_test_mode_records asks Stripe about each recorded refund. */
    retrieve: ReturnType<typeof vi.fn>;
  };
  transfers: {
    create: ReturnType<typeof vi.fn>;
    /**
     * Prior-transfer lookup. `execute-dispute-split` asks Stripe directly on a
     * RESUME whether it already paid the Helpr, because the `payout_transfers`
     * ledger is exactly the record that can be missing (transfer succeeded,
     * ledger write failed) and Stripe's idempotency key stops protecting
     * anything after ~24h. Defaults to "no prior transfers".
     */
    list: ReturnType<typeof vi.fn>;
    /** Verifies a transfer id stamped on the dispute row actually exists. */
    retrieve: ReturnType<typeof vi.fn>;
    /** Card-dispute clawback (Q202): stripe.transfers.createReversal. */
    createReversal: ReturnType<typeof vi.fn>;
    /** Q202: a resumed clawback asks Stripe whether the reversal already happened. */
    listReversals: ReturnType<typeof vi.fn>;
  };
  accounts: {
    retrieve: ReturnType<typeof vi.fn>;
    /** stripe-connect `list_payout_methods` / `delete_payout_method` (Q859). */
    listExternalAccounts: ReturnType<typeof vi.fn>;
    deleteExternalAccount: ReturnType<typeof vi.fn>;
    /** stripe-connect `reset` deletes the old account, then `getOrCreateAccount` creates one (Q861). */
    del: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    /** Q1221: payout-hold-stripe-sync sets / restores settings.payouts.schedule. */
    update: ReturnType<typeof vi.fn>;
  };
  /** stripe-connect onboarding link after connect / reset (Q861). */
  accountLinks: { create: ReturnType<typeof vi.fn> };
  /** instant-payout: the helper's instant_available balance and the payout. */
  balance: { retrieve: ReturnType<typeof vi.fn> };
  /** charge-recurring-visits: tax quote, then the committed transaction (ME-014). */
  tax: {
    calculations: { create: ReturnType<typeof vi.fn> };
    /** Q1782 (2): stripe-webhook reads a visit's tax transaction lines to size a refund's reversal. */
    transactions: { createFromCalculation: ReturnType<typeof vi.fn>; createReversal: ReturnType<typeof vi.fn>; listLineItems: ReturnType<typeof vi.fn> };
  };
  /** `list`: instant-payout's fee return asks Stripe whether the attempt's payout really went. */
  payouts: { create: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
  charges: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  /** Q1260: create-payment finds a raced chargeback's Stripe dispute by PaymentIntent. */
  disputes: { list: ReturnType<typeof vi.fn> };
  subscriptions: {
    retrieve: ReturnType<typeof vi.fn>;
    /**
     * Subscription lookup by customer. Needed by every function that has to
     * decide "does this email actually hold a membership?" —
     * check-pro-subscription, create-pro-checkout and pro-customer-portal all
     * loop it over EVERY customer record for the address, because one person
     * routinely holds more than one Stripe customer on one email and `list()`
     * returns an arbitrary one. Defaults to "no subscriptions".
     */
    list: ReturnType<typeof vi.fn>;
  };
  /** Billing Portal — the app's only self-serve cancel/switch/update-card path. */
  billingPortal: {
    sessions: { create: ReturnType<typeof vi.fn> };
  };
  webhooks: {
    constructEventAsync: ReturnType<typeof vi.fn>;
  };
  /** Stripe Identity — every create here is billed to the platform, which is
   *  why stripe-idv-start's cost guard has tests at all. */
  identity: {
    verificationSessions: {
      create: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
    };
  };
}

/**
 * The single Stripe instance the harness wires into the function under test.
 * Tests mutate this before invoking the handler. Reset between tests via
 * `resetStripeMock()`.
 */
export const stripeMock: StripeMock = {
  __key: "",
  __keys: [],
  __opts: undefined,
  __trackClients: false,
  __calls: [],
  rawRequest: vi.fn(),
  customers: {
    list: vi.fn(),
    create: vi.fn(),
    retrieve: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
      retrieve: vi.fn(),
      expire: vi.fn().mockResolvedValue({ status: "expired" }),
      listLineItems: vi.fn(),
      list: vi.fn(),
    },
  },
  paymentIntents: {
    retrieve: vi.fn(),
    create: vi.fn(),
    cancel: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    capture: vi.fn(),
  },
  paymentMethods: {
    list: vi.fn(),
  },
  setupIntents: {
    retrieve: vi.fn(),
  },
  refunds: {
    create: vi.fn(),
    // Default to "no prior refunds" so the partial-refund sequence starts at 0.
    // Tests that exercise a repeat partial can override this per-case.
    list: vi.fn().mockResolvedValue({ data: [] }),
    retrieve: vi.fn(),
  },
  transfers: {
    create: vi.fn(),
    // Default to "no prior transfers" so a first attempt — and any resume in a
    // test that isn't exercising recovery — proceeds to create one.
    list: vi.fn().mockResolvedValue({ data: [] }),
    retrieve: vi.fn(),
    createReversal: vi.fn(),
    listReversals: vi.fn().mockResolvedValue({ data: [] }),
  },
  accounts: {
    retrieve: vi.fn(),
    listExternalAccounts: vi.fn(),
    deleteExternalAccount: vi.fn(),
    del: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  accountLinks: {
    create: vi.fn(),
  },
  balance: {
    retrieve: vi.fn(),
  },
  tax: {
    calculations: { create: vi.fn() },
    transactions: { createFromCalculation: vi.fn(), createReversal: vi.fn(), listLineItems: vi.fn() },
  },
  payouts: {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
  charges: {
    retrieve: vi.fn(),
  },
  disputes: {
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
  subscriptions: {
    retrieve: vi.fn(),
    // Default to "this customer has no subscriptions" so a test that only
    // cares about the customer-selection loop doesn't have to stub every call.
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
  billingPortal: {
    sessions: {
      create: vi.fn().mockResolvedValue({ url: "https://billing.stripe.test/session" }),
    },
  },
  webhooks: {
    constructEventAsync: vi.fn(),
  },
  identity: {
    verificationSessions: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  },
};

/**
 * A Connect account Stripe says is payable (payouts and charges enabled,
 * transfers active, not rejected). process-scheduled-payouts reads the payee's
 * account live before every transfer (_shared/livePayoutGate.ts, lead
 * 2026-10-23); a test about anything else seeds this so the payout goes on.
 */
export const PAYABLE_CONNECT_ACCOUNT = {
  id: "acct_payable",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { transfers: "active" },
  requirements: { currently_due: [], eventually_due: [], past_due: [], errors: [], disabled_reason: null },
};

/** Clears all call history + implementations on the shared Stripe mock. */
export function resetStripeMock() {
  stripeMock.__key = "";
  stripeMock.__keys = [];
  stripeMock.__opts = undefined;
  stripeMock.__trackClients = false;
  stripeMock.__calls = [];
  stripeMock.rawRequest.mockReset();
  for (const group of [
    stripeMock.customers,
    stripeMock.checkout.sessions,
    stripeMock.paymentIntents,
    stripeMock.paymentMethods,
    stripeMock.setupIntents,
    stripeMock.refunds,
    stripeMock.transfers,
    stripeMock.accounts,
    stripeMock.accountLinks,
    stripeMock.balance,
    stripeMock.tax.calculations,
    stripeMock.tax.transactions,
    stripeMock.payouts,
    stripeMock.charges,
    stripeMock.disputes,
    stripeMock.subscriptions,
    stripeMock.billingPortal.sessions,
    stripeMock.webhooks,
    stripeMock.identity.verificationSessions,
  ]) {
    for (const fn of Object.values(group)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  // Re-establish defaults that `mockReset()` just cleared. `refunds.list` backs
  // the partial-refund idempotency sequence in create-payment, which awaits its
  // `.data` — left reset it returns undefined and every refund path throws.
  // A default of "no prior refunds" keeps the sequence at 0; tests exercising a
  // repeat partial override it per-case.
  stripeMock.refunds.list.mockResolvedValue({ data: [] });
  stripeMock.disputes.list.mockResolvedValue({ data: [] });
  // Same reasoning for the two defaults added alongside: `subscriptions.list`
  // is awaited for `.data` inside the customer-selection loop, so an unset mock
  // throws before the branch under test is reached.
  stripeMock.subscriptions.list.mockResolvedValue({ data: [] });
  stripeMock.billingPortal.sessions.create.mockResolvedValue({
    url: "https://billing.stripe.test/session",
  });
  // Same reasoning for the transfer leg: execute-dispute-split awaits `.data`
  // on a resume, and a reset mock returning undefined would make every resume
  // fail closed with "could not verify prior transfers".
  stripeMock.transfers.list.mockResolvedValue({ data: [] });
  stripeMock.payouts.list.mockResolvedValue({ data: [] });
  stripeMock.transfers.listReversals.mockResolvedValue({ data: [] });
  // create-payment awaits `checkout.sessions.expire` on the re-mint path before
  // it creates the replacement session; a reset mock resolves to undefined,
  // which is harmless, but a real Session shape keeps the double honest.
  stripeMock.checkout.sessions.expire.mockResolvedValue({ status: "expired" });
  // paymentIntentPaymentFailed calls `checkout.sessions.retrieve` to decide
  // whether to notify the poster. The safe default is "open" — poster can still
  // retry, so no notification. Tests exercising the complete/expired path
  // override this with { status: "complete" } or { status: "expired" }.
  stripeMock.checkout.sessions.retrieve.mockResolvedValue({ status: "open" });
  // Q1104: no prior visit charge for this customer unless a test seeds one.
  stripeMock.paymentIntents.list.mockResolvedValue({ data: [], has_more: false });
  // One wallet (Q2139): create-payment resolves the payer's wallet customer
  // (_shared/stripeCustomer.ts). Neutral answers: no tagged customer to adopt,
  // a new customer is made, and the claim (supabase mock) keeps it.
  stripeMock.customers.search.mockResolvedValue({ data: [] });
  stripeMock.customers.create.mockResolvedValue({ id: "cus_walletnew" });
}

/**
 * Constructor the function code invokes as `new Stripe(key, opts)`.
 * Returns the shared `stripeMock` so tests configured before invocation
 * see their stubs honoured.
 */
export default class Stripe {
  constructor(key: string, opts?: unknown) {
    stripeMock.__key = key;
    stripeMock.__keys.push(key);
    stripeMock.__opts = opts;
    if (stripeMock.__trackClients) return trackedView(stripeMock, key, "") as unknown as Stripe;
    return stripeMock as unknown as Stripe;
  }
}

/** A view of `target` that records which client (key) called each mocked method. */
function trackedView(target: object, key: string, path: string): object {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (typeof prop !== "string" || prop.startsWith("__")) return value;
      const at = path ? `${path}.${prop}` : prop;
      // Only vi.fn() mocks are wrapped; classes and plain functions pass through.
      if (typeof value === "function" && "mock" in value) {
        return (...args: unknown[]) => {
          stripeMock.__calls.push({ key, method: at });
          return (value as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      if (value && typeof value === "object") return trackedView(value as object, key, at);
      return value;
    },
  });
}
