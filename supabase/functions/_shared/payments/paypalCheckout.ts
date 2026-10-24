/**
 * PaymentProvider for PayPal Checkout (Orders v2, intent CAPTURE) into HELPR's
 * own account: Plan A's money-in leg. Built in phase 1; phase 3 calls it for job
 * checkouts (_shared/payments/paypalJobCheckout.ts).
 *
 * Behaviour measured on the sandbox 2026-10-23 (design doc §2):
 * - A card order with payment_source.card completes in one call (no redirect).
 * - A PayPal-wallet order answers PAYER_ACTION_REQUIRED with an `approve`
 *   (or `payer-action`) link; capture after the payer returns.
 * - Refunds: many partials up to the captured amount; more answers 422
 *   REFUND_AMOUNT_EXCEEDED; PayPal keeps its original fee.
 * - Saved card: store_in_vault ON_SUCCESS returns a vault id; a later charge
 *   with stored_credential MERCHANT/UNSCHEDULED/SUBSEQUENT needs no payer.
 */
import type { PayPalClient } from "./paypalClient.ts";
import {
  ProviderApiError,
  centsToDollars,
  dollarsToCents,
  type CaptureResult,
  type CheckoutCreated,
  type CreateCheckoutInput,
  type OrderState,
  type PaymentProvider,
  type RefundResult,
} from "./types.ts";

interface Money { currency_code: string; value: string }
interface PayPalCapture {
  id: string;
  status: string;
  amount: Money;
  seller_receivable_breakdown?: { paypal_fee?: Money };
}
interface PayPalOrder {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
  payment_source?: { card?: { attributes?: { vault?: { id?: string } } }; paypal?: { attributes?: { vault?: { id?: string } } } };
  purchase_units?: Array<{ amount?: Money; payments?: { captures?: PayPalCapture[] } }>;
}

/** PayPal order ids are upper-case letters and digits; anything else never reaches a URL. */
function assertOrderId(id: string): void {
  if (!/^[A-Z0-9]+$/.test(id)) throw new Error(`not a PayPal order id: ${id}`);
}

function approveLinkOf(order: PayPalOrder): string | null {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}

/**
 * PayPal answers a reused PayPal-Request-Id with the ORIGINAL order, whatever the new body says.
 * An order key that does not name the amount would therefore charge an old price after a
 * re-price (the accepted-bid-price class). So an order key must carry the amount as a TAGGED
 * `:`-separated part, `amt<cents>`, e.g. `lh:job:<id>:checkout:amt10570:a1` (a bare number could
 * be mistaken for an attempt counter).
 */
function assertOrderKeyNamesAmount(key: string, amountCents: number): void {
  if (!key.split(":").includes(`amt${amountCents}`)) {
    throw new Error(`order idempotency key must name the amount (${amountCents}): ${key}`);
  }
}

/** The name PayPal's checkout page shows for us (lead 2026-10-23). */
export const PAYPAL_BRAND_NAME = "Louisiana Helpr";

function usd(cents: number): Money {
  return { currency_code: "USD", value: centsToDollars(cents) };
}

/**
 * A 201 is not a payment: PayPal answers DECLINED/FAILED captures inside a 2xx. Those throw here,
 * PENDING comes back with settled=false, and only COMPLETED (on a COMPLETED order) is settled.
 */
export function captureFromOrder(order: PayPalOrder): CaptureResult {
  if (!order?.id) throw new Error("paypal order response has no id");
  const units = order.purchase_units ?? [];
  if (units.length !== 1) throw new Error(`paypal order ${order.id} has ${units.length} purchase units; we create exactly one`);
  const caps = units[0].payments?.captures ?? [];
  if (caps.length !== 1) throw new Error(`paypal order ${order.id} (${order.status}) has ${caps.length} captures; expected exactly one`);
  const cap = caps[0];
  if (cap.status !== "COMPLETED" && cap.status !== "PENDING") {
    // Typed, with PayPal's status as the issue: the caller can tell a decline from a transport failure.
    throw new ProviderApiError(`paypal_capture_not_successful: ${cap.id} is ${cap.status}`, 200, "CAPTURE_NOT_SUCCESSFUL", cap.status, null);
  }
  if (cap.status === "COMPLETED" && order.status !== "COMPLETED") {
    throw new Error(`paypal order ${order.id} is ${order.status} while its capture is COMPLETED`);
  }
  if (cap.amount.currency_code !== "USD") throw new Error(`paypal capture ${cap.id} is ${cap.amount.currency_code}, not USD`);
  const fee = cap.seller_receivable_breakdown?.paypal_fee;
  return {
    providerOrderId: order.id,
    providerCaptureId: cap.id,
    status: cap.status,
    settled: cap.status === "COMPLETED",
    amountCents: dollarsToCents(cap.amount.value),
    feeCents: fee ? dollarsToCents(fee.value) : null,
    vaultId: order.payment_source?.card?.attributes?.vault?.id ?? order.payment_source?.paypal?.attributes?.vault?.id ?? null,
  };
}

export function createPayPalCheckoutProvider(client: PayPalClient): PaymentProvider {
  return {
    id: "paypal_checkout",
    env: client.env,

    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutCreated> {
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("amountCents must be a positive integer");
      const hasBreakdown = input.itemTotalCents !== undefined || input.taxTotalCents !== undefined;
      if (hasBreakdown && (input.itemTotalCents ?? 0) + (input.taxTotalCents ?? 0) !== input.amountCents) {
        throw new Error("item + tax must equal amountCents");
      }
      assertOrderKeyNamesAmount(input.idempotencyKey, input.amountCents);
      const order = await client.request<PayPalOrder>("POST", "/v2/checkout/orders", {
        idempotencyKey: input.idempotencyKey,
        prefer: "return=representation",
        body: {
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: input.referenceId,
            custom_id: input.referenceId,
            description: input.description?.slice(0, 127),
            amount: {
              ...usd(input.amountCents),
              ...(hasBreakdown
                ? { breakdown: { item_total: usd(input.itemTotalCents ?? 0), tax_total: usd(input.taxTotalCents ?? 0) } }
                : {}),
            },
          }],
          payment_source: {
            paypal: {
              experience_context: {
                user_action: "PAY_NOW",
                // Only funding that settles at once (lead 2026-10-23): no eCheck-style payment whose
                // capture sits PENDING for days. capture_pending is still handled, defensively.
                payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                // What PayPal's page calls us ("Cancel and return to Louisiana Helpr"), not the account's default.
                brand_name: PAYPAL_BRAND_NAME,
                shipping_preference: "NO_SHIPPING",
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
              ...(input.saveCard ? { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT" } } } : {}),
            },
          },
        },
      });
      if (!order?.id) throw new Error("paypal order response has no id");
      return { providerOrderId: order.id, approveUrl: approveLinkOf(order), status: order.status };
    },

    async getOrder(providerOrderId: string): Promise<OrderState> {
      assertOrderId(providerOrderId);
      let order: PayPalOrder;
      try {
        order = await client.request<PayPalOrder>("GET", `/v2/checkout/orders/${providerOrderId}`);
      } catch (e) {
        // 404: PayPal no longer has it (an order nobody approved expires). Nothing can be captured.
        if (e instanceof ProviderApiError && e.httpStatus === 404) {
          return { providerOrderId, status: "GONE", amountCents: null, approveUrl: null, capture: null };
        }
        throw e;
      }
      if (!order?.id || order.id !== providerOrderId) throw new Error(`paypal order read returned ${order?.id ?? "no id"} for ${providerOrderId}`);
      const units = order.purchase_units ?? [];
      if (units.length !== 1) throw new Error(`paypal order ${order.id} has ${units.length} purchase units; we create exactly one`);
      const amt = units[0].amount;
      if (amt && amt.currency_code !== "USD") throw new Error(`paypal order ${order.id} is ${amt.currency_code}, not USD`);
      return {
        providerOrderId: order.id,
        status: order.status,
        amountCents: amt ? dollarsToCents(amt.value) : null,
        approveUrl: order.status === "COMPLETED" || order.status === "VOIDED" ? null : approveLinkOf(order),
        capture: order.status === "COMPLETED" ? captureFromOrder(order) : null,
      };
    },

    async capture(idempotencyKey: string, providerOrderId: string): Promise<CaptureResult> {
      assertOrderId(providerOrderId);
      const order = await client.request<PayPalOrder>("POST", `/v2/checkout/orders/${providerOrderId}/capture`, {
        idempotencyKey,
        prefer: "return=representation",
        body: {},
      });
      return captureFromOrder(order);
    },

    async chargeSaved(input): Promise<CaptureResult> {
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("amountCents must be a positive integer");
      assertOrderKeyNamesAmount(input.idempotencyKey, input.amountCents);
      const order = await client.request<PayPalOrder>("POST", "/v2/checkout/orders", {
        idempotencyKey: input.idempotencyKey,
        prefer: "return=representation",
        body: {
          intent: "CAPTURE",
          purchase_units: [{ reference_id: input.referenceId, custom_id: input.referenceId, amount: usd(input.amountCents) }],
          payment_source: {
            card: {
              vault_id: input.vaultId,
              stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" },
            },
          },
        },
      });
      return captureFromOrder(order);
    },

    async refund(input): Promise<RefundResult> {
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("amountCents must be a positive integer");
      if (!/^[A-Z0-9]+$/.test(input.providerCaptureId)) throw new Error(`not a PayPal capture id: ${input.providerCaptureId}`);
      const r = await client.request<{ id: string; status: string; amount: Money }>(
        "POST",
        `/v2/payments/captures/${input.providerCaptureId}/refund`,
        {
          idempotencyKey: input.idempotencyKey,
          prefer: "return=representation",
          body: { amount: usd(input.amountCents), ...(input.note ? { note_to_payer: input.note.slice(0, 255) } : {}) },
        },
      );
      if (!r?.id) throw new Error("paypal refund response has no id");
      if (r.status !== "COMPLETED" && r.status !== "PENDING") {
        throw new ProviderApiError(`paypal_refund_not_successful: ${r.id} is ${r.status}`, 200, "REFUND_NOT_SUCCESSFUL", r.status, null);
      }
      return { providerRefundId: r.id, status: r.status, settled: r.status === "COMPLETED", amountCents: dollarsToCents(r.amount.value) };
    },
  };
}
