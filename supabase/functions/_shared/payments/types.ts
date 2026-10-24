/**
 * Payment provider seams (PayPal Plan A, phase 1; design ~/.lh-wt/paypal-design.md §5.1).
 *
 * Two SEPARATE seams, because collecting money and paying Helprs can come from
 * different companies (owner 2026-10-23: live PayPal Payouts was denied for the
 * new account, so the payout leg must be swappable on its own):
 *
 *   PaymentProvider  money in: checkout, capture, saved-card charge, refund.
 *   PayoutProvider   money out to a Helpr through an API: PayPal Payouts (once
 *                    PayPal approves it), another payout service, or PayPal
 *                    Commerce Platform's delayed disbursement (Plan B). The
 *                    launch path is MANUAL (owner 2026-10-23): provider_payouts
 *                    rows with provider 'manual_paypal' that an admin pays by
 *                    hand and marks paid; it has no adapter here on purpose.
 *
 * The money RULES (fees, cancellation tiers, splits, holds, bans) stay in the
 * existing _shared modules and never import a provider. Only adapters under
 * _shared/payments/ talk to a provider's API (guarded by
 * src/test/paypalCallsOnlyInPaymentsLayer.test.ts).
 *
 * Every money-moving call takes an `idempotencyKey`: a deterministic string
 * the caller derives from its own row (e.g. `lh:job:<id>:capture`), never a
 * random one, so a retry after a timeout cannot move money twice.
 *
 * Amounts are integer cents everywhere in this layer.
 */

export type ProviderEnv = "sandbox" | "live";

type PaymentProviderId = "paypal_checkout";
type PayoutProviderId = "paypal_payouts";

export interface CreateCheckoutInput {
  /** Must name the amount as a tagged `amt<cents>` part (assertOrderKeyNamesAmount): PayPal replays the original order for a reused key. */
  idempotencyKey: string;
  /** Our own id, echoed back by PayPal (custom_id) for reconciliation. */
  referenceId: string;
  amountCents: number;
  /** Optional split of amountCents for the payer's receipt; must sum to amountCents. */
  itemTotalCents?: number;
  taxTotalCents?: number;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
  /** Save the card for later charges (repeat visits, auto-tip). */
  saveCard?: boolean;
}

export interface CheckoutCreated {
  providerOrderId: string;
  /** Where to send the payer to approve. Absent when the order completed at once. */
  approveUrl: string | null;
  status: string;
}

export interface CaptureResult {
  providerOrderId: string;
  providerCaptureId: string;
  /** COMPLETED or PENDING only: a DECLINED/FAILED capture throws (captureFromOrder). */
  status: "COMPLETED" | "PENDING";
  /** True only for COMPLETED. PENDING money (e.g. an eCheck) is NOT held yet: never treat it as funded. */
  settled: boolean;
  amountCents: number;
  feeCents: number | null;
  /** Saved-card token, when the checkout asked to save the card. */
  vaultId: string | null;
}

export interface RefundResult {
  providerRefundId: string;
  /** COMPLETED or PENDING only: a FAILED/CANCELLED refund throws. */
  status: "COMPLETED" | "PENDING";
  /** True only for COMPLETED: a PENDING refund has not reached the payer yet. */
  settled: boolean;
  amountCents: number;
}

/**
 * An order as PayPal says it is NOW (GET /v2/checkout/orders/{id}). Webhooks and
 * the return page act on this re-read, never on an event body or event order.
 */
export interface OrderState {
  providerOrderId: string;
  /** CREATED | SAVED | PAYER_ACTION_REQUIRED | APPROVED | VOIDED | COMPLETED, or "GONE" when PayPal no longer has it (404: expired). */
  status: string;
  /** The order's total, in cents; null when GONE. */
  amountCents: number | null;
  /** Where to send the payer to approve, while the order still waits for them. */
  approveUrl: string | null;
  /** The capture, when the order is COMPLETED (throws like capture() for DECLINED/FAILED). */
  capture: CaptureResult | null;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly env: ProviderEnv;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutCreated>;
  getOrder(providerOrderId: string): Promise<OrderState>;
  capture(idempotencyKey: string, providerOrderId: string): Promise<CaptureResult>;
  chargeSaved(input: { idempotencyKey: string; referenceId: string; vaultId: string; amountCents: number }): Promise<CaptureResult>;
  refund(input: { idempotencyKey: string; providerCaptureId: string; amountCents: number; note?: string }): Promise<RefundResult>;
}

/** Where a payout goes, as stored in public.payee_accounts. */
type PayeeDestination =
  | { kind: "paypal_payer_id"; value: string }
  | { kind: "email"; value: string }
  | { kind: "venmo_handle"; value: string };

export interface PayoutItemInput {
  /** Our own row id (provider_payouts.id), echoed back as sender_item_id. */
  senderItemId: string;
  destination: PayeeDestination;
  amountCents: number;
  note: string;
}

export interface PayoutSent {
  providerBatchId: string;
  batchStatus: string;
  /** True when the provider said this batch id was already used (a replay); nothing new was sent. */
  duplicate: boolean;
}

export interface PayoutProvider {
  readonly id: PayoutProviderId;
  readonly env: ProviderEnv;
  /** `batchKey` becomes PayPal's sender_batch_id (unique for 30 days at PayPal; UNIQUE forever in provider_payouts). */
  payHelprs(batchKey: string, items: PayoutItemInput[], emailSubject: string): Promise<PayoutSent>;
  /** Only an UNCLAIMED item can be cancelled; a claimed payout cannot be taken back. */
  cancelUnclaimed(providerItemId: string): Promise<void>;
}

/** A provider answered with an error. `issue` is the provider's own code, e.g. REFUND_AMOUNT_EXCEEDED. */
export class ProviderApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly errorName: string | null,
    readonly issue: string | null,
    readonly debugId: string | null,
    /** HATEOAS links PayPal attached to the error (e.g. the original batch on a duplicate). */
    readonly links: readonly string[] = [],
  ) {
    super(message);
    this.name = "ProviderApiError";
  }
  /** 5xx, 429 and transport failures may succeed on retry with the SAME idempotency key. */
  get retryable(): boolean {
    return this.httpStatus === 0 || this.httpStatus === 429 || this.httpStatus >= 500;
  }
}

export function dollarsToCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`not a money amount: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function centsToDollars(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`cents must be a non-negative integer: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
