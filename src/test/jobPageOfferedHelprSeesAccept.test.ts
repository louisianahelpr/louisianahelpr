/**
 * Owner 11-20 (poster ID at the offer; the address waits until the Helpr accepts): an offered Helpr no longer reads the
 * jobs row, so the job page reads the offer from open_jobs_browse, which admits a pending offeree. The page offers
 * Accept / Decline only when the row says direct_offer_status = "pending" (JobPage useOfferedToMe), so the browse read
 * must select that column; without it the review found the page showed no buttons (the RPC fallback below it is never
 * reached for a funded offer). The view itself serves the town only (20261120221545).
 *
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | `${BASE_COLUMNS}, expires_at, direct_offer_status` | `${BASE_COLUMNS}, expires_at`
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

describe("an offered Helpr's job page still offers Accept / Decline", () => {
  it("the browse read selects direct_offer_status, and the view returns it", () => {
    const page = blankComments(readFileSync("src/pages/jobs/jobPage/useJobPage.ts", "utf8"));
    expect(page).toContain('readJobsAheadOfDb(`${BASE_COLUMNS}, expires_at, direct_offer_status`, (columns) => supabase.from("open_jobs_browse")');
    const view = blankSqlComments(readFileSync("supabase/migrations/20261120221545_browse_and_detail_change_address_after_accept.sql", "utf8"));
    expect(view.length).toBeGreaterThan(500);
    expect(view).toMatch(/\n\s+direct_offer_status,\n/); // a selected column of the view, not just its WHERE
  });
});
