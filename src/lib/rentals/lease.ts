/**
 * Homes lease (owner D4: our Louisiana template only; 20261019110137). The landlord fills the template's
 * blanks and signs, which sends it; the tenant reads it and signs, or asks for changes. A signed lease is
 * final and belongs to both people (it outlives the tenancy and either account). Every write is an RPC
 * (the table has no client privilege).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { RentalsCopyError } from "./copy";
import {
  LEASE_TEMPLATES,
  LEASE_TEMPLATE_VERSION,
  cleanLeaseFields,
  leaseSha256,
  leaseText,
  normalizeSignature,
  type LeaseFields,
  type LeaseSection,
} from "./leaseTemplate";

/** The open lease as the landlord (or, once sent, the tenant) reads it. */
export interface OpenLease {
  id: string;
  status: "draft" | "sent";
  template_version: string;
  fields: LeaseFields;
  change_request: string | null;
  body_sha256: string | null;
  landlord_signed_name: string | null;
  landlord_signed_at: string | null;
  sent_at: string | null;
  updated_at: string;
}

/** What the tenant learns of a draft: only that one is being prepared, and their own note (lead review #8). */
interface DraftFlag {
  status: "draft";
  change_request: string | null;
}

export interface SignedLease {
  id: string;
  tenancy_id: string | null;
  side: "landlord" | "tenant";
  home_label: string | null;
  template_version: string;
  fields: LeaseFields;
  body_sha256: string;
  landlord_signed_name: string;
  landlord_signed_at: string;
  tenant_signed_name: string;
  tenant_signed_at: string;
  sent_at: string;
}

export interface LeaseRecord {
  side: "landlord" | "tenant";
  tenancy_status: "active" | "ended";
  can_edit: boolean;
  open: OpenLease | DraftFlag | null;
  signed: SignedLease[];
}

export function isOpenLease(o: LeaseRecord["open"]): o is OpenLease {
  return !!o && "id" in o;
}

/** null = the lease RPCs are not deployed yet (PGRST202): the card shows nothing, never a guessed side. */
export async function fetchLease(tenancyId: string): Promise<LeaseRecord | null> {
  const res = await supabase.rpc("rentals_lease", { p_tenancy_id: tenancyId });
  // Not deployed yet (lead review #10; the shared helper, named: a hint naming another function still means not deployed): nothing, never the card's load error.
  if (res.error && isMissingRpcNamed(res.error, "rentals_lease")) return null;
  const d = (unwrap(res) ?? {}) as unknown as Partial<LeaseRecord>;
  return {
    side: d.side === "landlord" ? "landlord" : "tenant",
    tenancy_status: d.tenancy_status === "ended" ? "ended" : "active",
    can_edit: d.can_edit === true,
    open: d.open ?? null,
    signed: Array.isArray(d.signed) ? d.signed : [],
  };
}

/** Every signed lease the member is a party to, whatever happened to the tenancy since (lead review #2). */
export async function fetchMyLeases(): Promise<SignedLease[]> {
  const res = await supabase.rpc("rentals_my_leases");
  if (res.error && isMissingRpcNamed(res.error, "rentals_my_leases")) return [];
  const d = unwrap(res) as unknown;
  return Array.isArray(d) ? (d as SignedLease[]) : [];
}

/** The lease's words for a stored lease, from ITS template version (a signed lease keeps its words). */
export function leaseSections(templateVersion: string, fields: LeaseFields): LeaseSection[] | null {
  const render = LEASE_TEMPLATES[templateVersion];
  return render ? render(fields) : null;
}

export async function leaseHash(templateVersion: string, fields: LeaseFields): Promise<string | null> {
  const sections = leaseSections(templateVersion, fields);
  return sections ? leaseSha256(leaseText(sections)) : null;
}

export async function saveLeaseDraft(tenancyId: string, fields: LeaseFields): Promise<string> {
  const blanks = cleanLeaseFields(fields) as unknown as Json;
  const { data, error } = await supabase.rpc("rentals_lease_save", {
    p_tenancy_id: tenancyId,
    p_template_version: LEASE_TEMPLATE_VERSION,
    p_fields: blanks,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_lease_save", error), error);
  return data as string;
}

const NEEDS_NEW_APP = "This lease needs the newest app. Update the app and try again.";

/**
 * The landlord signs and sends what was just saved (lead review round 3 M1a): the blanks are saved, read
 * back from the server, and the text hash of the STORED blanks must equal the hash of what the landlord's
 * screen showed, or nothing is sent. The server then checks the posted blanks are the stored ones (#1).
 */
export async function sendSavedLease(tenancyId: string, fields: LeaseFields, signedName: string, consent: boolean, initials: string[]): Promise<void> {
  const shown = cleanLeaseFields(fields);
  const shownHash = await leaseHash(LEASE_TEMPLATE_VERSION, shown);
  if (!shownHash) throw new RentalsCopyError(NEEDS_NEW_APP, null);
  const id = await saveLeaseDraft(tenancyId, shown);
  const rec = await fetchLease(tenancyId);
  const open = rec?.open ?? null;
  if (!isOpenLease(open) || open.id !== id || open.status !== "draft") throw new RentalsCopyError(LEASE_DID_NOT_SAVE, null);
  const storedHash = await leaseHash(open.template_version, open.fields);
  if (storedHash !== shownHash) throw new RentalsCopyError(LEASE_DID_NOT_SAVE, null);
  const stored = open.fields as unknown as Json;
  const { error } = await supabase.rpc("rentals_lease_send", {
    p_lease_id: id,
    p_template_version: open.template_version,
    p_fields: stored,
    p_body_sha256: storedHash,
    p_signed_name: normalizeSignature(signedName),
    p_consent: consent,
    p_initials: initials,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_lease_send", error), error);
}

const LEASE_DID_NOT_SAVE = "The lease didn't save exactly as shown, so it wasn't sent. Try again.";

export async function withdrawLease(leaseId: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_lease_withdraw", { p_lease_id: leaseId });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_lease_withdraw", error), error);
}

export async function discardLease(leaseId: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_lease_discard", { p_lease_id: leaseId });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_lease_discard", error), error);
}

export async function requestLeaseChanges(leaseId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_lease_request_changes", { p_lease_id: leaseId, p_note: note });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_lease_request_changes", error), error);
}

/**
 * The tenant signs the words THEIR screen rendered: `bodySha256` is the hash of the sections the sheet
 * showed (it already checked it equals lease.body_sha256), with the sent_at it read; the server refuses if
 * either moved (lead review round 3 M1/L7).
 */
export async function signLease(lease: OpenLease, bodySha256: string, signedName: string, consent: boolean, initials: string[]): Promise<void> {
  if (!lease.sent_at) throw new RentalsCopyError(NEEDS_NEW_APP, null);
  const { error } = await supabase.rpc("rentals_lease_sign", {
    p_lease_id: lease.id,
    p_sent_at: lease.sent_at,
    p_body_sha256: bodySha256,
    p_signed_name: normalizeSignature(signedName),
    p_consent: consent,
    p_initials: initials,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_lease_sign", error), error);
}

/**
 * Lead review #5: a PDF (and Read) state that both signatures cover the text whose fingerprint they show,
 * so the fingerprint is recomputed from the stored blanks first, rendering once. Returns the sections when
 * it matches; otherwise why not: an unknown template version (an older app) or a real mismatch.
 */
export async function verifiedLeaseSections(l: { template_version: string; fields: LeaseFields; body_sha256: string | null }): Promise<
  { ok: true; sections: LeaseSection[] } | { ok: false; reason: "unknown_version" | "mismatch" }
> {
  const sections = leaseSections(l.template_version, l.fields);
  if (!sections) return { ok: false, reason: "unknown_version" };
  return l.body_sha256 && (await leaseSha256(leaseText(sections))) === l.body_sha256 ? { ok: true, sections } : { ok: false, reason: "mismatch" };
}
