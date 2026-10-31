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
  /** D2-5 (20261029224147): the request ended with Louisiana Helpr's decision, not the seller's answer. Absent before that migration. */
  admin_decided?: boolean;
  /** D2-3 (20261029225634): the buyer's photos (declutter-handover paths, up to 3). Absent before that migration. */
  photo_paths?: string[];
  /** Declutter returns: how the item comes back (refundReturns.ts). Null for a request agreed without a way. */
  return_way?: "drop_off" | "collect" | null;
  /** A drop-off: from this Louisiana day (YYYY-MM-DD). A collect: the day of return_at. */
  return_day?: string | null;
  /** A collect: when the seller comes. */
  return_at?: string | null;
  /** A drop-off: when the buyer left it, with a photo at the address. */
  return_dropped_off_at?: string | null;
  /** While returning: when Louisiana Helpr takes over if the seller hasn't confirmed. */
  return_deadline?: string | null;
  /** A collect, while returning: the address the buyer typed (and its point, for directions). */
  return_address?: string | null;
  /** BUY-23: where a drop-off goes, for the buyer, while it is open (20261031010243). */
  drop_off_address?: string | null;
  return_lat?: number | null;
  return_lng?: number | null;
}

export interface RefundRequestView {
  order_id: string;
  side: "buyer" | "seller";
  handed_over: boolean;
  /** BUY-23: "the buyer brings it back" exists only where the seller offered pickup. Absent before 20261031010243. */
  can_drop_off?: boolean;
  /** 24 hours after the handover. */
  window_ends_at: string | null;
  can_ask: boolean;
  can_report: boolean;
  items_cents: number;
  /** What a full refund gives back: the payment minus the card fee (and minus a delivery fee a Helpr earned). */
  full_refund_cents: number;
  /** BUY-25: "never got it", refunded in full: everything back, less a delivery a Helpr already made. Absent before the migration. */
  never_got_it_refund_cents?: number;
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

/**
 * Audit BUY-31: the item is on its way back, or Louisiana Helpr is deciding. Until that ends the order card doesn't
 * ask for a review or offer help moving the item.
 */
export function refundHoldsTheItem(status: string | null | undefined): boolean {
  return status === "returning" || status === "to_admin";
}

/** NIGHT-SELL-soldstates-7: what a sale refunded in full says on each side's card, in place of "Handed over". */
export const REFUNDED_IN_FULL = {
  buyer: "Refunded in full to your card.",
  seller: "Refunded in full to the buyer. You get no payout for this sale.",
} as const;

/**
 * NIGHT-SELL-soldstates-7: the request settled with everything back (a full refund, or "never got it" in full, both at
 * least declutter_full_refund_cents), so the sale was undone. The card says so in place of "Handed over" and asks for
 * no review. A part refund (an offer taken, always below the item price) is not this.
 */
export function refundedInFull(v: Pick<RefundRequestView, "full_refund_cents" | "request"> | null | undefined): boolean {
  const r = v?.request;
  return !!r && r.status === "agreed" && r.refund_cents != null && r.refund_cents >= v.full_refund_cents;
}

/** The fields of a request that say the item went back and what came back for it (AUD31-36). */
export type RefundTookItBack = Pick<RefundRequest, "status" | "returned_at"> & Partial<Pick<RefundRequest, "refund_cents" | "refund_status">>;

/**
 * AUD31-36: a full refund where the item went back to the seller (status "agreed", returned_at set). The buyer no longer
 * has it, so the card stops offering help moving it and says it was returned. A part refund (the buyer keeps it) has no
 * returned_at and reads as before.
 */
export function refundTookItBack(request: RefundTookItBack | null | undefined): boolean {
  return request?.status === "agreed" && !!request.returned_at;
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
 * is sent now, never before. `photoPath`: the seller's optional live photo (refundReturns.uploadReturnPhoto).
 */
export async function confirmItemReturned(requestId: string, photoPath: string | null = null): Promise<{ result: string; refund_cents?: number }> {
  return rpcData(
    // nullable-arg: the photo is optional (p_photo_path DEFAULT NULL).
    await supabase.rpc("declutter_refund_item_returned", { p_request_id: requestId, p_photo_path: photoPath as string }),
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
