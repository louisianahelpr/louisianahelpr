/**
 * "Permit on file" and the Shops paperwork queue (docs/NOT-LAUNCHED.md Q1952; migration 20261110195956; spec L47, L52,
 * L56, L73). A shop owner sends a food permit or an inflatable registration with its expiry date; an admin checks it;
 * the shop shows "Permit on file" until the date passes. The admin's paperwork queue also lists the Secretary of State
 * numbers waiting for a check (the number is returned to admins only, by shops_admin_paperwork).
 *
 * The document goes to the private user-documents bucket under <uid>/shop-permits/<kind>-<13-digit time>.<ext>; the
 * server refuses any other path, and any path that was not uploaded.
 */
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { loadAdminRpcErrorCopy } from "@/lib/lifecycleErrors";
import { rpcErrorMessage } from "./rpcErrorCopy";

export type PermitKind = "food_permit" | "inflatable_registration";

export const PERMIT_KIND_LABEL: Record<PermitKind, string> = {
  food_permit: "Food permit",
  inflatable_registration: "Inflatable (bounce house) registration",
};

export interface MyPermit {
  kind: PermitKind;
  status: "pending" | "verified" | "rejected";
  expires_on: string;
  review_note: string | null;
  sent_at: string;
  expired: boolean;
}

export interface PendingPermit {
  permit_id: string;
  shop_id: string;
  shop_name: string;
  owner_id: string;
  kind: PermitKind;
  document_path: string;
  expires_on: string;
  sent_at: string;
  is_seed: boolean;
}

export interface PendingRegistration {
  shop_id: string;
  shop_name: string;
  owner_id: string;
  sos_number: string;
  area_label: string;
  updated_at: string;
  is_seed: boolean;
}

export interface Paperwork {
  permits: PendingPermit[];
  registrations: PendingRegistration[];
}

/** The extension comes from the file's type, never its name (the server checks the path's extension). */
export const PERMIT_DOC_EXT_BY_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};
export const PERMIT_DOC_MAX_BYTES = 10 * 1024 * 1024;

function withWords<T>(res: { data: T; error: { message: string } | null }, words: string | null): T {
  if (!res.error) return res.data;
  try {
    unwrap(res);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    if (words && Object.isExtensible(e)) e.userMessage = words;
    throw e;
  }
  return res.data;
}

export async function fetchMyPermits(): Promise<MyPermit[]> {
  const res = await supabase.rpc("shops_my_permits");
  return (withWords(res, rpcErrorMessage("shops_my_permits", res.error)) ?? []) as MyPermit[];
}

/** Uploads the document, then sends it for a check. A refused send removes the upload again. */
export async function submitPermit(userId: string, kind: PermitKind, file: File, expiresOn: string): Promise<void> {
  const ext = PERMIT_DOC_EXT_BY_TYPE[file.type];
  if (!ext) throw Object.assign(new Error("invalid_permit_document"), { userMessage: "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF." });
  if (file.size > PERMIT_DOC_MAX_BYTES) throw Object.assign(new Error("invalid_permit_document"), { userMessage: "That file is over 10 MB. Upload a smaller copy." });
  const path = `${userId}/shop-permits/${kind}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from("user-documents")
    .upload(path, file, { upsert: false, contentType: file.type, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
  if (up.error) throw up.error;
  const res = await supabase.rpc("shops_submit_permit", { p_kind: kind, p_document_path: path, p_expires_on: expiresOn });
  if (res.error) {
    // The permit row was not written, so the upload is an orphan: remove it (best effort; the send's error is the answer).
    const rm = await supabase.storage.from("user-documents").remove([path]);
    if (rm.error) console.warn("[permits] could not remove a refused upload", rm.error.message);
  }
  withWords(res, rpcErrorMessage("shops_submit_permit", res.error));
}

type AdminCopy = NonNullable<Awaited<ReturnType<typeof loadAdminRpcErrorCopy>>>;
async function adminWords(res: { error: { message: string } | null }, words: (a: AdminCopy, e: { message: string }) => string | null) {
  if (!res.error) return null;
  const admin = await loadAdminRpcErrorCopy();
  return admin ? words(admin, res.error) : null;
}

export async function fetchPaperwork(): Promise<Paperwork & { notDeployed?: boolean }> {
  const res = await supabase.rpc("shops_admin_paperwork");
  // A brand-new RPC the database has not deployed yet: "not on the server yet", never an empty list.
  if (isMissingRpcNamed(res.error, "shops_admin_paperwork")) return { permits: [], registrations: [], notDeployed: true };
  const data = withWords(res, await adminWords(res, (a, e) => a.rpcErrorMessage("shops_admin_paperwork", e))) as unknown as Paperwork | null;
  return { permits: data?.permits ?? [], registrations: data?.registrations ?? [] };
}

export async function reviewPermit(permitId: string, approve: boolean, note: string): Promise<string> {
  const res = await supabase.rpc("shops_admin_review_permit", { p_permit_id: permitId, p_approve: approve, p_note: note });
  return withWords(res, await adminWords(res, (a, e) => a.rpcErrorMessage("shops_admin_review_permit", e))) as string;
}

export async function checkRegistration(shopId: string, verified: boolean): Promise<boolean> {
  const res = await supabase.rpc("shops_admin_check_registration", { p_shop_id: shopId, p_verified: verified });
  return withWords(res, await adminWords(res, (a, e) => a.rpcErrorMessage("shops_admin_check_registration", e))) as boolean;
}

/** A short-lived link to the document (admins read any user-documents object; the owner reads their own). */
export async function permitDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("user-documents").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw error ?? new Error("no_signed_url");
  return data.signedUrl;
}
