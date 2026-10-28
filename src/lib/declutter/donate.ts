/**
 * Declutter: donate what doesn't sell (Q2428, owner 2026-10-27; migration 20261027222743). On the "Haul it away"
 * card the seller picks a partner charity near the items (admin-curated); Post a Job is pre-filled to drop them
 * there. When that haul-away job is completed, each item gets a receipt: the item, the date and the charity. The
 * app never states what anything is worth.
 *
 * Every RPC refuses server-side without the 'declutter' AND 'declutter_haul_away' switches; this file is never
 * the protection. Nothing here moves money: the job is an ordinary Helpr job.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { loadAdminRpcErrorCopy } from "@/lib/lifecycleErrors";
import { rpcErrorMessage } from "./donateErrors";

export interface DonationPartner {
  id: string;
  name: string;
  address: string;
  parish: string;
  takes: string | null;
  miles: number;
  chosen: boolean;
}

export interface MyDonation {
  item_id: string;
  item_title: string;
  partner_name: string;
  partner_address: string;
  chosen_at: string;
  /** Set only on a receipt: when the haul-away job that took it was completed. */
  donated_at: string | null;
  receipt: boolean;
}

/** The RPC's data, or a throw carrying the plain words for its refusal on `userMessage`. */
function withWords<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
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

/** Partner charities within reach of every one of these items (the seller's own). */
export async function fetchDonationPartnersNear(itemIds: string[]): Promise<DonationPartner[]> {
  const rows = withWords(
    await supabase.rpc("declutter_donation_partners_near", { p_item_ids: itemIds }),
    (e) => rpcErrorMessage("declutter_donation_partners_near", e),
  );
  return (rows ?? []) as DonationPartner[];
}

/** Choose the charity for these items, or clear it (null). Answers how many items it set. */
export async function chooseDonation(itemIds: string[], partnerId: string | null): Promise<number> {
  const n = withWords(
    await supabase.rpc("declutter_choose_donation", { p_item_ids: itemIds, p_partner_id: partnerId as string }),
    (e) => rpcErrorMessage("declutter_choose_donation", e),
  );
  return Number(n ?? 0);
}

/** The seller's choices and receipts (all, or these items). */
export async function fetchMyDonations(itemIds?: string[]): Promise<MyDonation[]> {
  const rows = withWords(
    await supabase.rpc("declutter_my_donations", itemIds ? { p_item_ids: itemIds } : {}),
    (e) => rpcErrorMessage("declutter_my_donations", e),
  );
  return (rows ?? []) as MyDonation[];
}

/** The one charity every one of these items is set to go to (no receipt yet), or null. */
export function oneDonationPartner(rows: MyDonation[], itemIds: string[]): { name: string; address: string } | null {
  const mine = itemIds.map((id) => rows.find((r) => r.item_id === id && !r.receipt));
  if (mine.length === 0 || mine.some((r) => !r)) return null;
  const first = mine[0]!;
  return mine.every((r) => r!.partner_name === first.partner_name && r!.partner_address === first.partner_address)
    ? { name: first.partner_name, address: first.partner_address }
    : null;
}

/** "/post-job?haulAway=<ids>&donate=1": the haul-away link, pre-filled for the chosen charity. */
export function donatePostJobPath(haulAwayPath: string): string {
  return `${haulAwayPath}&donate=1`;
}

export interface DonationPartnerRow {
  id: string;
  parish: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  takes: string | null;
  active: boolean;
}

/** Admin: every partner (RLS lets only an admin read the table; a member reads none). */
export async function fetchAllDonationPartners(): Promise<DonationPartnerRow[]> {
  const result = await supabase
    .from("declutter_donation_partners")
    .select("id, parish, name, address, lat, lng, takes, active")
    .order("parish")
    .order("name");
  if (isNotDeployedYet(result.error)) return [];
  return ((unwrap(result) as DonationPartnerRow[] | null) ?? []).map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
}

/** Admin: add (id null) or edit a partner; retire it with active false. Audited by the server. */
export async function adminSaveDonationPartner(p: Omit<DonationPartnerRow, "id"> & { id: string | null }): Promise<string> {
  const res = await supabase.rpc("admin_declutter_save_donation_partner", {
    // nullable-arg: a new partner has no id yet (the server inserts it).
    p_id: p.id as unknown as string,
    p_parish: p.parish,
    p_name: p.name,
    p_address: p.address,
    p_lat: p.lat,
    p_lng: p.lng,
    p_takes: p.takes ?? "",
    p_active: p.active,
  });
  // Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return withWords(res, (e) => admin?.rpcErrorMessage("admin_declutter_save_donation_partner", e) ?? null) as unknown as string;
}
