// @mutate src/lib/iap.ts | const offer = cdv.store.get(productId, cdv.Platform.APPLE_APPSTORE)?.getOffer(); | const offer = { productId: undefined as unknown as string, order: () => (cdv.store as unknown as { order: (p: string) => Promise<void> }).order(productId) };
// @mutate src/lib/iap.ts |   cdv.store.applicationUsername = userId; |   void userId;
// @mutate src/lib/iap.ts |   cdv.store.obfuscator = "disabled"; |   void 0;
// @mutate src/lib/iap.ts | if (result.code !== undefined && result.code === cdv.ErrorCode?.PAYMENT_CANCELLED) return; | void 0;
/**
 * iap.ts buys an OFFER, the way cordova-plugin-purchase v13 sells, and binds
 * the buyer as applicationUsername (Q?iap-order-offer).
 *
 * The old code called `store.order(productId)` with a string. In v13
 * store.order(offer) reads offer.platform and offer.productId, and the Apple
 * adapter calls `bridge.purchase(offer.productId, ...)`
 * (node_modules/cordova-plugin-purchase/www/store.js), so StoreKit got no
 * product id. The fake store below behaves the same way: it only buys what it
 * is handed as an offer, and records the username the plugin would send.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getUser: () => getUser() }, functions: { invoke: vi.fn() } },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const USER_ID = "7b923b19-0000-4000-8000-000000000001";

interface Bought { productId: unknown; username: unknown; obfuscator: unknown }
let bought: Bought[];
let loaded: Set<string>;
let orderAnswer: unknown;
const PAYMENT_CANCELLED = 6777006;

function installFakeStore() {
  bought = [];
  const store: Record<string, unknown> = {
    applicationUsername: undefined,
    register: vi.fn(),
    initialize: vi.fn(async () => undefined),
    restorePurchases: vi.fn(async () => undefined),
    when: () => ({ approved: vi.fn() }),
    // v13 store.order(offer): reads offer.productId (a string has none).
    order: vi.fn(async (offer: { productId?: unknown }) => {
      bought.push({ productId: offer?.productId, username: store.applicationUsername, obfuscator: store.obfuscator });
      return orderAnswer;
    }),
    get: vi.fn((id: string, platform?: string) => {
      if (!loaded.has(id) || platform !== "ios-appstore") return undefined;
      return {
        getOffer: () => ({
          productId: id,
          order: () => (store.order as (o: unknown) => Promise<void>)({ productId: id }),
        }),
      };
    }),
  };
  (window as unknown as { CdvPurchase: unknown }).CdvPurchase = {
    store,
    ProductType: { PAID_SUBSCRIPTION: "paid subscription", NON_RENEWING_SUBSCRIPTION: "non renewing subscription" },
    Platform: { APPLE_APPSTORE: "ios-appstore" },
    ErrorCode: { PAYMENT_CANCELLED },
  };
}

beforeEach(() => {
  vi.resetModules();
  rpc.mockReset().mockResolvedValue({ data: { allowed: true }, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  loaded = new Set(["com.helpr.pro.monthly"]);
  orderAnswer = undefined;
  installFakeStore();
});

describe("purchaseTier orders the product's offer, bound to the buyer", () => {
  it("hands StoreKit the real product id", async () => {
    const { purchaseTier } = await import("./iap");
    await purchaseTier("pro", "monthly");
    expect(bought).toHaveLength(1);
    expect(bought[0].productId).toBe("com.helpr.pro.monthly");
  });

  it("sets applicationUsername to the signed-in user id (Apple's appAccountToken)", async () => {
    const { purchaseTier } = await import("./iap");
    await purchaseTier("pro", "monthly");
    expect(bought[0].username).toBe(USER_ID);
  });

  it("sends the raw id on StoreKit 1 AND 2: obfuscator 'disabled' (verify-apple-iap compares it to the user id)", async () => {
    const { purchaseTier } = await import("./iap");
    await purchaseTier("pro", "monthly");
    expect(bought[0].obfuscator).toBe("disabled");
  });

  it("refuses, charging nothing, when the product has not loaded from Apple, with copy shown as written", async () => {
    loaded = new Set();
    const { purchaseTier, IapBlockedError } = await import("./iap");
    const err = await purchaseTier("pro", "monthly").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IapBlockedError);
    expect(String((err as Error).message)).toMatch(/isn't available/);
    expect(bought).toHaveLength(0);
  });

  it("a buyer closing Apple's sheet is not an error", async () => {
    orderAnswer = { isError: true, code: PAYMENT_CANCELLED, message: "The user cancelled the order." };
    const { purchaseTier } = await import("./iap");
    await expect(purchaseTier("pro", "monthly")).resolves.toBeUndefined();
  });

  it("a real purchase failure still throws", async () => {
    orderAnswer = { isError: true, code: 6777003, message: "Purchase failed" };
    const { purchaseTier } = await import("./iap");
    await expect(purchaseTier("pro", "monthly")).rejects.toThrow(/Purchase failed/);
  });

  it("refuses, charging nothing, without a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { purchaseTier } = await import("./iap");
    await expect(purchaseTier("pro", "monthly")).rejects.toThrow(/sign in/i);
    expect(bought).toHaveLength(0);
  });
});
