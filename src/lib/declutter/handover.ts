/**
 * Declutter slice 4 client calls (docs/specs/declutter-auctions.md rows 14-15,
 * 18-19, 25-28, 45, 52, 93-99; B49-B58): pickup booking, the handover card,
 * the buyer's "I got it" (no QR, no 4-digit code: owner 2026-10-18), porch photos, "They didn't show", "Report a problem", reviews,
 * the seller's payout status and the admin problems queue.
 *
 * Every write is a declutter_* RPC; every rule (who, when, how much) is in SQL
 * (20261015042253), so this file is never the protection. A refusal carries
 * its plain words (RPC_ERROR_COPY) as `userMessage`; screens show
 * declutterErrorMessage(err).
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { isStorageObjectPath } from "@/lib/storagePath";
import { unwrap } from "@/lib/supabaseResult";
import { loadAdminRpcErrorCopy, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import type { SellerWindow } from "@/lib/declutter/pickupSlots";
import { assertLivePhoto } from "@/lib/declutter/livePhoto";

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
  /** Each side may move a booked time once (CHECK 0-1, row 52). Older rows read as 0. */
  buyer_reschedules?: number;
  seller_reschedules?: number;
  /** Porch pickup DAY (yyyy-mm-dd, owner 2026-10-28; 20261028225038). Absent before that migration reaches prod. */
  pickup_day?: string | null;
  /** D-NEW11: when the buyer last said "I'm on my way". Absent before that migration reaches prod. */
  buyer_on_way_at?: string | null;
}

export interface MyPayout {
  order_id: string;
  items_cents: number;
  /** A seller delivery's rate, paid with the items (20261027153244); 0 otherwise or when free. */
  delivery_cents: number;
  /** Board 141d: what a refund after the handover took back from this payout. */
  refunded_cents: number;
  debt_cents: number;
  amount_cents: number;
  status: "pending" | "succeeded" | "failed" | "nothing_due";
  executed_at: string | null;
  /** soldstates-4: the payout run's tries so far (20261031184338); absent until that grant is live. */
  attempts?: number;
}

export async function fetchMyBookings(orderIds: string[]): Promise<MyBooking[]> {
  if (orderIds.length === 0) return [];
  const rows = unwrap(
    // "*": pickup_day (20261028225038) is read when it exists, and the read never fails before that migration is live.
    await supabase.from("declutter_bookings").select("*").in("order_id", orderIds),
  );
  return (rows ?? []) as MyBooking[];
}

/** D-NEW11: the buyer tells the seller they're coming, on the pickup day. It only sends a notice. */
export async function onMyWay(orderId: string): Promise<"on_way" | "already"> {
  return rpcData(await supabase.rpc("declutter_on_my_way", { p_order_id: orderId }), (e) => rpcErrorMessage("declutter_on_my_way", e)) as "on_way" | "already";
}

/** The seller's payout rows (row 93): what was paid, minus any card-fee debt. */
export async function fetchMyPayouts(userId: string): Promise<MyPayout[]> {
  const cols = "order_id, items_cents, delivery_cents, refunded_cents, debt_cents, amount_cents, status, executed_at";
  const res = await supabase.from("declutter_payouts").select(`${cols}, attempts`).eq("seller_id", userId);
  // soldstates-4: attempts is readable once 20261031184338 is live; before that the column read is refused (42501,
  // permission denied for the column), so the payouts are read as before, without the try count.
  if (res.error && res.error.code === "42501" && /attempts|permission denied/i.test(res.error.message ?? "")) {
    // Not silent: the card loses only the try count; said here, as fetchMyQuestionIds does for its refusal.
    console.warn("[declutter] payout try count not readable yet; reading payouts without it", res.error);
    const rows = unwrap(await supabase.from("declutter_payouts").select(cols).eq("seller_id", userId));
    return (rows ?? []) as MyPayout[];
  }
  return (unwrap(res) ?? []) as MyPayout[];
}

/** Book (or move) the 30-minute pickup slot. */
export async function bookPickup(orderId: string, slotStartIso: string): Promise<{ result: string }> {
  return rpcData(
    await supabase.rpc("declutter_book_pickup", { p_order_id: orderId, p_slot_start: slotStartIso }),
    (e) => rpcErrorMessage("declutter_book_pickup", e),
  ) as unknown as { result: string };
}

/**
 * The porch DAYS the buyer may pick (owner 2026-10-28: "make porch just pick a day"): today until the
 * 7-day pickup deadline, on the seller's pickup weekdays (declutter_porch_days, 20261028225038). Null while
 * that migration has not reached prod: the screen then books a time as before.
 */
export async function fetchPorchDays(orderId: string): Promise<string[] | null> {
  const res = await supabase.rpc("declutter_porch_days", { p_order_id: orderId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_porch_days")) return null;
  const rows = rpcData(res, (e) => rpcErrorMessage("declutter_porch_days", e)) as unknown;
  // A SETOF date comes back as plain "yyyy-mm-dd" strings.
  return Array.isArray(rows) ? rows.map((r) => String(r)) : [];
}

/** Book or move the porch day (declutter_book_porch_day): the item is out all that day once the seller posts the photo. */
export async function bookPorchDay(orderId: string, day: string): Promise<{ result: string }> {
  return rpcData(
    await supabase.rpc("declutter_book_porch_day", { p_order_id: orderId, p_day: day }),
    (e) => rpcErrorMessage("declutter_book_porch_day", e),
  ) as unknown as { result: string };
}

/** Porch timing (row 97): "out all day" or "out until <time>". */
export async function setPorchTime(orderId: string, mode: "all_day" | "until", untilIso: string | null): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_set_porch_time", { p_order_id: orderId, p_mode: mode, p_until: untilIso as string }),
    (e) => rpcErrorMessage("declutter_set_porch_time", e),
  );
}

type HandoverResult =
  | { result: "handed_over"; payout_id: string | null; by: string }
  | { result: "already_handed_over" }
  /** The seller's "Picked up" on a paid sale: recorded, and it waits for the buyer (owner 10-30). */
  | { result: "seller_confirmed" };

/** The buyer's "I got it" ('buyer'): the only way a person confirms a Declutter handover (owner 2026-10-18). */
export async function confirmHandover(orderId: string): Promise<HandoverResult> {
  // nullable-arg: p_code is always NULL now that handovers have no code (20261018183715 ignores it).
  return rpcData(
    await supabase.rpc("declutter_confirm_handover", { p_order_id: orderId, p_method: "buyer", p_code: null as unknown as string }),
    (e) => rpcErrorMessage("declutter_confirm_handover", e),
  ) as unknown as HandoverResult;
}

/**
 * The seller's "Picked up" on a pickup at the door (big items, porch_ok off; owner 2026-10-18):
 * completes the handover like the buyer's "I got it". The photo is optional; with one, `where` is the device's
 * position, checked against the handover place (20261028235709: the pickup address, or the meeting spot).
 */
export async function sellerPickedUp(orderId: string, photoPath: string | null, where: { lat: number; lng: number } | null = null): Promise<HandoverResult> {
  const res = await supabase.rpc("declutter_seller_picked_up", {
    p_order_id: orderId,
    p_photo_path: photoPath as string,
    p_lat: (where?.lat ?? null) as number,
    p_lng: (where?.lng ?? null) as number,
  });
  if (res.error) await discardRefusedHandoverPhoto(photoPath);
  return rpcData(res, (e) => rpcErrorMessage("declutter_seller_picked_up", e)) as unknown as HandoverResult;
}

/**
 * Porch photo (row 26). Seller: "Set out". Buyer: "Picked up"; it pays the
 * seller right away unless a problem is open (row 99, owner 2026-10-15). Both
 * are taken at the address (`where`, within 200 m; the seller's since
 * 20261028235709).
 */
export async function porchPhoto(
  orderId: string,
  photoPath: string,
  where: { lat: number; lng: number } | null,
): Promise<{ result: "set_out" | "picked_up" | "already_handed_over"; paid?: boolean; distance_m?: number }> {
  const res = await supabase.rpc("declutter_porch_photo", {
    p_order_id: orderId,
    p_photo_path: photoPath,
    p_lat: (where?.lat ?? null) as number,
    p_lng: (where?.lng ?? null) as number,
  });
  if (res.error) await discardRefusedHandoverPhoto(photoPath);
  return rpcData(res, (e) => rpcErrorMessage("declutter_porch_photo", e)) as unknown as { result: "set_out" | "picked_up" | "already_handed_over"; paid?: boolean; distance_m?: number };
}

/**
 * Clean (metadata stripped, like listing photos) and upload one handover
 * photo to `<uid>/declutter/handover/<order>/<file>`, the only path the SQL
 * accepts. Returns the path for porchPhoto / reportProblem.
 *
 * The bucket is PRIVATE (20261017055502): a porch photo shows the seller's
 * home, so it is never a public URL. Only the two sides of the order and
 * admins can read it, through a signed URL (storage createSignedUrl).
 */
const DECLUTTER_HANDOVER_BUCKET = "declutter-handover";
/** Clean a photo (metadata stripped, shrunk) into the one type the handover bucket's uploads use, or refuse it. */
async function cleanHandoverPhoto(file: File): Promise<File> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  return cleaned;
}
/** Upload a cleaned photo to `path` in the private handover bucket: immutable, never overwriting. */
async function putHandoverPhoto(path: string, cleaned: File): Promise<string> {
  const { error } = await supabase.storage.from(DECLUTTER_HANDOVER_BUCKET).upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw new Error("photo_not_uploaded");
  return path;
}
const photoNonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
export async function uploadHandoverPhoto(userId: string, orderId: string, file: File): Promise<string> {
  // Live camera only (20261029002010): a photo taken more than 10 minutes ago is refused before it is uploaded.
  assertLivePhoto(file);
  const cleaned = await cleanHandoverPhoto(file);
  const nonce = photoNonce();
  const path = `${userId}/declutter/handover/${orderId}/${nonce}.jpg`;
  return putHandoverPhoto(path, cleaned);
}

/**
 * Declutter audit 1a #10: when a handover photo RPC (porch photo, seller "Picked up", seller "Delivered") refuses
 * the photo it was given (wrong place, too old, before the booked day), remove the uploaded file so a photo of
 * the member's home does not stay in storage. Best effort: it never throws and never replaces the RPC's own
 * error. The storage policy (20261029222816) lets the uploader delete only their own handover-folder file while
 * no handover row holds it, so a photo the RPC did attach is never removed here.
 */
export async function discardRefusedHandoverPhoto(path: string | null | undefined): Promise<void> {
  if (!isStorageObjectPath(path)) return;
  try {
    const { error } = await supabase.storage.from(DECLUTTER_HANDOVER_BUCKET).remove([path]);
    if (error) console.warn("[declutter] refused handover photo not removed", error.message);
  } catch (e) {
    // Best effort: the member sees the RPC's refusal, never this cleanup's failure.
    console.warn("[declutter] refused handover photo not removed", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Audit 1b D2-7: one photo for a problem report or a refund request, cleaned and shrunk like every Declutter photo
 * (cleanListingPhoto: metadata stripped, at most 1920 px), to `<uid>/declutter/problem/<order>/<file>` (the signed-in
 * member's own folder), the folder declutter_handover_photo_access and declutter_report_problem accept. Evidence, not
 * a handover: a photo taken earlier (the damage when it was opened) is fine, so there is no live-camera check.
 */
export async function uploadProblemPhoto(orderId: string, file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new Error("not_authenticated");
  const problemPhoto = await cleanHandoverPhoto(file);
  return putHandoverPhoto(`${uid}/declutter/problem/${orderId}/${photoNonce()}.jpg`, problemPhoto);
}

/** Boards 71/72/159: where the handover stands, for either side (declutter_my_handover; never a code). */
export interface MyHandover {
  order_id: string;
  status: "paid" | "handed_over";
  side: "buyer" | "seller";
  confirmed_at: string | null;
  /** Who made the handover: "buyer" ("I got it"), "seller", "auto", "admin"... (declutter_my_handover). */
  confirmed_by?: string | null;
  set_out_at: string | null;
  set_out_photo_path: string | null;
  /** Board 159 / Q2266: the seller's "Where exactly?" note (absent until 20261021023158 is on prod). */
  set_out_note?: string | null;
  picked_up_at: string | null;
  /** The seller's "Picked up" (owner 10-30, 20261031004529). Absent before that migration reaches prod. */
  seller_confirmed_at?: string | null;
  /** The buyer's no-show report, and when the seller's 24 hours to answer end. */
  no_show_reported_at?: string | null;
  no_show_answer_by?: string | null;
}

export async function fetchMyHandover(orderId: string): Promise<MyHandover> {
  const res = await supabase.rpc("declutter_my_handover", { p_order_id: orderId });
  if (res.error) {
    const words = rpcErrorMessage("declutter_my_handover", res.error);
    throw Object.assign(new Error(res.error.message), words ? { userMessage: words } : {});
  }
  return res.data as unknown as MyHandover;
}

/**
 * Board 159 / Q2266: the seller's "Where exactly?" note, sent right after the porch photo. Returns the note as
 * saved, or "not_deployed" while migration 20261021023158 has not reached prod (the photo still went through).
 */
export async function porchNote(orderId: string, note: string): Promise<string | null | "not_deployed"> {
  const res = await supabase.rpc("declutter_porch_note", { p_order_id: orderId, p_note: note });
  if (res.error && isMissingRpcNamed(res.error, "declutter_porch_note")) return "not_deployed";
  return rpcData(res, (e) => rpcErrorMessage("declutter_porch_note", e)) as string | null;
}

/** A short-lived link to a handover photo (the two sides and admins may read it). */
export async function handoverPhotoUrl(path: string): Promise<string | null> {
  // Sign only a storage path, never a URL or anything else a row might hold (signedUrlOnlyForStoragePaths).
  if (!isStorageObjectPath(path)) return null;
  const { data, error } = await supabase.storage.from(DECLUTTER_HANDOVER_BUCKET).createSignedUrl(path, 600);
  if (error) {
    console.warn("[declutter] handover photo link failed", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** "They didn't show", 15 minutes after the booked time (row 94). */
/** The seller's answer to a buyer's no-show report: a problem for Louisiana Helpr, with the money held. */
export async function answerNoShow(orderId: string, note: string): Promise<void> {
  rpcData(await supabase.rpc("declutter_answer_no_show", { p_order_id: orderId, p_note: note }), (e) => rpcErrorMessage("declutter_answer_no_show", e));
}

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

/** D2-3 (20261029225634): an order's newest problem as either side reads it (RLS: the two sides and admins). */
export interface OrderProblem {
  id: string;
  /** "system": nobody's report, a sale held 60 days with nobody speaking (20261031004529). */
  reporter_side: "buyer" | "seller" | "helpr" | "system";
  reason: ProblemReason;
  note: string;
  photo_paths: string[];
  // "withdrawn": the reporter took it back (B100, 20261030134109).
  status: "open" | "decided" | "withdrawn";
  created_at: string;
  /** The other side's words and photos; absent before 20261029225634 reaches prod. */
  other_side_note?: string | null;
  other_side_photo_paths?: string[];
  other_side_at?: string | null;
  /** DB-12 (20261030080104): what Louisiana Helpr decided, and when; null while open, absent before it reaches prod. */
  decision?: "refund_buyer" | "refund_part" | "pay_seller" | "delivery_damage" | null;
  decided_at?: string | null;
}

/**
 * Audit 1030 DB-1: through the party-scoped read declutter_order_problem (20261030044444: buyer, seller or admin;
 * only the card's columns). The old select("*") was refused 42501 on prod for every member: authenticated's column
 * grant has no other_side_* or decided_by. Until the read is deployed (PGRST202) the granted columns are read, so the
 * card shows the report without the other side's words, instead of nothing.
 */
export async function fetchOrderProblem(orderId: string): Promise<OrderProblem | null> {
  const res = await supabase.rpc("declutter_order_problem", { p_order_id: orderId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_order_problem")) {
    const rows = unwrap(
      await supabase.from("declutter_problems").select("id, reporter_side, reason, note, photo_paths, status, created_at")
        .eq("order_id", orderId).order("created_at", { ascending: false }).limit(1),
    );
    return ((rows ?? [])[0] ?? null) as OrderProblem | null;
  }
  return (rpcData(res, (e) => rpcErrorMessage("declutter_order_problem", e)) ?? null) as unknown as OrderProblem | null;
}

/**
 * B100 (owner 2026-10-30, 20261030134109): the member who reported an OPEN problem takes it back, until Louisiana
 * Helpr decides. The payout hold lifts and the 24-hour clocks run on from where they started. "already" when it was
 * taken back before. A build newer than the database (the RPC not deployed yet) says so instead of failing silently.
 */
export async function withdrawProblem(problemId: string): Promise<{ result: "withdrawn" | "already"; problem_id: string }> {
  const res = await supabase.rpc("declutter_withdraw_problem", { p_problem_id: problemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_withdraw_problem")) {
    throw new Error("Taking back a report isn't available yet. Try again in a few minutes.");
  }
  return rpcData(res, (e) => rpcErrorMessage("declutter_withdraw_problem", e)) as unknown as { result: "withdrawn" | "already"; problem_id: string };
}

/** D2-3: the OTHER side of the sale adds their words (and up to 3 problem-folder photos) to an open problem. */
export async function addProblemSide(problemId: string, note: string, photoPaths: string[] = []): Promise<{ result: "added"; problem_id: string }> {
  return rpcData(
    await supabase.rpc("declutter_problem_add_side", { p_problem_id: problemId, p_note: note, p_photo_paths: photoPaths }),
    (e) => rpcErrorMessage("declutter_problem_add_side", e),
  ) as unknown as { result: "added"; problem_id: string };
}

/** Audit 1b D2-2: an order's open problem, as both sides see it on their order card. */
export interface OpenProblem {
  id: string;
  order_id: string;
  // "helpr": the Helpr on a Helpr delivery can report too (declutter_problems allows it; NIGHT-BUYINGopenpr-8 saw one).
  reporter_side: "buyer" | "seller" | "helpr" | "system";
  reason: ProblemReason;
}

/**
 * Audit 1b D2-2: the open problems on these orders. Both sides read their own orders' problems
 * (RLS "declutter problems: the two sides and admins read", 20261015042253; column grant without decided_by).
 */
export async function fetchOpenProblems(orderIds: string[]): Promise<OpenProblem[]> {
  if (!orderIds.length) return [];
  const q = supabase.from("declutter_problems").select("id, order_id, reporter_side, reason");
  const rows = unwrap(await q.in("order_id", orderIds).eq("status", "open"));
  return (rows ?? []) as OpenProblem[];
}

/** A review after the handover (row 45), both ways, blind until both or 14 days. */
/**
 * Q2265: `tags` go only when chosen, so the call works before and after migration 20261021023530. Before it
 * reaches prod a call WITH tags finds no 4-argument function (PGRST202): the review is sent without them, and
 * `tagsDropped` says so, so the sheet can tell the member (lh-authz-rls review #3).
 */
export async function leaveReview(
  orderId: string,
  stars: number,
  comment: string | null,
  tags: readonly string[] = [],
): Promise<{ id: string; tagsDropped: boolean }> {
  const base = { p_order_id: orderId, p_stars: stars, p_comment: comment as string };
  // One call site for both tries (rpcErrorCopyCoverage reads each call site's copy).
  const send = (args: typeof base & { p_tags?: string[] }) => supabase.rpc("declutter_leave_review", args);
  let res = await send(tags.length ? { ...base, p_tags: [...tags] } : base);
  let tagsDropped = false;
  if (tags.length && res.error && isMissingRpcNamed(res.error, "declutter_leave_review")) {
    console.warn("[declutter] review tags not deployed yet; sending the review without them");
    tagsDropped = true;
    res = await send(base);
  }
  return { id: rpcData(res, (e) => rpcErrorMessage("declutter_leave_review", e)) as string, tagsDropped };
}

/**
 * The seller's pickup windows (deep audit #2 + #58; 20261028195840): for a live or reserved listing (any signed-in
 * member), or for an order (its paid buyer, its seller, its assigned Helpr) with the 7-day pickup deadline. Null
 * until the reads are deployed (PGRST202), so the screens fall back to what they showed before.
 */
export async function fetchItemPickupWindows(itemId: string): Promise<SellerWindow[] | null> {
  const res = await supabase.rpc("declutter_item_pickup_windows", { p_item_id: itemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_item_pickup_windows")) return null;
  return (rpcData(res, (e) => rpcErrorMessage("declutter_item_pickup_windows", e)) ?? []) as SellerWindow[];
}

export async function fetchOrderPickupWindows(orderId: string): Promise<{ windows: SellerWindow[]; latestPickupAt: string | null } | null> {
  const res = await supabase.rpc("declutter_order_pickup_windows", { p_order_id: orderId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_order_pickup_windows")) return null;
  const rows = (rpcData(res, (e) => rpcErrorMessage("declutter_order_pickup_windows", e)) ?? []) as (SellerWindow & { latest_pickup_at: string | null })[];
  return { windows: rows.map(({ weekday, starts, ends }) => ({ weekday, starts, ends })), latestPickupAt: rows[0]?.latest_pickup_at ?? null };
}

/** The exact pickup address: the paid buyer and the seller only (rows 27, 98). */
export async function fetchItemAddress(itemId: string): Promise<{ pickup_address: string; pickup_lat: number; pickup_lng: number } | null> {
  const rows = rpcData(
    await supabase.rpc("declutter_item_address", { p_item_id: itemId }),
    (e) => rpcErrorMessage("declutter_item_address", e),
  );
  return (rows?.[0] ?? null) as { pickup_address: string; pickup_lat: number; pickup_lng: number } | null;
}

/**
 * Admin "Declutter problems" card: decide refund the buyer / pay the seller, by fault, optional strike.
 * `falseReport` (AL-5, 20261029000048): the report was false, so its reporter gets a Declutter strike for it. Sent
 * only when true, so the five-argument call stays valid against a database without the new parameter.
 */
export async function adminDecideProblem(
  problemId: string,
  decision: "refund_buyer" | "pay_seller" | "refund_part",
  /** "helpr" (LEAD-ADMIN-HELPR-FAULT, 20261101000817): a Helpr delivery the Helpr took and never brought; refund only. */
  fault: "seller" | "buyer" | "none" | "helpr",
  strike: boolean,
  note: string | null,
  falseReport = false,
  /** D2-14 (20261029231235): exactly this much of the item price back; only with "refund_part". */
  partCents: number | null = null,
): Promise<Record<string, unknown>> {
  const res = await supabase.rpc("declutter_admin_decide_problem", {
    p_problem_id: problemId, p_decision: decision, p_fault: fault, p_strike: strike, p_note: note as string,
    ...(falseReport ? { p_false_report: true } : {}),
    ...(decision === "refund_part" && partCents !== null ? { p_part_cents: partCents } : {}),
  });
  // Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_decide_problem", e) ?? null) as unknown as Record<string, unknown>;
}

/**
 * Admin "Declutter problems" card, a delivery the Helpr has (row 43, slice 5):
 * damaged in delivery. The buyer gets everything back, the seller is still
 * paid, the Helpr is not paid and gets a delivery strike
 * (declutter_admin_decide_delivery_damage, 20261017055505).
 */
export async function adminDecideDeliveryDamage(problemId: string, note: string | null): Promise<Record<string, unknown>> {
  const res = await supabase.rpc("declutter_admin_decide_delivery_damage", { p_problem_id: problemId, p_note: note as string });
  // Admin-only copy is fetched only on a refusal, as for adminDecideProblem.
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_decide_delivery_damage", e) ?? null) as unknown as Record<string, unknown>;
}

/** BUY-36 (20261031231150): a delivery the Helpr has and can't finish: nobody's fault, or the Helpr's. */
export async function adminDecideStuckDelivery(problemId: string, fault: "none" | "helpr", note: string | null): Promise<Record<string, unknown>> {
  const res = await supabase.rpc("declutter_admin_decide_stuck_delivery", { p_problem_id: problemId, p_fault: fault, p_note: note as string });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_decide_stuck_delivery", e) ?? null) as unknown as Record<string, unknown>;
}

/**
 * A2-13 (audit2 SH2-4, 2026-10-28): what the admin needs to decide a problem
 * without opening the database: the item, what was paid, both people and the
 * handover photos with their time and place. RLS gives an admin
 * declutter_problems and profiles but not the order, its items or the
 * handover, so these come from the admin-only declutter_admin_open_problems
 * (builder 1). Until it is on prod the card shows what it always showed.
 */
export interface AdminProblemDetail {
  handover: string | null;
  /** The order's status ('paid', 'handed_over', ...): a part refund is offered only after the handover (D2-14). */
  order_status?: string | null;
  items_cents: number | null;
  bundle_discount_cents: number | null;
  delivery_cents: number | null;
  premium_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  paid_at: string | null;
  item_titles: string[];
  item_photo_paths: string[];
  buyer_name: string | null;
  seller_name: string | null;
  set_out_photo_path: string | null;
  set_out_at: string | null;
  picked_up_photo_path: string | null;
  picked_up_at: string | null;
  picked_up_distance_m: number | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  /** True when a Helpr carries this order: only then is "Damaged in delivery" a decision (audit2 SH2-4). */
  helpr_delivery: boolean | null;
  /** D2-3 / D2-14 (20261029231235): the other side's words and photos, and the seller's last part offer. Absent before. */
  other_side_note?: string | null;
  other_side_photo_paths?: string[] | null;
  refund_offer_cents?: number | null;
}
export interface AdminProblem {
  id: string;
  order_id: string;
  /** "system": nobody's report, a sale held 60 days with nobody speaking (20261031004529). */
  reporter_side: "buyer" | "seller" | "helpr" | "system";
  reason: string;
  note: string;
  photo_paths: string[] | null;
  created_at: string;
  /** null while declutter_admin_open_problems is not on prod. */
  detail: AdminProblemDetail | null;
}
type AdminProblemRow = Omit<AdminProblemDetail, "item_titles" | "item_photo_paths"> & {
  problem_id: string; order_id: string; reporter_side: AdminProblem["reporter_side"]; reason: string; note: string;
  problem_photo_paths: string[] | null; reported_at: string; item_titles: string[] | null; item_photo_paths: string[] | null;
};

/**
 * `includeTest`: the admin's "Show test listings" switch (audit 1028 part 2, D2-4). The server hides every problem on
 * a test (is_seed) order unless p_include_test, so without it a test-account problem could never be decided in the UI.
 */
export async function fetchOpenProblemsWithDetail(includeTest = false): Promise<AdminProblem[]> {
  const res = await supabase.rpc("declutter_admin_open_problems", { p_include_test: includeTest });
  if (res.error && isMissingRpcNamed(res.error, "declutter_admin_open_problems")) {
    const rows = (await fetchOpenProblemsForAdmin()) as Omit<AdminProblem, "detail">[];
    return rows.map((r) => ({ ...r, detail: null }));
  }
  // Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  const rows = (rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_open_problems", e) ?? null) ?? []) as unknown as AdminProblemRow[];
  return rows.map(({ problem_id, problem_photo_paths, reported_at, order_id, reporter_side, reason, note, item_titles, item_photo_paths, ...d }) => ({
    id: problem_id, order_id, reporter_side, reason, note, photo_paths: problem_photo_paths, created_at: reported_at,
    detail: { ...d, item_titles: item_titles ?? [], item_photo_paths: item_photo_paths ?? [] },
  }));
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
