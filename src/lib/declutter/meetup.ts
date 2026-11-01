/**
 * Declutter safe meetup spots (Q2425, owner 2026-10-27; migration 20261027204500).
 *
 * Public places an admin curates per parish (police "safe exchange" lots, busy stores). A buyer who'd rather not
 * share or visit a home address picks "Meet at a safe spot" at checkout and one of the spots near the seller's items;
 * the spot is frozen on the order and the seller's address is never shared. Both sides tap "I'm here" from an hour
 * before the meeting time, then the usual handover finishes it ("I got it" / "Picked up"). Every rule is the
 * server's; this module reads and calls.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { loadAdminRpcErrorCopy } from "@/lib/lifecycleErrors";
import { rpcErrorMessage } from "./meetupErrors";

export type MeetupKind = "police" | "store" | "other";

export interface MeetupSpotNear {
  id: string;
  name: string;
  address: string;
  parish: string;
  /** B110: "seller" = a public place the seller added (20261101194608). */
  kind: MeetupKind | "seller";
  note: string | null;
  miles: number | null;
  chosen: boolean;
}

export interface OrderMeetup {
  order_id: string;
  spot_name: string;
  spot_address: string;
  spot_lat: number;
  spot_lng: number;
  buyer_here_at: string | null;
  seller_here_at: string | null;
}

export interface MeetupSpotRow {
  id: string;
  parish: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: MeetupKind;
  note: string | null;
  active: boolean;
}

/** A refusal in its plain words (userMessage), the original kept and thrown. */
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

/** Active spots near the caller's cart from this seller, nearest first. [] before the migration is deployed. */
export async function fetchMeetupSpotsNear(sellerId: string): Promise<MeetupSpotNear[]> {
  const res = await supabase.rpc("declutter_meetup_spots_near", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_meetup_spots_near")) return [];
  const rows = rpcData(res, (e) => rpcErrorMessage("declutter_meetup_spots_near", e)) as unknown as MeetupSpotNear[] | null;
  return (rows ?? []).map((r) => ({ ...r, miles: r.miles === null ? null : Number(r.miles) }));
}

/** The buyer picks the spot for this seller's cart (checked again at checkout). */
export async function chooseMeetupSpot(sellerId: string, spotId: string): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_set_meetup_spot", { p_seller_id: sellerId, p_spot_id: spotId }),
    (e) => rpcErrorMessage("declutter_set_meetup_spot", e),
  );
}

/** "I'm here": 'here', or 'already_here' on a second tap. */
export async function meetupHere(orderId: string): Promise<"here" | "already_here"> {
  return rpcData(
    await supabase.rpc("declutter_meetup_here", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_meetup_here", e),
  ) as unknown as "here" | "already_here";
}

/** The spot frozen on an order (the order's two sides read it), or null. */
export async function fetchOrderMeetup(orderId: string): Promise<OrderMeetup | null> {
  const result = await supabase
    .from("declutter_order_meetups")
    .select("order_id, spot_name, spot_address, spot_lat, spot_lng, buyer_here_at, seller_here_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (isNotDeployedYet(result.error)) return null;
  return (unwrap(result) as OrderMeetup | null) ?? null;
}

/** A map link for a spot: Apple Maps opens on iPhone, and its web page works everywhere else. */
export function meetupMapUrl(m: { spot_lat: number; spot_lng: number; spot_name: string }): string {
  return `https://maps.apple.com/?ll=${Number(m.spot_lat)},${Number(m.spot_lng)}&q=${encodeURIComponent(m.spot_name)}`;
}

/** Admin: every spot (the admins-read policy), parish then name. */
export async function fetchAllMeetupSpots(): Promise<MeetupSpotRow[]> {
  const result = await supabase
    .from("declutter_meetup_spots")
    .select("id, parish, name, address, lat, lng, kind, note, active")
    // B110: sellers' own meet spots are theirs to edit, not the admin list's.
    .neq("kind", "seller")
    .order("parish")
    .order("name");
  if (isNotDeployedYet(result.error)) return [];
  return ((unwrap(result) as MeetupSpotRow[] | null) ?? []).map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
}

/** Admin: add (id null) or edit a spot; retire it with active false. Audited by the server. */
export async function adminSaveMeetupSpot(spot: Omit<MeetupSpotRow, "id"> & { id: string | null }): Promise<string> {
  const res = await supabase.rpc("admin_declutter_save_meetup_spot", {
    // nullable-arg: a new spot has no id yet (the server inserts it).
    p_id: spot.id as unknown as string,
    p_parish: spot.parish,
    p_name: spot.name,
    p_address: spot.address,
    p_lat: spot.lat,
    p_lng: spot.lng,
    p_kind: spot.kind,
    p_note: spot.note ?? "",
    p_active: spot.active,
  });
  // Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("admin_declutter_save_meetup_spot", e) ?? null) as unknown as string;
}

/**
 * B110 (owner 11-01 1:00 PM; migration 20261101194608): the SELLER's own public meet spots (a store lot, a library),
 * each with its days and times. Buyers of this seller see them under "Meet up" at checkout, with the address (a public
 * place); the police safe spots are offered as one-tap suggestions. Every rule is the server's.
 */
export type MeetupWindow = { weekday: number; starts: string; ends: string };
export interface MyMeetupSpot { id: string; name: string; address: string; area: string; lat: number; lng: number; windows: MeetupWindow[] | null }
export interface MeetupSuggestion { id: string; name: string; address: string; area: string; lat: number; lng: number }
export const MY_MEETUP_SPOTS_KEY = ["declutter", "my-meetup-spots"] as const;
export const MAX_MY_MEETUP_SPOTS = 10;
/** Before the migration is on the server (PGRST202): the card stays hidden. */
export const MEETUP_SPOTS_NOT_DEPLOYED = "not_deployed" as const;

export async function fetchMyMeetupSpots(): Promise<MyMeetupSpot[] | typeof MEETUP_SPOTS_NOT_DEPLOYED> {
  const res = await supabase.rpc("declutter_my_meetup_spots");
  if (res.error && isMissingRpcNamed(res.error, "declutter_my_meetup_spots")) return MEETUP_SPOTS_NOT_DEPLOYED;
  return ((rpcData(res, (e) => rpcErrorMessage("declutter_my_meetup_spots", e)) ?? []) as unknown as MyMeetupSpot[]);
}

export async function saveMyMeetupSpot(s: { id: string | null; name: string; address: string; area: string; lat: number; lng: number; windows: MeetupWindow[] | null }): Promise<string> {
  const res = await supabase.rpc("declutter_save_my_meetup_spot", {
    p_id: s.id, p_name: s.name, p_address: s.address, p_area: s.area, p_lat: s.lat, p_lng: s.lng, p_windows: s.windows,
  });
  return rpcData(res, (e) => rpcErrorMessage("declutter_save_my_meetup_spot", e)) as unknown as string;
}

export async function removeMyMeetupSpot(id: string): Promise<void> {
  const res = await supabase.rpc("declutter_remove_my_meetup_spot", { p_id: id });
  rpcData(res, (e) => rpcErrorMessage("declutter_remove_my_meetup_spot", e));
}

export async function fetchMeetupSuggestions(): Promise<MeetupSuggestion[]> {
  const res = await supabase.rpc("declutter_meetup_spot_suggestions");
  if (res.error && isMissingRpcNamed(res.error, "declutter_meetup_spot_suggestions")) return [];
  return ((rpcData(res, (e) => rpcErrorMessage("declutter_meetup_spot_suggestions", e)) ?? []) as unknown as MeetupSuggestion[]);
}

/**
 * B110: the days and times of the seller spot this buyer picked for this seller's cart (declutter_chosen_meetup_hours,
 * 20261101195154), so the checkout's time chips are the spot's; null for an admin spot or a spot with none.
 */
export async function fetchChosenMeetupHours(sellerId: string): Promise<MeetupWindow[] | null> {
  const res = await supabase.rpc("declutter_chosen_meetup_hours", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_chosen_meetup_hours")) return null;
  const v = rpcData(res, (e) => rpcErrorMessage("declutter_chosen_meetup_hours", e)) as unknown;
  return Array.isArray(v) && v.length > 0 ? (v as MeetupWindow[]) : null;
}
