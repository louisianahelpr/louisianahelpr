/**
 * The reports queue's half for a reported Declutter listing (item B, owner 2026-10-29). A listing report's
 * `reported_id` is a declutter_items id, never a person: its title, seller, status and test flag are read through
 * declutter_admin_reported_items (the items policy shows an admin only live and reserved listings, so a paused or
 * taken-down one would otherwise read as deleted).
 */
import type { ReportedListing } from "@/lib/declutter/api";
import { report } from "@/lib/errorLogger";

export const LISTING_REPORT = "declutter_item";

/** Listings by id. A failed read is reported and yields an empty map (each row then reads "Listing unavailable"). */
export async function hydrateReportedListings(rows: { reported_type: string; reported_id: string }[]): Promise<{
  listings: Map<string, ReportedListing>;
  failed: boolean;
}> {
  const ids = [...new Set(rows.filter((r) => r.reported_type === LISTING_REPORT).map((r) => r.reported_id))];
  const listings = new Map<string, ReportedListing>();
  if (ids.length === 0) return { listings, failed: false };
  try {
    const { fetchReportedListings } = await import("@/lib/declutter/api");
    for (const l of await fetchReportedListings(ids)) listings.set(l.item_id, l);
    return { listings, failed: false };
  } catch (err) {
    // Never blank the queue over a name read: reported, and the rows say the name is unavailable.
    report(err, { severity: "warning", tags: { source: "AdminReports.hydrateListings" } });
    return { listings, failed: true };
  }
}

/** What the card calls a reported listing. */
export function listingSubject(listing: ReportedListing | undefined, failed: boolean): string {
  if (listing) return `Listing "${listing.title}"`;
  return failed ? "Listing unavailable" : "Deleted listing";
}

/** A listing an admin can still take down (the server's own rule: live, paused or held). */
export function listingCanComeDown(listing: ReportedListing | undefined): boolean {
  return !!listing && ["live", "paused", "pending_review"].includes(listing.status);
}
