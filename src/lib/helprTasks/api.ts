/**
 * The shared "a Helpr picks up an item at an address and takes it to another
 * address" job flow, client side (migration 20261016053945, PART A). Declutter
 * delivery is its first source; Add a Helpr and haul-away are meant to reuse it
 * unchanged (docs/specs/declutter-auctions.md, "Slice 5 build decisions").
 *
 * Nothing here knows about Declutter: a task names its source (`source_kind`,
 * `source_id`) and every rule (who may take it, when, the photos at each end,
 * the drop-off code, the Helpr's pay) is enforced in SQL (helpr_task_*). The
 * exact addresses come only from helpr_task_view, and only to the assigned
 * Helpr while the task is active. A refusal throws an Error whose message is
 * the server's code; screens word it with declutterErrorMessage (the codes are
 * listed in src/lib/declutter/errors.ts with the migration that raises them).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";

export type TaskSize = "small" | "large" | "xl";
export type TaskStatus = "open" | "accepted" | "picked_up" | "delivered" | "confirmed" | "unfilled" | "cancelled" | "failed";
export type TaskRole = "helpr" | "customer" | "pickup_contact" | "candidate";

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
  dropoff_code: string | null;
  code_locked: boolean;
  pickup_photo_path: string | null;
  dropoff_photo_path: string | null;
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
  has_truck: boolean;
  second_person: boolean;
  photo_path: string | null;
}

export type DeliveredResult =
  | { result: "confirmed"; distance_m?: number | null }
  | { result: "delivered"; distance_m?: number | null; held?: boolean }
  | { result: "wrong_code"; attempts_left: number }
  | { result: "code_locked" }
  | { result: "already_confirmed" };

/** The RPC's data, or a thrown Error carrying the server's code as its message. */
function data<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) unwrap(result);
  return result.data as T;
}

/** The private bucket (20261016053945 A5): served by signed URL only. */
export const HELPR_TASK_BUCKET = "helpr-tasks";

/** Nearby open tasks this Helpr can take (vehicle, age, payouts, switch all checked in SQL). */
export async function fetchOpenTasks(where: { lat: number; lng: number } | null): Promise<OpenTask[]> {
  return data<OpenTask[] | null>(await supabase.rpc("helpr_tasks_open_near", {
    p_lat: (where?.lat ?? null) as number, p_lng: (where?.lng ?? null) as number, p_limit: 50,
  })) ?? [];
}

export async function fetchMyTasks(): Promise<MyTask[]> {
  return data<MyTask[] | null>(await supabase.rpc("helpr_my_tasks")) ?? [];
}

export async function fetchTaskView(taskId: string): Promise<TaskView> {
  return data<TaskView>(await supabase.rpc("helpr_task_view", { p_task_id: taskId }));
}

export async function fetchMyVehicle(userId: string): Promise<MyVehicle | null> {
  const row = unwrap(await supabase.from("helpr_vehicles").select("has_truck, second_person, photo_path").eq("user_id", userId).maybeSingle());
  return (row ?? null) as MyVehicle | null;
}

export async function saveVehicle(hasTruck: boolean, secondPerson: boolean, photoPath: string | null): Promise<void> {
  data(await supabase.rpc("helpr_set_vehicle", { p_has_truck: hasTruck, p_second_person: secondPerson, p_photo_path: photoPath as string }));
}

/** Take a task with a 30-minute pickup time (inside the source's pickup times). */
export async function acceptTask(taskId: string, pickupSlotStartIso: string): Promise<void> {
  data(await supabase.rpc("helpr_task_accept", { p_task_id: taskId, p_pickup_slot_start: pickupSlotStartIso }));
}

/** Back out before the pickup. Under 2 hours before the pickup time it costs a delivery strike. */
export async function releaseTask(taskId: string): Promise<{ result: string; strike: boolean }> {
  return data<{ result: string; strike: boolean }>(await supabase.rpc("helpr_task_release", { p_task_id: taskId }));
}

/** "Picked up": a photo taken at the pickup point (the server checks within 200 m). */
export async function markPickedUp(taskId: string, photoPath: string, where: { lat: number; lng: number }): Promise<void> {
  data(await supabase.rpc("helpr_task_picked_up", { p_task_id: taskId, p_photo_path: photoPath, p_lat: where.lat, p_lng: where.lng }));
}

/** The drop-off: a photo at the address, with the customer's 4-digit code when they are there. */
export async function markDelivered(
  taskId: string,
  photoPath: string | null,
  where: { lat: number; lng: number } | null,
  code: string | null,
): Promise<DeliveredResult> {
  return data<DeliveredResult>(await supabase.rpc("helpr_task_delivered", {
    p_task_id: taskId,
    p_photo_path: photoPath as string,
    p_lat: (where?.lat ?? null) as number,
    p_lng: (where?.lng ?? null) as number,
    p_code: code as string,
  }));
}

/** "The seller wasn't there", from 15 minutes after the pickup time. */
export async function reportPickupNoShow(taskId: string): Promise<void> {
  data(await supabase.rpc("helpr_task_pickup_no_show", { p_task_id: taskId }));
}

/** The customer's "I got it" after the Helpr has the item. */
export async function confirmReceived(taskId: string): Promise<void> {
  data(await supabase.rpc("helpr_task_customer_confirm", { p_task_id: taskId }));
}

function nonce(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

async function uploadCleaned(path: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const { error } = await supabase.storage.from(HELPR_TASK_BUCKET).upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw new Error("photo_not_uploaded");
  return path;
}

/** A task photo (metadata stripped) at `<uid>/task/<task>/<file>`, the only path the SQL accepts. */
export function uploadTaskPhoto(userId: string, taskId: string, file: File): Promise<string> {
  return uploadCleaned(`${userId}/task/${taskId}/${nonce()}.jpg`, file);
}

/** The Helpr's truck photo at `<uid>/vehicle/<file>`. */
export function uploadVehiclePhoto(userId: string, file: File): Promise<string> {
  return uploadCleaned(`${userId}/vehicle/${nonce()}.jpg`, file);
}

/** A signed URL (10 minutes) for a task photo the caller may read; null when it cannot be signed. */
export async function taskPhotoUrl(path: string): Promise<string | null> {
  const { data: signed, error } = await supabase.storage.from(HELPR_TASK_BUCKET).createSignedUrl(path, 600);
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}
