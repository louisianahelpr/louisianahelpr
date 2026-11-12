/**
 * Shops handover and payout (Shops M2, migration 20261018211820_shops_handover_payout;
 * docs/specs/local-shops-prep.md L23, L40; owner pop-up 2026-10-18: each shop
 * picks "left out" or "in person", NO codes anywhere).
 *
 *   left out ('porch'): the shop marks the order ready WITH a photo; the buyer
 *     taps "I got it"; else the shop is paid 48 h after the later of the photo
 *     and the start of the ready day (H5; shop_handover_sweep's rule).
 *   in person ('in_person'): the buyer taps "I got it", or the shop taps
 *     "Handed over" and the shop is paid 48 h later unless the buyer reports a
 *     problem (H5, Declutter's 10-30 rule, migration 20261105182903). If nobody
 *     taps, the money stays held and both are nudged; nothing pays on its own.
 *
 * Every RPC refusal comes back with its plain words (rpcErrorMessage). The
 * shop's payout is written by the server at the handover and sent by the money
 * cron; members only read their own rows (RLS).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { isStorageObjectPath } from "@/lib/storagePath";
import { rpcErrorMessage } from "./rpcErrorCopy";
import { chargeOrderRest } from "./orders";

export type HandoverMode = "porch" | "in_person";

/** The two choices in the words a shop reads when it picks, and a buyer before paying. */
export const HANDOVER_MODE_TEXT: Record<HandoverMode, { label: string; detail: string }> = {
  in_person: {
    label: "Pick up in person",
    detail: "The buyer picks the order up from you and taps \"I got it\". Or you tap \"Handed over\", and you're paid 48 hours later unless the buyer reports a problem.",
  },
  porch: {
    label: "Left out for pickup",
    detail: "You leave the order out and take a photo of it. The buyer taps \"I got it\". With your photo, you're paid 48 hours after it (or after the ready day starts, if that is later) unless the buyer reports a problem.",
  },
};
export const HANDOVER_MODES = Object.keys(HANDOVER_MODE_TEXT) as HandoverMode[];

/** The handover row both sides read (no code: there is none). */
export interface ShopHandover {
  ready_at: string | null;
  ready_photo_path: string | null;
  confirmed_at: string | null;
  confirmed_how: "buyer" | "auto" | "admin" | null;
  problem_at: string | null;
  /** H5: the shop's "Handed over" tap (in person); the buyer then has 48 hours. */
  shop_confirmed_at?: string | null;
}

/** A payout the shop reads on its dashboard. */
export interface ShopPayout {
  id: string;
  order_id: string;
  items_cents: number;
  debt_cents: number;
  /** H4: the one-time account setup fee taken from this payout (also inside debt_cents). 0 on almost every row. */
  setup_fee_cents?: number | null;
  amount_cents: number;
  status: "pending" | "succeeded" | "failed" | "nothing_due";
  created_at: string;
  executed_at: string | null;
}

function rpcFail(error: { message: string }, words: string | null | undefined): never {
  throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
}

export async function fetchHandoverMode(shopId: string): Promise<HandoverMode> {
  const row = unwrap(await supabase.from("shops").select("handover_mode").eq("id", shopId).maybeSingle());
  return ((row as { handover_mode?: HandoverMode } | null)?.handover_mode ?? "in_person");
}

export async function setHandoverMode(mode: HandoverMode): Promise<HandoverMode> {
  const { data, error } = await supabase.rpc("shops_set_handover_mode", { p_mode: mode });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_handover_mode", error));
  return data as HandoverMode;
}

/** The handover rows of the given orders (RLS: the member's own orders only), by order id. */
export async function fetchHandovers(orderIds: string[]): Promise<Map<string, ShopHandover>> {
  if (orderIds.length === 0) return new Map();
  const rows = unwrap(
    await supabase.from("shop_handovers").select("order_id, ready_at, ready_photo_path, confirmed_at, confirmed_how, problem_at, shop_confirmed_at")
      .in("order_id", orderIds),
  ) as unknown as Array<ShopHandover & { order_id: string }> | null;
  return new Map((rows ?? []).map((r) => [r.order_id, r]));
}

/** The shop's payouts, newest first (RLS: its own orders only). */
export async function fetchMyShopPayouts(): Promise<ShopPayout[]> {
  const rows = unwrap(
    await supabase.from("shop_payouts").select("id, order_id, items_cents, debt_cents, setup_fee_cents, amount_cents, status, created_at, executed_at")
      .order("created_at", { ascending: false }).limit(100),
  );
  return (rows ?? []) as unknown as ShopPayout[];
}

const SHOP_HANDOVER_BUCKET = "shop-handover";
/**
 * Clean (metadata stripped, like listing photos) and upload the shop's ready
 * photo to `<uid>/shops/handover/<order>/<file>`, the only path the SQL takes.
 * The bucket is PRIVATE: a left-out order's photo shows where the shop is.
 */
export async function uploadReadyPhoto(userId: string, orderId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = `${userId}/shops/handover/${orderId}/${nonce}.jpg`;
  const { error } = await supabase.storage.from(SHOP_HANDOVER_BUCKET).upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw Object.assign(new Error("photo_not_uploaded"), { userMessage: "That photo didn't finish uploading. Try again." });
  return path;
}

/** A short-lived link to the ready photo (the two sides and admins may read it). */
export async function readyPhotoUrl(path: string): Promise<string | null> {
  if (!isStorageObjectPath(path)) return null;
  const { data, error } = await supabase.storage.from(SHOP_HANDOVER_BUCKET).createSignedUrl(path, 600);
  if (error) {
    console.warn("[shops] ready photo link failed", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** The shop: ready (left out: photoPath required; in person: optional). */
export async function markReady(orderId: string, photoPath: string | null): Promise<void> {
  const { error } = await supabase.rpc("shops_mark_ready", { p_order_id: orderId, p_photo_path: photoPath as string });
  if (error) rpcFail(error, rpcErrorMessage("shops_mark_ready", error));
}

/** The shop (in person): "Handed over". Never finishes the order: the buyer has 48 hours to report a problem. */
export async function markHandedOver(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("shops_mark_handed_over", { p_order_id: orderId });
  if (!error) return;
  // Custom orders (50% deposit): the rest is not paid yet. The tap tries the saved card once, then hands over only
  // if it took; otherwise the refusal's own words stand (the buyer has been asked to pay it).
  if (/balance_not_paid/.test(error.message ?? "")) {
    const { paid } = await chargeOrderRest(orderId);
    if (paid) {
      const again = await supabase.rpc("shops_mark_handed_over", { p_order_id: orderId });
      if (!again.error) return;
      rpcFail(again.error, rpcErrorMessage("shops_mark_handed_over", again.error));
    }
  }
  rpcFail(error, rpcErrorMessage("shops_mark_handed_over", error));
}

/** The buyer: "I got it". The shop is owed right away. */
export async function confirmPickup(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("shops_confirm_pickup", { p_order_id: orderId });
  if (error) rpcFail(error, rpcErrorMessage("shops_confirm_pickup", error));
}

/**
 * S018 (Shops audit 11-12): the buyer's optional problem photo, cleaned like every listing photo (metadata/GPS
 * stripped), into `<uid>/shops/problem/<order>/<file>` of the same PRIVATE bucket (20261112090512). Only the buyer and
 * an admin can read it; the shop never does.
 */
async function uploadProblemPhoto(userId: string, orderId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = `${userId}/shops/problem/${orderId}/${nonce}.jpg`;
  // Never overwrites (upsert off), as the ready photo.
  const { error } = await supabase.storage.from(SHOP_HANDOVER_BUCKET).upload(path, cleaned, { contentType: "image/jpeg", cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, upsert: false });
  if (error) throw Object.assign(new Error("photo_not_uploaded"), { userMessage: "That photo didn't finish uploading. Try again." });
  return path;
}

/** True for a buyer's problem photo path (shop-handover bucket); a Helpr's answer photo lives in helpr-tasks. */
export function isShopProblemPhotoPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.split("/")[1] === "shops" && path.split("/")[2] === "problem";
}

/**
 * The buyer did not get it: no automatic finish and no payout until Louisiana Helpr decides. With a photo, the photo
 * is uploaded first; a refused report removes its unsent upload (the server's DELETE policy allows only that).
 */
export async function reportNotReceived(orderId: string, note: string, photo?: { userId: string; file: File } | null): Promise<void> {
  const photoPath = photo ? await uploadProblemPhoto(photo.userId, orderId, photo.file) : null;
  const { error } = await supabase.rpc("shops_report_not_received", {
    p_order_id: orderId,
    p_note: note.trim(),
    ...(photoPath ? { p_photo_path: photoPath } : {}),
  });
  if (error) {
    if (photoPath) {
      const removed = await supabase.storage.from(SHOP_HANDOVER_BUCKET).remove([photoPath]);
      if (removed.error) console.warn("[shops] unsent problem photo not removed", removed.error.message);
    }
    rpcFail(error, rpcErrorMessage("shops_report_not_received", error));
  }
}

/** The payout line under a handed-over order, in the shop's words. */
export function payoutText(p: Pick<ShopPayout, "status" | "amount_cents" | "debt_cents" | "setup_fee_cents">): string {
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  // H4: the one-time setup fee is counted inside debt_cents on the server; it is named apart from card fees.
  const setup = Math.max(0, Number(p.setup_fee_cents ?? 0));
  const cardDebt = Math.max(0, p.debt_cents - setup);
  const parts = [
    ...(cardDebt > 0 ? [`${dollars(cardDebt)} card fee you owed`] : []),
    ...(setup > 0 ? [`the one-time ${dollars(setup)} account setup fee`] : []),
  ];
  const debt = parts.length > 0 ? ` (${parts.join(" and ")} ${parts.length > 1 ? "were" : "was"} taken out)` : "";
  switch (p.status) {
    case "succeeded": return `${dollars(p.amount_cents)} sent to your payout account${debt}.`;
    case "nothing_due": return `This order paid off ${dollars(cardDebt)} of card fees you owed, so nothing was sent.`;
    // Not "on its way": a pending payout may still wait for payout setup, a payout hold or a review (money review 6).
    case "failed": return `${dollars(p.amount_cents)} is owed to you${debt}. Sending it hasn't worked yet; we keep trying, and Louisiana Helpr steps in if it keeps failing.`;
    case "pending": return `${dollars(p.amount_cents)} is owed to you${debt}. It's sent to your payout account once payouts are set up in Settings and nothing is on hold.`;
  }
}
