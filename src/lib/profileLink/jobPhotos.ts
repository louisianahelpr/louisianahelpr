/**
 * Job photos on the shareable profile (owner 11-05, share-profile H4: all three options combined).
 * A job's after photo shows on /u/<handle> only while the poster AND every Helpr booked on the job allow sharing
 * ("Let Helpr share my job photos") AND the Helpr ticked "Show on my page" for it (20261105172514).
 * A visitor gets a pick id, the job's category and its month; the image comes from the profile-work-photo edge
 * function by that id, never by a storage path.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";

export interface PublicJobPhoto {
  id: string;
  category: string;
  /** "YYYY-MM", Louisiana time. */
  month: string;
}

export interface MyJobPhoto {
  job_id: string;
  photo_path: string;
  category: string;
  month: string;
  shown: boolean;
  /** The poster and every Helpr on the job allow sharing; a ticked photo waits until they do. */
  consented: boolean;
}

export const publicJobPhotosKey = (handle: string) => ["profile-link", "job-photos", handle] as const;
export const MY_JOB_PHOTOS_KEY = ["profile-link", "my-job-photos"] as const;

/** The visitor's list for a page; [] before the migration ships. Throws on a network fault. */
export async function fetchPublicJobPhotos(handle: string): Promise<PublicJobPhoto[]> {
  const { data, error } = await supabase.rpc("public_profile_work_photos", { p_handle: handle });
  if (error) {
    if (isMissingRpcNamed(error, "public_profile_work_photos")) return [];
    throw new Error("We couldn't load the job photos.");
  }
  return Array.isArray(data) ? (data as unknown as PublicJobPhoto[]) : [];
}

/** Your own completed jobs' after photos, and which are on your page. [] before the migration ships. */
export async function fetchMyJobPhotos(): Promise<MyJobPhoto[]> {
  const { data, error } = await supabase.rpc("my_job_photos");
  if (error) {
    if (isMissingRpcNamed(error, "my_job_photos")) return [];
    throw new Error("We couldn't load your job photos.");
  }
  return Array.isArray(data) ? (data as MyJobPhoto[]) : [];
}

/** Tick or untick one photo. Throws with plain words on a refusal. */
export async function setJobPhotoShown(jobId: string, photoPath: string, shown: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_job_photo_shown", { p_job_id: jobId, p_photo_path: photoPath, p_shown: shown });
  if (error) throw new Error(shown ? "We couldn't add that photo to your page. Try again." : "We couldn't take that photo off your page. Try again.");
}

/** One picked job photo through the profile-work-photo edge function. */
export function jobPhotoUrl(id: string, width = 320): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/profile-work-photo?id=${encodeURIComponent(id)}&w=${width}`;
}

/** "2026-10" -> "Oct 2026". */
export function jobPhotoMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return "";
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m[2]) - 1] ?? ""} ${m[1]}`.trim();
}
