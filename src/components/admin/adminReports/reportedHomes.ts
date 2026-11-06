/**
 * The reports queue's half for a reported Homes listing (audit 11-05 A-H2, 20261106165850). `reported_id` is a
 * rental_listings id, never a person. The headline, kind, status and owner are read as admin through the table's
 * "rental listings: owner or admin" SELECT policy; no new RPC.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

export const HOME_LISTING_REPORT = "home_listing";

export type ReportedHome = {
  id: string;
  owner_id: string;
  headline: string;
  kind: "rent" | "sale";
  status: string;
};

/** Listings by id. A failed read is reported and yields an empty map (each row then reads "... unavailable"). */
export async function hydrateReportedHomes(rows: { reported_type: string; reported_id: string }[]): Promise<{
  homes: Map<string, ReportedHome>;
  failed: boolean;
}> {
  const ids = [...new Set(rows.filter((r) => r.reported_type === HOME_LISTING_REPORT).map((r) => r.reported_id))];
  const homes = new Map<string, ReportedHome>();
  if (ids.length === 0) return { homes, failed: false };
  const { data, error } = await supabase.from("rental_listings").select("id, owner_id, headline, kind, status").in("id", ids);
  if (error) {
    // Never blank the queue over a name read: reported, and the rows say the listing is unavailable.
    report(error, { severity: "warning", tags: { source: "AdminReports.hydrateHomes" } });
    return { homes, failed: true };
  }
  for (const h of (data ?? []) as ReportedHome[]) homes.set(h.id, h);
  return { homes, failed: false };
}

/** What the card calls it. */
export function homeSubject(h: ReportedHome | undefined, failed: boolean): string {
  if (h) return `${h.kind === "sale" ? "Home for sale" : "Home for rent"} "${h.headline}"`;
  return failed ? "Home listing unavailable" : "Deleted home listing";
}

/** Still up, so the card offers the take-down. rentals_admin_remove_listing takes only a live or paused listing. */
export const homeCanComeDown = (h: ReportedHome | undefined) => !!h && ["live", "paused"].includes(h.status);
