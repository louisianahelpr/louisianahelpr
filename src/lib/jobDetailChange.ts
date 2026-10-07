import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { geocodeAddress } from "@/lib/geocode";

/**
 * An agreed change to a booked job's place and details (Q1254, owner decision
 * 2026-10-07; 20261007113957). The poster asks; every Helpr booked on it (a
 * crew's every member) has to accept; one decline ends it; unanswered by the
 * job's start it expires. Text only: title, description, address, materials
 * note. Nothing changes until the last accept.
 */
export const DETAIL_CHANGE_FIELDS = ["title", "description", "location", "materials_note"] as const;
export type DetailChangeField = (typeof DETAIL_CHANGE_FIELDS)[number];

export const DETAIL_CHANGE_LABELS: Record<DetailChangeField, string> = {
  title: "Title",
  description: "Description",
  location: "Address",
  materials_note: "Materials I'll provide",
};

interface DetailChangeAnswer {
  helper_id: string;
  answer: "pending" | "accepted" | "declined";
}

export interface DetailChangeRequest {
  id: string;
  job_id: string;
  requested_by: string;
  changed_fields: DetailChangeField[];
  old_title: string | null;
  new_title: string | null;
  old_description: string | null;
  new_description: string | null;
  old_location: string | null;
  new_location: string | null;
  old_materials_note: string | null;
  new_materials_note: string | null;
  status: string;
  expires_at: string;
  answers: DetailChangeAnswer[];
}

/** The proposed value of one field (null = removed; only the materials note can be). */
export function proposedValue(req: DetailChangeRequest, field: DetailChangeField): string | null {
  return req[`new_${field}`];
}

/** The value it had when the poster asked. */
export function previousValue(req: DetailChangeRequest, field: DetailChangeField): string | null {
  return req[`old_${field}`];
}

/**
 * The job's live request with its answers, or null. A 'pending' row past
 * expires_at has expired (respond marks it so the next time anyone touches
 * it), so it is not returned. Not deployed yet (42P01 / PGRST205) is null.
 */
export async function fetchPendingDetailChange(jobId: string, now: Date = new Date()): Promise<DetailChangeRequest | null> {
  const result = await supabase
    .from("job_detail_change_requests")
    .select(
      "id, job_id, requested_by, changed_fields, old_title, new_title, old_description, new_description, old_location, new_location, old_materials_note, new_materials_note, status, expires_at, answers:job_detail_change_answers(helper_id, answer)",
    )
    .eq("job_id", jobId)
    .eq("status", "pending")
    .maybeSingle();
  if (isNotDeployedYet(result.error)) return null;
  const row = unwrap(result) as DetailChangeRequest | null;
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  return { ...row, answers: row.answers ?? [] };
}

/** How many Helprs are booked on a crew job right now (the poster reads the roster). */
export async function fetchCrewBookedCount(jobId: string): Promise<number> {
  const result = await supabase
    .from("group_job_helpers")
    .select("helper_id")
    .eq("job_id", jobId)
    .not("helper_id", "is", null);
  return (unwrap(result) ?? []).length;
}

function changeError(error: { code?: string | null; message?: string | null }, copy: string | null): Error {
  if (isNotDeployedYet(error)) {
    return new Error("This is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.");
  }
  return new Error(copy ?? error.message ?? "Something went wrong. Please try again.");
}

/**
 * Ask. `changes` holds only the fields being changed. A new address is
 * geocoded here and sent with its map point: the server refuses an address
 * without one (detail_change_location_unmapped), because a booked job with no
 * pin would verify any arrival (Q1499). Returns how many Helprs were asked.
 */
export async function requestDetailChange(jobId: string, changes: Partial<Record<DetailChangeField, string | null>>): Promise<number> {
  let point: { latitude: number; longitude: number } | null = null;
  if (typeof changes.location === "string") {
    point = await geocodeAddress(changes.location);
    if (!point) throw new Error("We couldn't find that address on the map. Check the street, city and ZIP, then try again.");
  }
  const { data, error } = await supabase.rpc("request_job_detail_change", {
    p_job_id: jobId,
    p_changes: point ? { ...changes, latitude: point.latitude, longitude: point.longitude } : changes,
  });
  if (error) throw changeError(error, rpcErrorMessage("request_job_detail_change", error));
  return Number((data as { asked?: number } | null)?.asked ?? 0);
}

/** Answer. Returns accepted / waiting / declined / expired. */
export async function respondDetailChange(requestId: string, accept: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("respond_job_detail_change", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw changeError(error, rpcErrorMessage("respond_job_detail_change", error));
  return String((data as { status?: string } | null)?.status ?? "");
}
