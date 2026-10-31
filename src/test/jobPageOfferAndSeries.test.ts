/**
 * JOBS-18: a direct-offer recipient opening /jobs/:id got Apply or nothing, and the page's Apply and the offer card
 * did not say a job repeats. Viewer table: src/pages/jobs/jobPage/viewerState.test.ts.
 * JOBS-23: "Somewhere else · Add an address" sat selected above a filled-in address.
 *
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | helper_fee_percent, recurrence_days, recurrence_weeks, recurrence_interval, recurrence_end_date"; | helper_fee_percent";
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | posterFirst, onCrew, offeredToMe }); | posterFirst, onCrew });
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |       {seriesLine && <p data-offer-series="" |       {false && <p data-offer-series=""
 * @mutate src/components/postjob/LogisticsSection.tsx | sub: !onSaved && streetAddress.trim() ? "Address below" : "Add an address" } | sub: "Add an address" }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const cols = (name: string) =>
  (src("src/pages/jobs/jobPage/useJobPage.ts").match(new RegExp(`const ${name} =\\s*"([^"]+)"`))?.[1] ?? "").split(",").map((c) => c.trim());

describe("the job page and offer card say what is being offered", () => {
  it("the browse read carries the series fields seriesSummary needs", () => {
    expect(cols("BASE_COLUMNS").length).toBeGreaterThan(10);
    for (const c of ["date_needed", "recurrence_days", "recurrence_weeks", "recurrence_interval", "recurrence_end_date"]) expect(cols("BASE_COLUMNS"), c).toContain(c);
  });

  it("the party read never names the withheld offeree column, and the viewer's own offers list answers", () => {
    expect(cols("PARTY_COLUMNS")).toContain("direct_offer_status");
    expect(cols("PARTY_COLUMNS")).not.toContain("offered_to_helper_id");
    expect(src("src/pages/jobs/jobPage/useJobPage.ts")).toContain('supabase.rpc("get_my_pending_direct_offers").eq("id", jobId!)');
  });

  it("the page passes the offer to the viewer table and shows the series line unless hired", () => {
    const page = src("src/pages/jobs/jobPage/JobPage.tsx");
    expect(page).toMatch(/const offeredToMe = useOfferedToMe\(/);
    expect(page).toContain("posterFirst, onCrew, offeredToMe });");
    expect(page).toContain('{!isHired && seriesSummary(job) && <p data-job-series=""');
  });

  it("the offer card shows the series line", () => {
    expect(src("src/pages/jobs/appliedJobCard/OfferedActions.tsx")).toContain('{seriesLine && <p data-offer-series=""');
  });

  it("Somewhere else does not ask for an address that is already filled in", () => {
    expect(src("src/components/postjob/LogisticsSection.tsx")).toContain('sub: !onSaved && streetAddress.trim() ? "Address below" : "Add an address" }');
  });
});
