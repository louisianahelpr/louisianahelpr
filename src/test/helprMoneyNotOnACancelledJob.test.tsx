/**
 * A HELPR IS NEVER TOLD "YOU TAKE HOME $120" ON A JOB THAT PAYS THEM NOTHING (audit 11-01 JA-24, JA-29).
 *
 * The Helpr's money box on the job page (HelprMoney) read "You take home $120" on a cancelled job and on one where
 * they were reported a no-show (shots job-cancelled-helpr-375, job-noshow-reported-helpr-375), and as a certainty
 * during a dispute. Now: a cancelled job says "Not paid" (or, on the poster's late cancel, that they share the fee),
 * a no-show says so, and a disputed job says the amount is "On hold while we review", with no setup-fee line.
 *
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   if (job.status !== "cancelled") return null; |   return null;
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   if (noShow) return { title: "Not paid" | if (false) return { title: "Not paid"
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const disputed = job.status === "disputed" \|\| !!job.has_active_dispute; |   const disputed = false;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | <HelprMoney job={job} noShow={myApplication.data?.closed_reason === "no_show"} /> | <HelprMoney job={job} />
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 2 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "h" }, profile: null }) }));
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { HelprMoney } from "@/pages/jobs/jobPage/JobPageParts";

const row = (over: Partial<JobPageRow>): JobPageRow => ({
  id: "j", title: "Haul off a couch", description: null, category: "moving", budget: 120, date_needed: null, start_time: null,
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "accepted", payment_status: "escrow",
  urgent_fee: null, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  ...over,
});

const box = (job: JobPageRow, noShow = false) => {
  render(<MemoryRouter><HelprMoney job={job} noShow={noShow} /></MemoryRouter>);
  return document.querySelector("[data-helpr-money]")!.textContent ?? "";
};

afterEach(cleanup);

describe("the Helpr's money box (JA-24, JA-29)", () => {
  it("a live job: the take-home and the setup-fee line (control)", () => {
    const t = box(row({}));
    expect(t).toContain("You take home");
    expect(t).toMatch(/\$\d/);
  });

  it("a cancelled job: no take-home, says they aren't paid", () => {
    const t = box(row({ status: "cancelled", payment_status: "refunded", cancelled_by: "p" }));
    expect(t).not.toContain("take home");
    expect(t).not.toMatch(/\$\d/);
    expect(t).toContain("Not paid");
  });

  it("the poster cancelled late (a fee was charged): they share the fee, still no take-home figure", () => {
    const t = box(row({ status: "cancelled", cancelled_by: "p", cancellation_fee: 30 }));
    expect(t).not.toContain("take home");
    expect(t).toContain("Cancelled late");
  });

  it("reported a no-show: not paid, even before the job row says cancelled", () => {
    const t = box(row({ status: "in_progress" }), true);
    expect(t).not.toContain("take home");
    expect(t).toContain("no-show");
  });

  it("a dispute: the amount is on hold, never a certain take-home, and no setup-fee line", () => {
    for (const j of [row({ status: "disputed" }), row({ status: "in_progress", has_active_dispute: true })]) {
      const t = box(j);
      expect(t).toContain("On hold while we review");
      expect(t).not.toContain("You take home");
      expect(t).not.toMatch(/setup/i);
      cleanup();
    }
  });

  it("the job page passes the Helpr's no-show to the box", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    const uses = src.match(/<HelprMoney\b[^>]*>/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toContain('noShow={myApplication.data?.closed_reason === "no_show"}');
  });
});
