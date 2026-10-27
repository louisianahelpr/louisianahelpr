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
  for (const loc of locations) {
    if (!loc) continue;
    const f = parseLocationIntoFields(loc);
    if (!f.streetAddress.trim() || !f.city?.trim() || !f.zipCode?.trim()) continue;
    if ((f.addrState ?? "").toUpperCase() !== "LA") continue;
    return { streetAddress: f.streetAddress.trim(), city: f.city.trim(), addrState: "LA", zipCode: f.zipCode.trim() };
  }
  return null;
}

/**
 * Board 45's "saved address": the profile holds only a town (profiles.location),
 * never a street, so the one street address the app already has for a poster is
 * the one on their own last job (jobs.location, readable by its poster; the
 * rebook flow reads the same column). Nothing new is stored.
 */
export function useSavedJobAddress(): SavedAddress | null {
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
          .limit(10),
      ),
  });
  useEffect(() => {
    // Not fatal: without it the screen shows the address entry, as before.
    if (error) report(error, { severity: "warning", tags: { source: "useSavedJobAddress" } });
  }, [error]);
  return useMemo(() => savedAddressFrom((data ?? []).map((r) => r.location)), [data]);
}
