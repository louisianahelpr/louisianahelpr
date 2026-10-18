/**
 * Shops handover and payout (Shops M2, migration 20261018184113_shops_handover_payout;
 * docs/specs/local-shops-prep.md L23, L40; owner pop-up 2026-10-18: each shop
 * picks "left out" or "in person", NO codes anywhere).
 *
 *   left out ('porch'): the shop marks the order ready WITH a photo; the buyer
 *     taps "I got it"; else it finishes 24 h after the ready date (with the photo).
 *   in person ('in_person'): the buyer taps "I got it" or the shop taps "Picked
 *     up"; else it finishes 24 h after the ready date.
 *
 * Every RPC refusal comes back with its plain words (rpcErrorMessage). The
 * shop's payout is written by the server at the handover and sent by the money
 * cron; members only read their own rows (RLS).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { rpcErrorMessage, type ShopsRpc } from "./rpcErrorCopy";

export type HandoverMode = "porch" | "in_person";

/** The two choices in the words a shop reads when it picks, and a buyer before paying. */
export const HANDOVER_MODE_TEXT: Record<HandoverMode, { label: string; detail: string }> = {
  in_person: {
    label: "Pick up in person",
    detail: "The buyer picks the order up from you. They tap \"I got it\", or you tap \"Picked up\". If neither of you does, the order finishes 24 hours after the ready date.",
  },
  porch: {
    label: "Left out for pickup",
    detail: "You leave the order out and take a photo of it. The buyer taps \"I got it\". With your photo, the order finishes on its own 24 hours after the ready date.",
  },
};
export const HANDOVER_MODES = Object.keys(HANDOVER_MODE_TEXT) as HandoverMode[];

/** The handover row both sides read (no code: there is none). */
export interface ShopHandover {
  ready_at: string | null;
  ready_photo_path: string | null;
  confirmed_at: string | null;
  confirmed_how: "buyer" | "shop" | "auto" | "admin" | null;
  problem_at: string | null;
}

/** A payout the shop reads on its dashboard. */
export interface ShopPayout {
  id: string;
  order_id: string;
  items_cents: number;
  debt_cents: number;
  amount_cents: number;
  status: "pending" | "succeeded" | "failed" | "nothing_due";
  created_at: string;
  executed_at: string | null;
}

function rpcFail(rpc: ShopsRpc, error: { message: string }): never {
  const words = rpcErrorMessage(rpc, error);
  throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
}

export async function fetchHandoverMode(shopId: string): Promise<HandoverMode> {
  const row = unwrap(await supabase.from("shops").select("handover_mode").eq("id", shopId).maybeSingle());
  return ((row as { handover_mode?: HandoverMode } | null)?.handover_mode ?? "in_person");
}

export async function setHandoverMode(mode: HandoverMode): Promise<HandoverMode> {
  const { data, error } = await supabase.rpc("shops_set_handover_mode", { p_mode: mode });
  if (error) rpcFail("shops_set_handover_mode", error);
  return data as HandoverMode;
}

/** The handover rows of the given orders (RLS: the member's own orders only), by order id. */
export async function fetchHandovers(orderIds: string[]): Promise<Map<string, ShopHandover>> {
  if (orderIds.length === 0) return new Map();
  const rows = unwrap(
    await supabase.from("shop_handovers").select("order_id, ready_at, ready_photo_path, confirmed_at, confirmed_how, problem_at")
      .in("order_id", orderIds),
  ) as unknown as Array<ShopHandover & { order_id: string }> | null;
  return new Map((rows ?? []).map((r) => [r.order_id, r]));
}

/** The shop's payouts, newest first (RLS: its own orders only). */
export async function fetchMyShopPayouts(): Promise<ShopPayout[]> {
  const rows = unwrap(
    await supabase.from("shop_payouts").select("id, order_id, items_cents, debt_cents, amount_cents, status, created_at, executed_at")
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
  if (error) rpcFail("shops_mark_ready", error);
}

/** The buyer: "I got it". The shop is owed right away. */
export async function confirmPickup(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("shops_confirm_pickup", { p_order_id: orderId });
  if (error) rpcFail("shops_confirm_pickup", error);
}

/** The shop, in person only: "Picked up". */
export async function markPickedUp(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("shops_mark_picked_up", { p_order_id: orderId });
  if (error) rpcFail("shops_mark_picked_up", error);
}

/** The buyer did not get it: no automatic finish and no payout until Louisiana Helpr decides. */
export async function reportNotReceived(orderId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("shops_report_not_received", { p_order_id: orderId, p_note: note.trim() });
  if (error) rpcFail("shops_report_not_received", error);
}

/** The payout line under a handed-over order, in the shop's words. */
export function payoutText(p: Pick<ShopPayout, "status" | "amount_cents" | "debt_cents">): string {
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  const debt = p.debt_cents > 0 ? ` (${dollars(p.debt_cents)} card fee you owed was taken out)` : "";
  switch (p.status) {
    case "succeeded": return `${dollars(p.amount_cents)} sent to your payout account${debt}.`;
    case "nothing_due": return `This order paid off ${dollars(p.debt_cents)} of card fees you owed, so nothing was sent.`;
    // Not "on its way": a pending payout may still wait for payout setup, a 24-hour buyer window or a review (money review 6).
    case "failed": return `${dollars(p.amount_cents)} is owed to you${debt}. Sending it hasn't worked yet; we keep trying, and Louisiana Helpr steps in if it keeps failing.`;
    case "pending": return `${dollars(p.amount_cents)} is owed to you${debt}. It's sent to your payout account once payouts are set up in Settings and any wait for the buyer is over.`;
  }
}
