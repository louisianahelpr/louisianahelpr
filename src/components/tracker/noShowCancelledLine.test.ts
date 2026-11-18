/**
 * Area 11 H3 (11-18): a job cancelled after the poster reported a no-show read like a plain cancel ("This job was
 * cancelled · Refund sent to your card"). The money rule (void-cancelled-payments F272): with jobs.no_show_reported_at
 * set, no confirmed Helpr and not a crew, the refund returns every cent. The poster's line now says who didn't show
 * and that the refund is full, and only in exactly that case.
 *
 * @mutate src/components/tracker/jobProgressState.ts |   const noShowFull = poster && !!job.no_show_reported_at && job.is_group_job !== true && !job.helper_confirmed_at; |   const noShowFull = false;
 * @mutate src/components/tracker/jobProgressState.ts | && job.is_group_job !== true && !job.helper_confirmed_at; | ;
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | revision_acceptance_deadline, no_show_reported_at"; | revision_acceptance_deadline";
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { applicantCounts } from "@/pages/jobs/jobPage/useJobPage";

const job = { id: "j1", status: "cancelled", payment_status: "refunded", customer_id: "p1", cancelled_by: "p1", helper_id: null, helper_confirmed_at: null, no_show_reported_at: "2026-11-18T08:00:00Z" };
const line = (j: Record<string, unknown>, viewer: "poster" | "helpr" = "poster", otherFirst: string | null = "Eli") =>
  String(jobProgress(j as never, { viewer, otherFirst } as never).next);

describe("a no-show then a cancel says so, with the full refund (area 11 H3)", () => {
  it("names who didn't show and says the full refund", () => {
    expect(line(job)).toBe("Eli didn't show up · Full refund sent to your card");
    expect(line(job, "poster", null)).toBe("Your Helpr didn't show up · Full refund sent to your card");
    expect(line({ ...job, payment_status: "escrow" })).toBe("Eli didn't show up");
  });
  it("never claims a full refund outside the server's rule", () => {
    // A crew, or a new Helpr confirmed after the no-show, keeps the ordinary cancel rule (and its words).
    expect(line({ ...job, is_group_job: true })).not.toMatch(/Full refund/);
    expect(line({ ...job, helper_confirmed_at: "2026-11-18T09:00:00Z" })).not.toMatch(/Full refund/);
    expect(line({ ...job, no_show_reported_at: null })).not.toMatch(/didn't show|Full refund/);
    // The Helpr's own side never reads the poster's refund.
    expect(line(job, "helpr", "Lexi")).not.toMatch(/Full refund/);
  });
  it("the page reads the marker and who didn't show", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../pages/jobs/jobPage/useJobPage.ts"), "utf8");
    expect(src).toMatch(/const PARTY_COLUMNS =[^;]*\bno_show_reported_at\b/);
    const counts = applicantCounts([
      { status: "rejected", closed_reason: "no_show", updated_at: "2026-11-18T08:00:00Z", helper_id: "h1" },
      { status: "pending", closed_reason: null, updated_at: null, helper_id: "h2" },
    ] as never);
    expect(counts.noShowHelperId).toBe("h1");
    expect(counts.total).toBeGreaterThan(0);
  });
});
