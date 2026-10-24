/**
 * Read-only PayPal lookups for refunds (PayPal Plan A, phase 5). GET only, so no idempotency key.
 *
 * The webhook never trusts an event body (design §5.4): PAYMENT.CAPTURE.REFUNDED names a refund,
 * and the reconcile re-reads that refund (status, amount, which capture it belongs to) and the
 * capture (PayPal's fee, which every refund keeps: owner 2026-10-14, "we should never absorb any
 * fee"; sandbox 2026-10-23: a refund's paypal_fee is 0.00, the capture's fee is not returned).
 */
import type { PayPalClient } from "./paypalClient.ts";
import { dollarsToCents } from "./types.ts";

interface Money { currency_code: string; value: string }

export interface CaptureRead {
  id: string;
  /** COMPLETED, PENDING, PARTIALLY_REFUNDED, REFUNDED, DECLINED, FAILED, REVERSED. */
  status: string;
  amountCents: number;
  /** PayPal's processing fee on the capture (kept on every refund); null when PayPal did not say. */
  feeCents: number | null;
}

export interface RefundRead {
  id: string;
  /** Our vocabulary (provider_refunds.status): PayPal's COMPLETED/PENDING/FAILED/CANCELLED. */
  status: "completed" | "pending" | "failed" | "cancelled";
  amountCents: number;
  /** The capture this refund came out of (the `up` link), never taken from the event body. */
  captureId: string;
  /** Our provider_refunds row id when we made it (custom_id on the refund request), else null. */
  customId: string | null;
}

const ID_RE = /^[A-Z0-9]+$/;

function usdCents(m: Money | undefined, what: string): number {
  if (!m) throw new Error(`paypal ${what} has no amount`);
  if (m.currency_code !== "USD") throw new Error(`paypal ${what} is ${m.currency_code}, not USD`);
  return dollarsToCents(m.value);
}

export async function readCapture(client: PayPalClient, captureId: string): Promise<CaptureRead> {
  if (!ID_RE.test(captureId)) throw new Error(`not a PayPal capture id: ${captureId}`);
  const c = await client.request<{ id: string; status: string; amount: Money; seller_receivable_breakdown?: { paypal_fee?: Money } }>(
    "GET",
    `/v2/payments/captures/${captureId}`,
  );
  if (!c?.id || c.id !== captureId) throw new Error(`paypal capture read returned ${c?.id ?? "nothing"} for ${captureId}`);
  const fee = c.seller_receivable_breakdown?.paypal_fee;
  return { id: c.id, status: c.status, amountCents: usdCents(c.amount, `capture ${c.id}`), feeCents: fee ? usdCents(fee, `capture ${c.id} fee`) : null };
}

const REFUND_STATUS: Record<string, RefundRead["status"]> = {
  COMPLETED: "completed",
  PENDING: "pending",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export async function readRefund(client: PayPalClient, refundId: string): Promise<RefundRead> {
  if (!ID_RE.test(refundId)) throw new Error(`not a PayPal refund id: ${refundId}`);
  const r = await client.request<{ id: string; status: string; amount: Money; custom_id?: string; links?: Array<{ rel: string; href: string }> }>(
    "GET",
    `/v2/payments/refunds/${refundId}`,
  );
  if (!r?.id || r.id !== refundId) throw new Error(`paypal refund read returned ${r?.id ?? "nothing"} for ${refundId}`);
  const status = REFUND_STATUS[r.status];
  if (!status) throw new Error(`paypal refund ${r.id} has an unknown status ${r.status}`);
  const up = r.links?.find((l) => l.rel === "up")?.href ?? "";
  const m = /\/v2\/payments\/captures\/([A-Z0-9]+)$/.exec(up);
  if (!m) throw new Error(`paypal refund ${r.id} does not link to its capture`);
  const customId = typeof r.custom_id === "string" && /^[0-9a-f-]{36}$/.test(r.custom_id) ? r.custom_id : null;
  return { id: r.id, status, amountCents: usdCents(r.amount, `refund ${r.id}`), captureId: m[1], customId };
}
