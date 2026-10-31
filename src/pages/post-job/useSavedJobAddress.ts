import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { parseLocationIntoFields } from "./postJobFormHelpers";

/** A full Louisiana street address the poster has posted a job at before. */
export interface SavedAddress {
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
}

/**
 * The newest location that is a WHOLE Louisiana address (street, city, LA,
 * ZIP). A city-only row ("Delcambre, LA", guest posts and older jobs), an
 * anonymised null and an out-of-state row are skipped, so the radio never
 * offers an address the form would then refuse.
 */
export function savedAddressFrom(locations: readonly (string | null | undefined)[]): SavedAddress | null {
  return savedAddressesFrom(locations, 1)[0] ?? null;
}

/** How many places the WHERE radio offers at most (GROW-4: a landlord's few properties, not a list to scroll). */
export const SAVED_PLACES_MAX = 4;

/** Same street, town and 5-digit ZIP, ignoring case, spacing and a ZIP+4 tail. */
export function samePlace(a: { streetAddress: string; city: string; zipCode: string }, b: { streetAddress: string; city: string; zipCode: string }): boolean {
  const n = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  return n(a.streetAddress) === n(b.streetAddress) && n(a.city) === n(b.city) && a.zipCode.replace(/\D/g, "").slice(0, 5) === b.zipCode.replace(/\D/g, "").slice(0, 5);
}

/**
 * GROW-4 (repeat posters, owner growth item): every DIFFERENT whole Louisiana address the poster has posted at,
 * newest first, at most `max`. A landlord or property manager posting for another property picks it in one tap
 * instead of typing it again. The same place posted twice counts once.
 */
export function savedAddressesFrom(locations: readonly (string | null | undefined)[], max: number = SAVED_PLACES_MAX): SavedAddress[] {
  const out: SavedAddress[] = [];
  for (const loc of locations) {
    if (out.length >= max) break;
    if (!loc) continue;
    const f = parseLocationIntoFields(loc);
    if (!f.streetAddress.trim() || !f.city?.trim() || !f.zipCode?.trim()) continue;
    if ((f.addrState ?? "").toUpperCase() !== "LA") continue;
    const place: SavedAddress = { streetAddress: f.streetAddress.trim(), city: f.city.trim(), addrState: "LA", zipCode: f.zipCode.trim() };
    if (out.some((p) => samePlace(p, place))) continue;
    out.push(place);
  }
  return out;
}

/**
 * Board 45's "saved address": the profile holds only a town (profiles.location),
 * never a street, so the street addresses the app already has for a poster are
 * the ones on their own jobs (jobs.location, readable by its poster; the
 * rebook flow reads the same column). Nothing new is stored.
 * GROW-4: `savedAddress` is the newest; `otherSavedAddresses` the poster's other places, newest first.
 */
export function useSavedJobAddress(): { savedAddress: SavedAddress | null; otherSavedAddresses: SavedAddress[] } {
  const { user } = useCurrentUser();
  const uid = user?.id ?? null;
  const { data, error } = useQuery({
    queryKey: ["post-job-saved-address", uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("jobs")
          .select("location")
          .eq("customer_id", uid as string)
          .not("location", "is", null)
          .order("created_at", { ascending: false })
          .limit(40),
      ),
  });
  useEffect(() => {
    // Not fatal: without it the screen shows the address entry, as before.
    if (error) report(error, { severity: "warning", tags: { source: "useSavedJobAddress" } });
  }, [error]);
  return useMemo(() => {
    const places = savedAddressesFrom((data ?? []).map((r) => r.location));
    return { savedAddress: places[0] ?? null, otherSavedAddresses: places.slice(1) };
  }, [data]);
}
