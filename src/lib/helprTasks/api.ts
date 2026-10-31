/**
 * The shared "a Helpr picks up an item at an address and takes it to another
 * address" job flow, client side (migration 20261017055505, PART A). Declutter
 * delivery is its first source; Add a Helpr and haul-away are meant to reuse it
 * unchanged (docs/specs/declutter-auctions.md, "Slice 5 build decisions").
 *
 * Nothing here knows about Declutter: a task names its source (`source_kind`,
 * `source_id`) and every rule (who may take it, when, the photos at each end,
 * the door photo, the Helpr's pay) is enforced in SQL (helpr_task_*). The
 * exact addresses come only from helpr_task_view, and only to the assigned
 * Helpr while the task is active. A refusal throws an Error whose message is
 * the server's code; screens word it with declutterErrorMessage (the codes are
 * listed in src/lib/declutter/errors.ts with the migration that raises them).
 */
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { rpcErrorMessage } from "./errorCopy";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import type { SellerWindow } from "@/lib/declutter/pickupSlots";
import { assertLivePhoto } from "@/lib/declutter/livePhoto";

export type TaskSize = "small" | "large" | "xl";
type TaskStatus = "open" | "accepted" | "picked_up" | "delivered" | "confirmed" | "unfilled" | "cancelled" | "failed";
type TaskRole = "helpr" | "customer" | "pickup_contact" | "candidate";

/** An open task as a Helpr finds it: area words and rough miles, never an address. */
export interface OpenTask {
  task_id: string;
  source_kind: string;
  size: TaskSize;
  title: string;
  pickup_area: string;
  dropoff_area: string;
  trip_miles: number;
  miles_to_pickup: number | null;
  take_home_cents: number;
  open_until: string;
  latest_pickup_at: string;
}

/** A task as the caller may see it (helpr_task_view): fields the caller may not see are null. */
export interface TaskView {
  task_id: string;
  source_kind: string;
  source_id: string | null;
  role: TaskRole;
  status: TaskStatus;
  size: TaskSize;
  title: string;
  pickup_area: string;
  dropoff_area: string;
  trip_miles: number;
  take_home_cents: number | null;
  pay_cents: number | null;
  fee_cents: number | null;
  open_until: string;
  latest_pickup_at: string;
  pickup_slot_start: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  helpr_first_name: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  pickup_photo_path: string | null;
  dropoff_photo_path: string | null;
  /** The seller's "Handed over" for the current Helpr (20261030012018); null for a candidate or before the tap. */
  handed_over_at?: string | null;
  /** A problem holds the sale (the Helpr's "The seller wasn't there" among them); null for a candidate. */
  problem_open?: boolean | null;
}

export interface MyTask {
  task_id: string;
  status: TaskStatus;
  size: TaskSize;
  title: string;
  pickup_area: string;
  dropoff_area: string;
  trip_miles: number;
  take_home_cents: number;
  pickup_slot_start: string | null;
  payout_status: "pending" | "succeeded" | "failed" | "nothing_due" | null;
}

export interface MyVehicle {
  /** Every delivery needs a car (owner 2026-10-28, Q2452); a truck is a car. */
  has_car: boolean;
  has_truck: boolean;
  second_person: boolean;
  photo_path: string | null;
}

export type DeliveredResult =
  | { result: "confirmed"; distance_m?: number | null }
  | { result: "delivered"; distance_m?: number | null; held?: boolean }
  | { result: "already_confirmed" };

/**
 * The RPC's data, or a thrown Error carrying the server's code as its message
 * and its plain words (RPC_ERROR_COPY) as `userMessage`.
 */
function data<T>(result: { data: unknown; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data as T;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data as T;
}

/** Nearby open tasks this Helpr can take (vehicle, age, payouts, switch all checked in SQL). */
export async function fetchOpenTasks(where: { lat: number; lng: number } | null): Promise<OpenTask[]> {
  return data<OpenTask[] | null>(await supabase.rpc("helpr_tasks_open_near", {
    p_lat: (where?.lat ?? null) as number, p_lng: (where?.lng ?? null) as number, p_limit: 50,
  }), (e) => rpcErrorMessage("helpr_tasks_open_near", e)) ?? [];
}

/** Open deliveries by pickup area, whatever the caller's vehicle (helpr_tasks_open_count, audit 1c D3-6). */
export interface OpenCountRow {
  pickup_area: string;
  open_count: number;
}

/** Null before the read is deployed (Deliver then counts only the deliveries it lists). */
export async function fetchOpenCount(): Promise<OpenCountRow[] | null> {
  const res = await supabase.rpc("helpr_tasks_open_count");
  if (res.error && isMissingRpcNamed(res.error, "helpr_tasks_open_count")) return null;
  return data<OpenCountRow[] | null>(res, (e) => rpcErrorMessage("helpr_tasks_open_count", e)) ?? [];
}

export async function fetchMyTasks(): Promise<MyTask[]> {
  return data<MyTask[] | null>(await supabase.rpc("helpr_my_tasks"), (e) => rpcErrorMessage("helpr_my_tasks", e)) ?? [];
}

/** One stop of the Helpr's route (helpr_my_route): exact address and point only where helpr_task_view shows them. */
export interface RouteStop {
  seq: number;
  task_id: string;
  kind: "pickup" | "dropoff";
  status: "accepted" | "picked_up";
  title: string;
  size: TaskSize;
  area: string;
  address: string | null;
  /** A drop-off not shown yet (issue #3684): when its address will show (2 hours before the pickup). */
  address_shows_at: string | null;
  lat: number | null;
  lng: number | null;
  /** A pickup is "seller" (porch or door, not chosen; 20261028231116); "porch" / "door" from the server before it. */
  place: "porch" | "door" | "seller";
  items: { title: string; photo_path: string | null }[];
  slot_start: string | null;
  slot_end: string | null;
  arrive_at: string;
  late: boolean;
  leg_miles: number;
  /** A pickup the seller handed over to this Helpr (20261030152601): Picked up is open at once. Absent before that migration. */
  handed_over_at?: string | null;
}

export interface MyRoute {
  stops: RouteStop[];
  miles: number;
  drive_minutes: number;
  finish_at: string | null;
}

/** Every stop of the caller's deliveries in hand, in order (pickup before its drop-off, booked times kept). */
export async function fetchMyRoute(where: { lat: number; lng: number } | null): Promise<MyRoute> {
  const r = data<MyRoute | null>(await supabase.rpc("helpr_my_route", {
    p_lat: (where?.lat ?? null) as number, p_lng: (where?.lng ?? null) as number,
  }), (e) => rpcErrorMessage("helpr_my_route", e));
  return r ?? { stops: [], miles: 0, drive_minutes: 0, finish_at: null };
}

/** An open delivery on the Helpr's way (helpr_route_suggestions): area words, rough miles, take-home pay only. */
export interface RouteSuggestion {
  task_id: string;
  title: string;
  size: TaskSize;
  pickup_area: string;
  dropoff_area: string;
  trip_miles: number;
  take_home_cents: number;
  extra_minutes: number;
  extra_miles: number;
  pickup_slot_start: string;
  latest_pickup_at: string;
}

export interface RouteSuggestions {
  suggestions: RouteSuggestion[];
  reason: "too_many_taken" | "too_many_releases" | "no_route" | "none_near" | null;
}

/** Up to 3 open deliveries that add little to the Helpr's route (plus `withTask`, one they are viewing). */
export async function fetchRouteSuggestions(withTask: string | null): Promise<RouteSuggestions> {
  // nullable-arg: p_with_task is NULL for "my route only". The Helpr's position is not sent (lh-authz-rls review).
  const r = data<RouteSuggestions | null>(await supabase.rpc("helpr_route_suggestions", {
    p_with_task: withTask as string,
  }), (e) => rpcErrorMessage("helpr_route_suggestions", e));
  return r ?? { suggestions: [], reason: null };
}

export async function fetchTaskView(taskId: string): Promise<TaskView> {
  return data<TaskView>(await supabase.rpc("helpr_task_view", { p_task_id: taskId }), (e) => rpcErrorMessage("helpr_task_view", e));
}

export async function fetchMyVehicle(userId: string): Promise<MyVehicle | null> {
  const row = unwrap(await supabase.from("helpr_vehicles").select("has_car, has_truck, second_person, photo_path").eq("user_id", userId).maybeSingle());
  return (row ?? null) as MyVehicle | null;
}

export async function saveVehicle(hasCar: boolean, hasTruck: boolean, secondPerson: boolean, photoPath: string | null): Promise<void> {
  data(await supabase.rpc("helpr_set_vehicle", { p_has_car: hasCar, p_has_truck: hasTruck, p_second_person: secondPerson, p_photo_path: photoPath as string }), (e) => rpcErrorMessage("helpr_set_vehicle", e));
}

/**
 * The seller's pickup windows for an OPEN delivery the caller may take (helpr_task_pickup_windows, 20261028232930),
 * and the latest a pickup may end: both bounds helpr_task_accept checks. Null before the read is deployed (the
 * accept card keeps its free time field then).
 */
export async function fetchTaskPickupWindows(taskId: string): Promise<{ windows: SellerWindow[]; latestPickupAt: string | null } | null> {
  const res = await supabase.rpc("helpr_task_pickup_windows", { p_task_id: taskId });
  if (res.error && isMissingRpcNamed(res.error, "helpr_task_pickup_windows")) return null;
  const rows = (data<(SellerWindow & { latest_pickup_at: string | null })[] | null>(res, (e) => rpcErrorMessage("helpr_task_pickup_windows", e)) ?? []);
  return { windows: rows.map(({ weekday, starts, ends }) => ({ weekday, starts, ends })), latestPickupAt: rows[0]?.latest_pickup_at ?? null };
}

/**
 * The caller's own coming pickup at this OPEN delivery's seller and place (helpr_task_same_pickup_slot, 20261030152601),
 * when this delivery can use that time too: booking it makes one visit (audit 1c D3-2). Null when none, or before that
 * read is deployed.
 */
export async function fetchSamePickupSlot(taskId: string): Promise<string | null> {
  const res = await supabase.rpc("helpr_task_same_pickup_slot", { p_task_id: taskId });
  if (res.error && isMissingRpcNamed(res.error, "helpr_task_same_pickup_slot")) return null;
  return data<string | null>(res, (e) => rpcErrorMessage("helpr_task_same_pickup_slot", e));
}

/** Take a task with a 30-minute pickup time (inside the source's pickup times). */
export async function acceptTask(taskId: string, pickupSlotStartIso: string): Promise<void> {
  data(await supabase.rpc("helpr_task_accept", { p_task_id: taskId, p_pickup_slot_start: pickupSlotStartIso }), (e) => {
    // A delivery Helpr verifies when taking a delivery (owner 2026-10-30): the one ID sheet, and the job stays open.
    if (identityRefusal(e) === "deliver") openIdentityCheck("deliver");
    return rpcErrorMessage("helpr_task_accept", e);
  });
}

/** Back out before the pickup. Under 2 hours before the pickup time it costs a delivery strike, unless the seller moved the time. */
export async function releaseTask(taskId: string): Promise<{ result: string; strike: boolean }> {
  return data<{ result: string; strike: boolean }>(await supabase.rpc("helpr_task_release", { p_task_id: taskId }), (e) => rpcErrorMessage("helpr_task_release", e));
}

/** "Picked up": a photo taken at the pickup point (the server checks within 200 m). */
export async function markPickedUp(taskId: string, photoPath: string, where: { lat: number; lng: number }): Promise<void> {
  data(await supabase.rpc("helpr_task_picked_up", { p_task_id: taskId, p_photo_path: photoPath, p_lat: where.lat, p_lng: where.lng }), (e) => rpcErrorMessage("helpr_task_picked_up", e));
}

/**
 * The seller's "Handed over" (20261030012018): the seller says they gave the item to the assigned Helpr.
 * It changes no status and moves no money; it lets that Helpr mark it picked up before the 30-minute window.
 */
export async function markHandedOver(taskId: string): Promise<{ result: "handed_over" | "already_handed_over" }> {
  return data<{ result: "handed_over" | "already_handed_over" }>(await supabase.rpc("helpr_task_handed_over", { p_task_id: taskId }),
    (e) => rpcErrorMessage("helpr_task_handed_over", e));
}

/**
 * BUY-42 (20261031095846): the seller moves the booked Helpr's pickup, once per booking, to a time inside their own
 * pickup times at least 2 hours away. The Helpr and the buyer are told.
 */
export async function moveHelprPickup(taskId: string, pickupSlotStartIso: string): Promise<{ result: "moved"; pickup_slot_start: string }> {
  return data<{ result: "moved"; pickup_slot_start: string }>(
    await supabase.rpc("helpr_task_seller_move_pickup", { p_task_id: taskId, p_pickup_slot_start: pickupSlotStartIso }),
    (e) => rpcErrorMessage("helpr_task_seller_move_pickup", e));
}

/** The drop-off: a photo at the door (no code: owner 2026-10-18); the customer's "I got it" or 24 h confirms it. */
export async function markDelivered(
  taskId: string,
  photoPath: string | null,
  where: { lat: number; lng: number } | null,
): Promise<DeliveredResult> {
  // nullable-arg: p_code is always NULL now that drop-offs have no code (20261018184535 ignores it);
  // p_photo_path, p_lat and p_lng take NULL when there is no photo or no location.
  return data<DeliveredResult>(await supabase.rpc("helpr_task_delivered", {
    p_task_id: taskId,
    p_photo_path: photoPath as string,
    p_lat: (where?.lat ?? null) as number,
    p_lng: (where?.lng ?? null) as number,
    p_code: null as unknown as string,
  }), (e) => rpcErrorMessage("helpr_task_delivered", e));
}

/**
 * "The seller wasn't there", from 15 minutes after the pickup time, with a
 * photo taken at the pickup point (the server checks within 200 m). It opens
 * a problem for an admin to decide; nothing is refunded on the report alone.
 */
export async function reportPickupNoShow(taskId: string, photoPath: string, where: { lat: number; lng: number }): Promise<void> {
  data(await supabase.rpc("helpr_task_pickup_no_show", { p_task_id: taskId, p_photo_path: photoPath, p_lat: where.lat, p_lng: where.lng }),
    (e) => rpcErrorMessage("helpr_task_pickup_no_show", e));
}

/** The customer's "I got it" after the Helpr has the item. */
export async function confirmReceived(taskId: string): Promise<void> {
  data(await supabase.rpc("helpr_task_customer_confirm", { p_task_id: taskId }), (e) => rpcErrorMessage("helpr_task_customer_confirm", e));
}

function nonce(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

/** Photos go to the PRIVATE bucket helpr-tasks (20261017055505 A5), served by signed URL only. */
async function uploadCleaned(path: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const { error } = await supabase.storage.from("helpr-tasks").upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw new Error("photo_not_uploaded");
  return path;
}

/** A task photo (metadata stripped) at `<uid>/task/<task>/<file>`, the only path the SQL accepts. */
export async function uploadTaskPhoto(userId: string, taskId: string, file: File): Promise<string> {
  // Live camera only (20261029002010): a handover photo taken more than 10 minutes ago is refused before upload.
  assertLivePhoto(file);
  return uploadCleaned(`${userId}/task/${taskId}/${nonce()}.jpg`, file);
}

/** The Helpr's truck photo at `<uid>/vehicle/<file>`. */
export function uploadVehiclePhoto(userId: string, file: File): Promise<string> {
  return uploadCleaned(`${userId}/vehicle/${nonce()}.jpg`, file);
}

// taskPhotoUrl lives in ./photoUrl so the admin problem card can read a task
// photo without importing this module (it would then be shared by two lazy
// chunks and ride in signed-in-shared, on every signed-in page's boot path).
export { taskPhotoUrl } from "./photoUrl";
