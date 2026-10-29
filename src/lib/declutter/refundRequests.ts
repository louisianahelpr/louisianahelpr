/**
 * Board 141, Declutter side: a refund request after the handover (migration 20261026155251).
 *
 * Within 24 hours of getting the item the buyer asks the seller for a refund; the seller refunds it all,
 * offers part (exactly the amount offered, below the item price), or says no; the buyer takes an offer or
 * asks Louisiana Helpr to decide. Every rule and every amount is the server's: this file only calls the
 * declutter_*refund* RPCs and reads declutter_refund_request_view. Behind the hidden switch
 * 'declutter_refund_requests' (each RPC starts with require_feature). A refusal carries its plain words
 * (RPC_ERROR_COPY) as `userMessage`; screens show declutterErrorMessage(err).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

export type RefundReason = "not_as_described" | "damaged" | "not_received";
type RefundRequestStatus = "open" | "offered" | "returning" | "agreed" | "declined" | "to_admin" | "withdrawn";

interface RefundRequest {
  id: string;
  status: RefundRequestStatus;
  reason: RefundReason;
  note: string;
  answer_by: string;
  offer_cents: number | null;
  offer_answer_by: string | null;
  declined_at: string | null;
  /** A full refund agreed (status "returning"): the seller confirms the item is back by then, or Louisiana Helpr decides. */
  return_by: string | null;
  returned_at: string | null;
  /** While the seller's "no" stands: the buyer may report a problem until then. */
  report_until: string | null;
  /** A settled request: what the buyer gets back, and whether Stripe took it yet. */
  refund_cents: number | null;
  refund_status: "pending" | "succeeded" | "failed" | null;
  created_at: string;
}

export interface RefundRequestView {
  order_id: string;
  side: "buyer" | "seller";
  handed_over: boolean;
  /** 24 hours after the handover. */
  window_ends_at: string | null;
  can_ask: boolean;
  can_report: boolean;
  items_cents: number;
  /** What a full refund gives back: the payment minus the card fee (and minus a delivery fee a Helpr earned). */
  full_refund_cents: number;
  /** A delivery fee that paid a Helpr for the trip: never refunded. */
  delivery_kept_cents: number;
  request: RefundRequest | null;
}

function rpcData<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

export async function fetchRefundRequestView(orderId: string): Promise<RefundRequestView> {
  return rpcData(
    await supabase.rpc("declutter_refund_request_view", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_refund_request_view", e),
  ) as unknown as RefundRequestView;
}

/**
 * The buyer asks, within 24 hours of the handover. Audit 1b D2-7: `photoPaths` (problem-folder paths from
 * uploadProblemPhoto) go only when there are some; the refund form sends them only once declutter_ask_refund takes
 * p_photo_paths (REFUND_FORM_PHOTOS_READY, bound to the migrations by problemPhotosWaitForServer.test.ts).
 */
export async function askRefund(orderId: string, reason: RefundReason, note: string, photoPaths: readonly string[] = []): Promise<{ result: string }> {
  const base = { p_order_id: orderId, p_reason: reason, p_note: note };
  const args = photoPaths.length ? { ...base, p_photo_paths: [...photoPaths] } : base;
  return rpcData(
    await supabase.rpc("declutter_ask_refund", args as typeof base),
    (e) => rpcErrorMessage("declutter_ask_refund", e),
  ) as unknown as { result: string };
}

/** The seller answers: refund in full, offer part (cents), or say no. */
export async function answerRefund(
  requestId: string,
  answer: "full" | "part" | "decline",
  offerCents: number | null,
): Promise<{ result: string; refund_cents?: number }> {
  return rpcData(
    await supabase.rpc("declutter_answer_refund", { p_request_id: requestId, p_answer: answer, p_offer_cents: offerCents as number }),
    (e) => rpcErrorMessage("declutter_answer_refund", e),
  ) as unknown as { result: string; refund_cents?: number };
}

/** The buyer takes the seller's part offer, or asks Louisiana Helpr to decide. */
export async function answerRefundOffer(requestId: string, accept: boolean): Promise<{ result: string }> {
  return rpcData(
    await supabase.rpc("declutter_answer_refund_offer", { p_request_id: requestId, p_accept: accept }),
    (e) => rpcErrorMessage("declutter_answer_refund_offer", e),
  ) as unknown as { result: string };
}

/**
 * The seller has the item back after agreeing a full refund (owner 2026-10-23, #3558 answer 2): the refund
 * is sent now, never before.
 */
export async function confirmItemReturned(requestId: string): Promise<{ result: string; refund_cents?: number }> {
  return rpcData(
    await supabase.rpc("declutter_refund_item_returned", { p_request_id: requestId }),
    (e) => rpcErrorMessage("declutter_refund_item_returned", e),
  ) as unknown as { result: string; refund_cents?: number };
}

/** The buyer takes the request back. */
export async function withdrawRefund(requestId: string): Promise<{ result: string }> {
  return rpcData(
    await supabase.rpc("declutter_withdraw_refund", { p_request_id: requestId }),
    (e) => rpcErrorMessage("declutter_withdraw_refund", e),
  ) as unknown as { result: string };
}

/** "$12" for whole dollars, "$12.50" otherwise. */
export function refundDollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** The seller's offer box takes dollars ("12" or "12.50"); null when it isn't a positive amount in cents. */
export function offerCentsFromInput(text: string): number | null {
  const t = text.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return cents > 0 ? cents : null;
}
