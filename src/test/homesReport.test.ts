/**
 * Homes report button (audit 11-05 A-H2, the rest of docs/NOT-LAUNCHED.md Q2187): a member reports a Homes listing
 * they can be shown (never their own), and an admin takes it down from the reports queue. Reads the EFFECTIVE
 * (newest) definitions and the screens; behaviour on a real database is src/test/pglite/homesReport.pglite.mjs
 * (3x, Supabase's default anon execute grant emulated).
 *
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |     IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM hl.owner_id THEN |     IF false THEN
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql | OR NOT public.rentals_listing_visible(hl.id))) THEN | OR false)) THEN
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql | (NOT public.feature_enabled_for('rentals') OR | (false OR
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |       WHEN 'home_listing' THEN 'a home listing'\n      WHEN 'home_talk_message' |       WHEN 'home_talk_message'
 * @mutate src/components/rentals/listings/ListingView.tsx | {!l.is_mine && <HomeListingReport listingId={l.id} />} | <HomeListingReport listingId={l.id} />
 * @mutate src/components/admin/adminReports/fetchReports.ts | hydrateReportedShops(reportRows), hydrateReportedHomes(reportRows)] | hydrateReportedShops(reportRows), Promise.resolve({ homes: new Map(), failed: false })]
 * @mutate src/components/admin/adminReports/reportedHomes.ts | ["live", "paused"].includes(h.status) | true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { REASONS, REPORTED_NOUN, REASON_PROMPT } from "@/components/reportDialog/reportReasons";
import { homeCanComeDown, homeSubject } from "@/components/admin/adminReports/reportedHomes";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).replace(/\s+/g, " ");
const typeFile = [...files].reverse().find((f) => sqlOf(f).includes("ADD CONSTRAINT reports_reported_type_check")) ?? "";
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");

describe("a Homes listing can be reported (audit 11-05 A-H2, Q2187)", () => {
  it("reads the newest definitions (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    for (const fn of ["report_message_party_and_copy", "notify_reporter_report_outcome"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("the database allows home_listing, and the client's dialog knows it", () => {
    expect(sqlOf(typeFile)).toContain("'home_listing'::text");
    expect(REASONS.home_listing[0].label).toBe("Discriminates (fair housing)");
    expect(REASONS.home_listing.length).toBeGreaterThan(3);
    expect(REPORTED_NOUN.home_listing).toBe("Listing");
    expect(REASON_PROMPT.home_listing).toBe("What's wrong with this listing?");
  });

  it("the copy trigger: only a listing the reporter could be shown, never your own, the older branches kept", () => {
    const f = flat("report_message_party_and_copy");
    expect(f).toContain("IF NEW.reported_type = 'home_listing' THEN");
    expect(f).toContain("AND (NOT public.feature_enabled_for('rentals') OR NOT public.rentals_listing_visible(hl.id))) THEN RAISE EXCEPTION 'report_target_not_found'");
    expect(f).toContain("IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM hl.owner_id THEN RAISE EXCEPTION 'report_own_content'");
    for (const kept of ["IF NEW.reported_type = 'shop_talk_message' THEN", "IF NEW.reported_type IN ('shop', 'shop_item') THEN",
      "IF NEW.reported_type = 'declutter_review' THEN", "NEW.reporter_id IS DISTINCT FROM m.receiver_id"]) {
      expect(f, kept).toContain(kept);
    }
    expect(flat("notify_reporter_report_outcome")).toContain("WHEN 'home_listing' THEN 'a home listing'");
  });

  it("the listing page offers Report to everyone but its owner; the queue hydrates and takes it down", () => {
    expect(src("src/components/rentals/listings/ListingView.tsx")).toContain("{!l.is_mine && <HomeListingReport listingId={l.id} />}");
    expect(src("src/components/rentals/listings/HomeListingReport.tsx")).toContain('reportedType="home_listing"');
    expect(src("src/components/admin/adminReports/fetchReports.ts")).toContain("hydrateReportedShops(reportRows), hydrateReportedHomes(reportRows)]");
    expect(src("src/components/admin/AdminReports.tsx")).toContain("<HomeReportPanel home={report.reported_home}");
    const panel = src("src/components/admin/adminReports/HomeReportPanel.tsx");
    expect(panel).toContain("adminRemoveListing(home.id, note.trim())");
    expect(panel).toContain('.update({ status: "resolved" }).eq("id", reportId).select("id")');
  });

  it("the queue card names the listing and offers the take-down only while it is up", () => {
    const h = { id: "x", owner_id: "o", headline: "2 bed near the park", kind: "rent" as const, status: "live" };
    expect(homeSubject(h, false)).toBe('Home for rent "2 bed near the park"');
    expect(homeSubject({ ...h, kind: "sale" }, false)).toBe('Home for sale "2 bed near the park"');
    expect(homeSubject(undefined, true)).toBe("Home listing unavailable");
    expect(homeSubject(undefined, false)).toBe("Deleted home listing");
    expect(homeCanComeDown(h)).toBe(true);
    expect(homeCanComeDown({ ...h, status: "paused" })).toBe(true);
    for (const status of ["removed", "draft", "leased", "sold"]) expect(homeCanComeDown({ ...h, status }), status).toBe(false);
    expect(homeCanComeDown(undefined)).toBe(false);
  });
});
