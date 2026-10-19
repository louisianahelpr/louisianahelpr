/**
 * Rentals S1 data access (20261017205605). Every write is an RPC; the tables
 * have no client write privilege. Reads go through RLS (landlord, tenant, or
 * admin for the ownership queue) and only work while the 'rentals' switch is
 * on for the member.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { loadAdminRpcErrorCopy, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isStorageObjectPath } from "@/lib/storagePath";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { RENTALS_PROOF_TYPES, RENTALS_REQUEST_PHOTO_TYPES, isAllowedUploadType, unsupportedUploadCopy } from "@/lib/uploadTypes";
import { RentalsCopyError } from "./copy";

type Tables = Database["public"]["Tables"];
/**
 * The rental_properties columns a client may read: every column but
 * ownership_reviewed_by. Which admin checked a landlord's proof is staff-only
 * (owner decision 2026-10-17: the landlord sees "Approved by Louisiana Helpr");
 * the migration grants authenticated exactly these columns, so `select("*")`
 * would be refused. Pinned against the GRANT by src/test/rentalsMaintenance.test.ts.
 */
export const RENTAL_PROPERTY_COLUMNS =
  "id, owner_id, label, street_address, city, zip_code, ownership_status, ownership_proof_path, ownership_submitted_at, ownership_reviewed_at, ownership_review_note, auto_approve_limit_cents, created_at, updated_at, listings_taken_down_at, listings_taken_down_reason";
export type RentalProperty = Omit<Tables["rental_properties"]["Row"], "ownership_reviewed_by">;
export type RentalUnit = Tables["rental_units"]["Row"];
export type MaintenanceRequest = Tables["maintenance_requests"]["Row"];
export type MaintenancePhoto = Tables["maintenance_request_photos"]["Row"];

/** Private bucket: owner-folder writes, owner + admin reads, plus the landlord-photo policy. */
const RENTALS_BUCKET = "user-documents";

/** Each call site names its RPC's words: rpcErrorMessage("<rpc>", e) (rpcErrorCopyCoverage). */
type Words = (e: unknown) => string | null;
const rpcVoid = async (p: PromiseLike<{ error: unknown }>, words: Words) => {
  const { error } = await p;
  if (error) throw new RentalsCopyError(words(error), error);
};
async function rpcValue<T>(p: PromiseLike<{ data: T | null; error: unknown }>, words: Words): Promise<T> {
  const { data, error } = await p;
  if (error) throw new RentalsCopyError(words(error), error);
  if (data == null) throw new Error("empty_response");
  return data;
}

export async function fetchMyProperties(uid: string): Promise<RentalProperty[]> {
  return (unwrap(await supabase.from("rental_properties").select(RENTAL_PROPERTY_COLUMNS).eq("owner_id", uid).order("created_at")) ?? []) as RentalProperty[];
}
/** Admin: the owners' properties under a Homes take-down (the ownership review shows that history, Q2187). */
export async function fetchTakenDownProperties(ownerIds: string[]): Promise<RentalProperty[]> {
  if (ownerIds.length === 0) return [];
  return (unwrap(
    await supabase.from("rental_properties").select(RENTAL_PROPERTY_COLUMNS).in("owner_id", ownerIds).not("listings_taken_down_at", "is", null),
  ) ?? []) as RentalProperty[];
}
export async function fetchUnits(propertyIds: string[]): Promise<RentalUnit[]> {
  if (propertyIds.length === 0) return [];
  return (unwrap(await supabase.from("rental_units").select("*").in("property_id", propertyIds).order("label")) ?? []) as RentalUnit[];
}
/** A unit's live tenancy rows (landlord only: the query names landlord_id = the caller). */
export type UnitTenancy = Pick<Tables["rental_tenancies"]["Row"], "id" | "unit_id" | "status" | "accepted_at" | "invite_expires_at" | "created_at">;
export async function fetchLiveTenancies(uid: string): Promise<UnitTenancy[]> {
  return (unwrap(
    await supabase
      .from("rental_tenancies")
      .select("id, unit_id, status, accepted_at, invite_expires_at, created_at")
      .eq("landlord_id", uid)
      .in("status", ["invited", "active"])
      .order("created_at"),
  ) ?? []) as UnitTenancy[];
}
export interface MyHome {
  tenancy_id: string;
  property_id: string;
  unit_id: string;
  label: string;
  unit_label: string;
  street_address: string;
  city: string;
  zip_code: string;
}
/** Homes I rent: name and address only (rentals_my_homes; the property row is the owner's). */
export async function fetchMyHomes(): Promise<MyHome[]> {
  return (unwrap(await supabase.rpc("rentals_my_homes")) ?? []) as MyHome[];
}
export async function fetchMyRequests(): Promise<MaintenanceRequest[]> {
  return (unwrap(await supabase.from("maintenance_requests").select("*").order("created_at", { ascending: false })) ?? []) as MaintenanceRequest[];
}
export async function fetchRequest(id: string): Promise<MaintenanceRequest | null> {
  return unwrap(await supabase.from("maintenance_requests").select("*").eq("id", id).maybeSingle()) as MaintenanceRequest | null;
}
export async function fetchRequestPhotos(requestId: string): Promise<MaintenancePhoto[]> {
  return (unwrap(await supabase.from("maintenance_request_photos").select("*").eq("request_id", requestId).order("position")) ?? []) as MaintenancePhoto[];
}
export interface RequestJobState {
  jobId: string | null;
  /** booked = funded; paying = a checkout that may still complete; refunding = money going back or contested;
   *  unpaid = open, never funded, no checkout running (cancel it to post again); none = settled (post again). */
  booking: "booked" | "paying" | "refunding" | "unpaid" | "none";
  jobStatus: string | null;
}
/** The linked job's state (rentals_request_job_state): "a job id is set" is not "booked". */
export async function fetchRequestJobState(requestId: string): Promise<RequestJobState> {
  const row = (unwrap(await supabase.rpc("rentals_request_job_state", { p_request_id: requestId })) ?? [])[0];
  return {
    jobId: row?.job_id ?? null,
    booking: (row?.booking as RequestJobState["booking"]) ?? "none",
    jobStatus: row?.job_status ?? null,
  };
}

/** A short-lived link to a private file (proof or request photo) the caller may read. */
export async function signedFileUrl(path: string): Promise<string> {
  // Only a storage path is ever signed (a stored URL is not one): signedUrlOnlyForStoragePaths.
  if (!isStorageObjectPath(path)) throw new Error("not_a_storage_path");
  const { data, error } = await supabase.storage.from(RENTALS_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
/** Admin queue: properties waiting for an ownership check (admin RLS). */
export async function fetchPendingOwnership(): Promise<RentalProperty[]> {
  return (unwrap(
    await supabase.from("rental_properties").select(RENTAL_PROPERTY_COLUMNS).eq("ownership_status", "pending_review").order("ownership_submitted_at"),
  ) ?? []) as RentalProperty[];
}

const safeName = (name: string) => (name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file");

/**
 * Upload a file into the caller's own folder; returns the storage path.
 * The type is checked against `allowed` (inside user-documents' allowed_mime_types,
 * src/test/uploadMimeParity.test.ts) BEFORE uploading, so a refused type gets words,
 * not a raw storage error. Every key is new (a timestamp or a fresh batch id), so
 * the object never changes: cache it a year (Q655).
 */
async function uploadOwn(path: string, file: File, allowed: readonly string[], formats: string): Promise<string> {
  if (!isAllowedUploadType(file, allowed)) throw new RentalsCopyError(unsupportedUploadCopy(file, formats), new Error("unsupported_type"));
  const { error } = await supabase.storage.from(RENTALS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw error;
  return path;
}

export const createProperty = (label: string, street: string, city: string, zip: string) =>
  rpcValue(supabase.rpc("rentals_create_property", { p_label: label, p_street_address: street, p_city: city, p_zip_code: zip }), (e) => rpcErrorMessage("rentals_create_property", e));

export async function submitOwnershipProof(uid: string, propertyId: string, file: File): Promise<void> {
  const path = await uploadOwn(
    `${uid}/rentals/${propertyId}/${Date.now()}-${safeName(file.name)}`,
    file,
    RENTALS_PROOF_TYPES,
    "a JPEG, PNG or PDF",
  );
  await rpcVoid(supabase.rpc("rentals_submit_ownership_proof", { p_property_id: propertyId, p_storage_path: path }), (e) => rpcErrorMessage("rentals_submit_ownership_proof", e));
}

/**
 * The caller's identity for Homes (rentals_my_identity): verified by ANY route
 * (Stripe Identity, Stripe Connect's check in payout setup, or an admin-approved
 * ID photo: public.is_identity_verified, the one rule), and their ID review.
 */
export interface MyIdentity {
  verified: boolean;
  /** null: never sent an ID photo. */
  idStatus: "pending_review" | "approved" | "rejected" | null;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}
/** Before db-deploy has created rentals_my_identity (20261019051407), PostgREST answers PGRST202
 *  with no hint (a hint means a function by that name exists with other arguments: a real bug). */
function identityNotDeployed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; hint?: unknown };
  return e.code === "PGRST202" && !e.hint;
}

export async function fetchMyIdentity(): Promise<MyIdentity> {
  const res = await supabase.rpc("rentals_my_identity");
  // Not deployed yet: read as not verified and nothing sent, never the screen's load error.
  if (res.error && identityNotDeployed(res.error)) {
    return { verified: false, idStatus: null, reviewNote: null, submittedAt: null, reviewedAt: null };
  }
  const row = (unwrap(res) ?? [])[0];
  const s = row?.id_status;
  return {
    verified: row?.verified === true,
    idStatus: s === "pending_review" || s === "approved" || s === "rejected" ? s : null,
    reviewNote: row?.review_note ?? null,
    submittedAt: row?.submitted_at ?? null,
    reviewedAt: row?.reviewed_at ?? null,
  };
}

/**
 * Send a photo of your ID (front; back optional) for an admin's review (owner
 * 2026-10-19: replaces the paid Stripe check; free). Both go into the caller's
 * own private user-documents folder under landlord-id/ (owner + admin read
 * only); the RPC checks the paths and that the files exist.
 */
export async function submitLandlordId(uid: string, front: File, back: File | null): Promise<void> {
  // Photos only (an ID is photographed): the same image list as request photos, inside the bucket's types.
  const stamp = Date.now();
  const uploaded: string[] = [];
  try {
    const frontPath = await uploadOwn(`${uid}/landlord-id/${stamp}-front-${safeName(front.name)}`, front, RENTALS_REQUEST_PHOTO_TYPES, "a JPEG, PNG, WebP or HEIC photo");
    uploaded.push(frontPath);
    const backPath = back
      ? await uploadOwn(`${uid}/landlord-id/${stamp}-back-${safeName(back.name)}`, back, RENTALS_REQUEST_PHOTO_TYPES, "a JPEG, PNG, WebP or HEIC photo")
      : null;
    if (backPath) uploaded.push(backPath);
    await rpcVoid(
      supabase.rpc("rentals_submit_landlord_id", { p_front_path: frontPath, p_back_path: backPath as string }),
      (e) => rpcErrorMessage("rentals_submit_landlord_id", e),
    );
  } catch (e) {
    // An ID photo no review names would never reach the 30-day sweep: take it back
    // out now. Best effort; the original refusal is what the landlord sees, and a
    // failed removal is reported (a leftover is Q2202's case).
    if (uploaded.length > 0) {
      const { error: rmErr } = await supabase.storage.from(RENTALS_BUCKET).remove(uploaded);
      if (rmErr) report(rmErr, { tags: { source: "submitLandlordId.cleanup" }, context: { paths: uploaded.length } });
    }
    throw e;
  }
}

/** The landlord_id_reviews columns a client may read (every column but reviewed_by, staff-only). */
const LANDLORD_ID_COLUMNS = "user_id, status, front_path, back_path, submitted_at, reviewed_at, review_note, images_deleted_at, created_at, updated_at";
export type LandlordIdReview = Omit<Tables["landlord_id_reviews"]["Row"], "reviewed_by">;
/** Admin queue: ID photos waiting for a review (admin RLS). */
export async function fetchPendingLandlordIds(): Promise<LandlordIdReview[]> {
  return (unwrap(
    await supabase.from("landlord_id_reviews").select(LANDLORD_ID_COLUMNS).eq("status", "pending_review").order("submitted_at"),
  ) ?? []) as LandlordIdReview[];
}
/** Admin: the current ID review of these landlords (any status), for the ownership queue. */
export async function fetchLandlordIds(userIds: string[]): Promise<LandlordIdReview[]> {
  if (userIds.length === 0) return [];
  return (unwrap(await supabase.from("landlord_id_reviews").select(LANDLORD_ID_COLUMNS).in("user_id", userIds)) ?? []) as LandlordIdReview[];
}
/**
 * Admin-only (approve, or reject with a note); copy in ADMIN_RPC_ERROR_COPY, fetched only on a refusal.
 * `submittedAt` is the submission the admin opened: a newer photo is refused (review_changed).
 */
export async function reviewLandlordId(userId: string, approve: boolean, note: string, submittedAt: string): Promise<void> {
  const res = await supabase.rpc("rentals_admin_review_landlord_id", { p_user_id: userId, p_approve: approve, p_note: note, p_submitted_at: submittedAt });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcVoid(Promise.resolve(res), (e) => admin?.rpcErrorMessage("rentals_admin_review_landlord_id", e) ?? null);
}

/** Admin-only: its copy lives in ADMIN_RPC_ERROR_COPY and is fetched only on a refusal (loadAdminRpcErrorCopy). */
export async function reviewOwnership(propertyId: string, approve: boolean, note: string): Promise<void> {
  const res = await supabase.rpc("rentals_admin_review_property", { p_property_id: propertyId, p_approve: approve, p_note: note });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcVoid(Promise.resolve(res), (e) => admin?.rpcErrorMessage("rentals_admin_review_property", e) ?? null);
}

export const addUnit = (propertyId: string, label: string) =>
  rpcValue(supabase.rpc("rentals_add_unit", { p_property_id: propertyId, p_label: label }), (e) => rpcErrorMessage("rentals_add_unit", e));

export const setAutoApprove = (propertyId: string, limitCents: number | null) =>
  rpcVoid(supabase.rpc("rentals_set_auto_approve", { p_property_id: propertyId, p_limit_cents: limitCents as number }), (e) => rpcErrorMessage("rentals_set_auto_approve", e));

export const inviteTenant = (unitId: string) => rpcValue(supabase.rpc("rentals_invite_tenant", { p_unit_id: unitId }), (e) => rpcErrorMessage("rentals_invite_tenant", e));

/** Either side: active -> ended (a tenant leaves, or the landlord cuts off a former tenant); invited -> revoked (cancel an unused invite). */
export const endTenancy = (tenancyId: string) =>
  rpcVoid(supabase.rpc("rentals_end_tenancy", { p_tenancy_id: tenancyId }), (e) => rpcErrorMessage("rentals_end_tenancy", e));

export const acceptInvite = (token: string) => rpcValue(supabase.rpc("rentals_accept_invite", { p_token: token }), (e) => rpcErrorMessage("rentals_accept_invite", e));

export interface NewRequest {
  tenancyId: string;
  category: string;
  description: string;
  urgency: "emergency" | "soon" | "whenever";
  accessWindows: string;
  petsOnSite: boolean;
  okToEnterAlone: boolean;
  accessNotes: string;
  photos: File[];
}

export async function fileRequest(uid: string, r: NewRequest): Promise<string> {
  // Check every photo before uploading any, so a refused one leaves no orphan objects behind.
  const refused = r.photos.slice(0, 10).find((f) => !isAllowedUploadType(f, RENTALS_REQUEST_PHOTO_TYPES));
  if (refused) throw new RentalsCopyError(unsupportedUploadCopy(refused, "a JPEG, PNG, WebP or HEIC photo"), new Error("unsupported_type"));
  const batch = crypto.randomUUID();
  const paths: string[] = [];
  for (const f of r.photos.slice(0, 10)) {
    paths.push(
      await uploadOwn(`${uid}/rentals/requests/${batch}/${paths.length}-${safeName(f.name)}`, f, RENTALS_REQUEST_PHOTO_TYPES, "a JPEG, PNG, WebP or HEIC photo"),
    );
  }
  return rpcValue(
    supabase.rpc("rentals_file_request", {
      p_tenancy_id: r.tenancyId,
      p_category: r.category,
      p_description: r.description,
      p_urgency: r.urgency,
      p_access_windows: r.accessWindows,
      p_pets_on_site: r.petsOnSite,
      p_ok_to_enter_alone: r.okToEnterAlone,
      p_access_notes: r.accessNotes,
      p_photo_paths: paths,
    }), (e) => rpcErrorMessage("rentals_file_request", e)
  );
}

export const approveRequest = (id: string) => rpcVoid(supabase.rpc("rentals_approve_request", { p_request_id: id }), (e) => rpcErrorMessage("rentals_approve_request", e));
export const declineRequest = (id: string, code: string, text: string) =>
  rpcVoid(supabase.rpc("rentals_decline_request", { p_request_id: id, p_reason_code: code, p_reason_text: text }), (e) => rpcErrorMessage("rentals_decline_request", e));
export const withdrawRequest = (id: string) => rpcVoid(supabase.rpc("rentals_withdraw_request", { p_request_id: id }), (e) => rpcErrorMessage("rentals_withdraw_request", e));
/** Cancel the request's open, never-paid job (no checkout running) so the landlord can post again (slice 3). */
export const cancelRequestJob = (requestId: string) =>
  rpcVoid(supabase.rpc("rentals_cancel_request_job", { p_request_id: requestId }), (e) => rpcErrorMessage("rentals_cancel_request_job", e));
/** Visit time (owner Q41): the hired Helpr proposes, the tenant confirms the exact time on file. */
export const proposeVisit = (jobId: string, at: string) =>
  rpcVoid(supabase.rpc("rentals_propose_visit", { p_job_id: jobId, p_at: at }), (e) => rpcErrorMessage("rentals_propose_visit", e));
export const confirmVisit = (requestId: string, at: string) =>
  rpcVoid(supabase.rpc("rentals_confirm_visit", { p_request_id: requestId, p_at: at }), (e) => rpcErrorMessage("rentals_confirm_visit", e));
export interface JobVisit {
  requestId: string;
  proposedFor: string | null;
  confirmedAt: string | null;
}
/** The visit for a job, for its Helpr or poster (rentals_visit_for_job). Null when the job came from no request. */
export async function fetchVisitForJob(jobId: string): Promise<JobVisit | null> {
  const row = (unwrap(await supabase.rpc("rentals_visit_for_job", { p_job_id: jobId })) ?? [])[0];
  if (!row) return null;
  return { requestId: row.request_id, proposedFor: row.proposed_for ?? null, confirmedAt: row.confirmed_at ?? null };
}
export const answerFixed = (id: string, fixed: boolean, note: string) =>
  rpcVoid(supabase.rpc("rentals_tenant_answer_fixed", { p_request_id: id, p_fixed: fixed, p_note: note }), (e) => rpcErrorMessage("rentals_tenant_answer_fixed", e));

interface FixedAnswer {
  requestId: string;
  saysFixed: boolean;
  note: string | null;
  answeredAt: string;
}
/**
 * The tenant's latest "Was it fixed?" answer on the request this job was
 * posted from, for the landlord's release decision (CompletionChoiceSheet).
 * Landlord only: the query names landlord_id = the caller, and RLS adds the
 * 'rentals' switch. Null when the job came from no request or nobody answered.
 * Display only: it is never wired into release.
 */
export async function fetchFixedAnswerForJob(jobId: string, uid: string): Promise<FixedAnswer | null> {
  const row = unwrap(
    await supabase
      .from("maintenance_requests")
      .select("id, tenant_says_fixed, tenant_fixed_note, tenant_answered_at")
      .eq("job_id", jobId)
      .eq("landlord_id", uid)
      .maybeSingle(),
  ) as Pick<MaintenanceRequest, "id" | "tenant_says_fixed" | "tenant_fixed_note" | "tenant_answered_at"> | null;
  if (!row || row.tenant_says_fixed == null || !row.tenant_answered_at) return null;
  return { requestId: row.id, saysFixed: row.tenant_says_fixed, note: row.tenant_fixed_note, answeredAt: row.tenant_answered_at };
}
