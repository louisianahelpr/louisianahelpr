/**
 * Saved homes (20261019185722): the heart on a Homes card and the Saved list.
 * The member reads their own saved_homes rows (RLS: user_id = auth.uid());
 * the one write is rentals_set_saved_home; the list is rentals_saved_listings
 * (the same public facts Browse shows). Before db-deploy has created them,
 * PostgREST answers PGRST202 / PGRST205: that reads as "nothing saved".
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { RentalsCopyError } from "./copy";

export type SavedListing = Database["public"]["Functions"]["rentals_saved_listings"]["Returns"][number];

/** saved_homes before db-deploy created it: PostgREST answers PGRST205 (no such table). */
function tableNotDeployed(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "PGRST205");
}

/** The listing ids the member saved. */
export async function fetchSavedHomeIds(): Promise<Set<string>> {
  const res = await supabase.from("saved_homes").select("listing_id");
  if (res.error && tableNotDeployed(res.error)) return new Set();
  return new Set((unwrap(res) ?? []).map((r) => r.listing_id));
}

/** Save or unsave one home. Returns whether it is saved now. */
export async function setSavedHome(listingId: string, saved: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("rentals_set_saved_home", { p_listing_id: listingId, p_saved: saved });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_set_saved_home", error), error);
  return data === true;
}

/** The Saved list: homes still listed, newest saved first. */
export async function fetchSavedListings(): Promise<SavedListing[]> {
  const res = await supabase.rpc("rentals_saved_listings");
  if (isMissingRpcNamed(res.error, "rentals_saved_listings")) return [];
  return (unwrap(res) ?? []) as SavedListing[];
}
