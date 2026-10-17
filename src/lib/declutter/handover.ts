/**
 * Declutter slice 4 client calls (docs/specs/declutter-auctions.md rows 14-15,
 * 18-19, 25-28, 45, 52, 93-99; B49-B58): pickup booking, the handover card
 * (buyer's QR + 4-digit code), the seller's scan / typed code, the buyer's
 * "I got it", porch photos, "They didn't show", "Report a problem", reviews,
 * the seller's payout status and the admin problems queue.
 *
 * Every write is a declutter_* RPC; every rule (who, when, how much) is in SQL
 * (20261015042253), so this file is never the protection. A refusal carries
 * its plain words (RPC_ERROR_COPY) as `userMessage`; screens show
 * declutterErrorMessage(err).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { loadAdminRpcErrorCopy, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";

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

export interface MyBooking {
  order_id: string;
  slot_start: string | null;
  slot_end: string | null;
  porch_mode: "all_day" | "until" | null;
  porch_until: string | null;
}

interface MyHandover {
  order_id: string;
  status: string;
  side: "buyer" | "seller";
  code: string | null;
  qr: string | null;
  code_locked: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  set_out_at: string | null;
  picked_up_at: string | null;
}

export interface MyPayout {
  order_id: string;
  items_cents: number;
  debt_cents: number;
  amount_cents: number;
  status: "pending" | "succeeded" | "failed" | "nothing_due";
  executed_at: string | null;
}

export async function fetchMyBookings(orderIds: string[]): Promise<MyBooking[]> {
  if (orderIds.length === 0) return [];
  const rows = unwrap(
    await supabase.from("declutter_bookings").select("order_id, slot_start, slot_end, porch_mode, porch_until").in("order_id", orderIds),
  );
  return (rows ?? []) as MyBooking[];
}

/** The seller's payout rows (row 93): what was paid, minus any card-fee debt. */
export async function fetchMyPayouts(userId: string): Promise<MyPayout[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_payouts")
      .select("order_id, items_cents, debt_cents, amount_cents, status, executed_at")
      .eq("seller_id", userId),
  );
  return (rows ?? []) as MyPayout[];
}

/** Book (or move) the 30-minute pickup slot. */
export async function bookPickup(orderId: string, slotStartIso: string): Promise<{ result: string }> {
  return rpcData(
    await supabase.rpc("declutter_book_pickup", { p_order_id: orderId, p_slot_start: slotStartIso }),
    (e) => rpcErrorMessage("declutter_book_pickup", e),
  ) as unknown as { result: string };
}

/** Porch timing (row 97): "out all day" or "out until <time>". */
export async function setPorchTime(orderId: string, mode: "all_day" | "until", untilIso: string | null): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_set_porch_time", { p_order_id: orderId, p_mode: mode, p_until: untilIso as string }),
    (e) => rpcErrorMessage("declutter_set_porch_time", e),
  );
}

/** The handover card: the BUYER gets the code + QR, the seller never does. */
export async function fetchMyHandover(orderId: string): Promise<MyHandover> {
  return rpcData(
    await supabase.rpc("declutter_my_handover", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_my_handover", e),
  ) as unknown as MyHandover;
}

type HandoverResult =
  | { result: "handed_over"; payout_id: string | null; by: string }
  | { result: "already_handed_over" }
  | { result: "wrong_code"; attempts_left: number }
  | { result: "code_locked" };

/** Seller: scanned QR ('scan') or typed code ('code'). Buyer: "I got it" ('buyer', no code). */
export async function confirmHandover(orderId: string, method: "scan" | "code" | "buyer", code: string | null): Promise<HandoverResult> {
  return rpcData(
    await supabase.rpc("declutter_confirm_handover", { p_order_id: orderId, p_method: method, p_code: code as string }),
    (e) => rpcErrorMessage("declutter_confirm_handover", e),
  ) as unknown as HandoverResult;
}

/**
 * Porch photo (row 26). Seller: "Set out" (no location). Buyer: "Picked up",
 * taken at the address; it pays the seller right away unless a problem is
 * open (row 99, owner 2026-10-15).
 */
export async function porchPhoto(
  orderId: string,
  photoPath: string,
  where: { lat: number; lng: number } | null,
): Promise<{ result: "set_out" | "picked_up" | "already_handed_over"; paid?: boolean; distance_m?: number }> {
  return rpcData(
    await supabase.rpc("declutter_porch_photo", {
      p_order_id: orderId,
      p_photo_path: photoPath,
      p_lat: (where?.lat ?? null) as number,
      p_lng: (where?.lng ?? null) as number,
    }),
    (e) => rpcErrorMessage("declutter_porch_photo", e),
  ) as unknown as { result: "set_out" | "picked_up" | "already_handed_over"; paid?: boolean; distance_m?: number };
}

/**
 * Clean (metadata stripped, like listing photos) and upload one handover
 * photo to `<uid>/declutter/handover/<order>/<file>`, the only path the SQL
 * accepts. Returns the path for porchPhoto / reportProblem.
 */
export async function uploadHandoverPhoto(userId: string, orderId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = `${userId}/declutter/handover/${orderId}/${nonce}.jpg`;
  const { error } = await supabase.storage.from("job-photos").upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw new Error("photo_not_uploaded");
  return path;
}

/** "They didn't show", 15 minutes after the booked time (row 94). */
export async function reportNoShow(orderId: string): Promise<{ result: string }> {
  return rpcData(
    await supabase.rpc("declutter_report_no_show", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_report_no_show", e),
  ) as unknown as { result: string };
}

export type ProblemReason = "not_as_described" | "damaged" | "not_received" | "no_show" | "safety" | "other";

/** "Report a problem" (rows 15, 67, 96): any time until the seller is paid; it holds the money. */
export async function reportProblem(orderId: string, reason: ProblemReason, note: string, photoPaths: string[]): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_report_problem", { p_order_id: orderId, p_reason: reason, p_note: note, p_photo_paths: photoPaths }),
    (e) => rpcErrorMessage("declutter_report_problem", e),
  ) as string;
}

/** A review after the handover (row 45), both ways, blind until both or 14 days. */
export async function leaveReview(orderId: string, stars: number, comment: string | null): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_leave_review", { p_order_id: orderId, p_stars: stars, p_comment: comment as string }),
    (e) => rpcErrorMessage("declutter_leave_review", e),
  ) as string;
}

/** The exact pickup address: the paid buyer and the seller only (rows 27, 98). */
export async function fetchItemAddress(itemId: string): Promise<{ pickup_address: string; pickup_lat: number; pickup_lng: number } | null> {
  const rows = rpcData(
    await supabase.rpc("declutter_item_address", { p_item_id: itemId }),
    (e) => rpcErrorMessage("declutter_item_address", e),
  );
  return (rows?.[0] ?? null) as { pickup_address: string; pickup_lat: number; pickup_lng: number } | null;
}

/** Admin "Declutter problems" card: decide refund the buyer / pay the seller, by fault, optional strike. */
export async function adminDecideProblem(
  problemId: string,
  decision: "refund_buyer" | "pay_seller",
  fault: "seller" | "buyer" | "none",
  strike: boolean,
  note: string | null,
): Promise<Record<string, unknown>> {
  const res = await supabase.rpc("declutter_admin_decide_problem", {
    p_problem_id: problemId, p_decision: decision, p_fault: fault, p_strike: strike, p_note: note as string,
  });
  // Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_decide_problem", e) ?? null) as unknown as Record<string, unknown>;
}

/** Open problems for the admin card (RLS: admins read every problem). */
export async function fetchOpenProblemsForAdmin() {
  const rows = unwrap(
    await supabase
      .from("declutter_problems")
      .select("id, order_id, reporter_side, reason, note, photo_paths, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: true }),
  );
  return rows ?? [];
}
