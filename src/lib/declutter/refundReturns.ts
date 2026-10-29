/**
 * Declutter returns (migration 20261029192457_declutter_returns.sql): how a full-refund item gets back to the seller. Owner 2026-10-29
 * (through the lead): only the two free ways, no paid Helpr trip.
 *   drop_off  the buyer brings it to the seller's pickup address on or after the day the seller picked, and takes
 *             a live photo there (declutter_return_dropped_off; the porch photo rules).
 *   collect   the seller comes for it at the time they picked, to the address the buyer types
 *             (declutter_set_return_address).
 * The seller's full-refund answer and the way are ONE call (declutter_accept_refund_with_return). The seller's
 * "I got it back" (confirmItemReturned in refundRequests.ts) stays the only call that sends money.
 * Only the refund components import this file (src/test/declutterReturns.test.ts).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { assertLivePhoto } from "@/lib/declutter/livePhoto";

export type ReturnWay = "drop_off" | "collect";

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

/** The seller agrees a full refund and picks the way: a day for a drop-off, a time for a collect. */
export async function acceptRefundWithReturn(
  requestId: string,
  way: ReturnWay,
  day: string | null,
  atIso: string | null,
): Promise<{ result: "returning"; return_way: ReturnWay; return_day: string; full_refund_cents: number }> {
  return rpcData(
    await supabase.rpc("declutter_accept_refund_with_return", {
      p_request_id: requestId,
      p_way: way,
      // nullable-arg: a collect sends its time (the day follows from it); a drop-off sends only its day.
      p_day: day as string,
      p_at: atIso as string,
    }),
    (e) => rpcErrorMessage("declutter_accept_refund_with_return", e),
  ) as unknown as { result: "returning"; return_way: ReturnWay; return_day: string; full_refund_cents: number };
}

/** The buyer left it at the seller's pickup address: a live photo taken there (`where`, within 200 m). */
export async function returnDroppedOff(
  requestId: string,
  photoPath: string,
  where: { lat: number; lng: number },
): Promise<{ result: "dropped_off" | "already_dropped_off" }> {
  return rpcData(
    await supabase.rpc("declutter_return_dropped_off", {
      p_request_id: requestId,
      p_photo_path: photoPath,
      p_lat: where.lat,
      p_lng: where.lng,
    }),
    (e) => rpcErrorMessage("declutter_return_dropped_off", e),
  ) as unknown as { result: "dropped_off" | "already_dropped_off" };
}

/** The buyer says where the seller collects it. */
export async function setReturnAddress(requestId: string, address: string, where: { lat: number; lng: number }): Promise<{ result: "address_set" }> {
  return rpcData(
    await supabase.rpc("declutter_set_return_address", {
      p_request_id: requestId,
      p_address: address,
      p_lat: where.lat,
      p_lng: where.lng,
    }),
    (e) => rpcErrorMessage("declutter_set_return_address", e),
  ) as unknown as { result: "address_set" };
}

/**
 * Clean and upload one return photo to `<uid>/declutter/return/<order>/<file>` in the private
 * declutter-handover bucket (writable only while the order's refund request is returning).
 */
export async function uploadReturnPhoto(userId: string, orderId: string, file: File): Promise<string> {
  // Live camera only (20261029002010): a photo taken more than 10 minutes ago is refused before it is uploaded.
  assertLivePhoto(file);
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = `${userId}/declutter/return/${orderId}/${nonce}.jpg`;
  const { error } = await supabase.storage.from("declutter-handover").upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw new Error("photo_not_uploaded");
  return path;
}

/** The days a seller may pick for a return: today and the next 7 (Louisiana dates, YYYY-MM-DD). */
export function returnDayChoices(now: Date = new Date()): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  for (let i = 0; i <= 7; i++) out.push(fmt.format(new Date(now.getTime() + i * 86_400_000)));
  return [...new Set(out)];
}

/** "Fri, Oct 30" for a YYYY-MM-DD day (read as a calendar date, never shifted by the device's zone). */
export function returnDayWords(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
