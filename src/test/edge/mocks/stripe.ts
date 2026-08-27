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
  __opts: unknown;
  customers: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
  };
  checkout: {
    sessions: {
      create: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
      listLineItems: ReturnType<typeof vi.fn>;
    };
  };
  paymentIntents: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  refunds: {
    create: ReturnType<typeof vi.fn>;
    /** Used to derive the partial-refund idempotency sequence (see
     *  create-payment admin_refund_general). Defaults to an empty list. */
    list: ReturnType<typeof vi.fn>;
  };
  transfers: {
    create: ReturnType<typeof vi.fn>;
  };
  accounts: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  charges: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  subscriptions: {
    retrieve: ReturnType<typeof vi.fn>;
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
  __opts: undefined,
  customers: {
    list: vi.fn(),
    create: vi.fn(),
    retrieve: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
      retrieve: vi.fn(),
      listLineItems: vi.fn(),
    },
  },
  paymentIntents: {
    retrieve: vi.fn(),
  },
  refunds: {
    create: vi.fn(),
    // Default to "no prior refunds" so the partial-refund sequence starts at 0.
    // Tests that exercise a repeat partial can override this per-case.
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
  transfers: {
    create: vi.fn(),
  },
  accounts: {
    retrieve: vi.fn(),
  },
  charges: {
    retrieve: vi.fn(),
  },
  subscriptions: {
    retrieve: vi.fn(),
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

/** Clears all call history + implementations on the shared Stripe mock. */
export function resetStripeMock() {
  stripeMock.__key = "";
  stripeMock.__opts = undefined;
  for (const group of [
    stripeMock.customers,
    stripeMock.checkout.sessions,
    stripeMock.paymentIntents,
    stripeMock.refunds,
    stripeMock.transfers,
    stripeMock.accounts,
    stripeMock.charges,
    stripeMock.subscriptions,
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
}

/**
 * Constructor the function code invokes as `new Stripe(key, opts)`.
 * Returns the shared `stripeMock` so tests configured before invocation
 * see their stubs honoured.
 */
export default class Stripe {
  constructor(key: string, opts?: unknown) {
    stripeMock.__key = key;
    stripeMock.__opts = opts;
    return stripeMock as unknown as Stripe;
  }
}
