/**
 * JA-31 (audit 11-01): a job sent back for a fix said "Dana asked for a fix" on the Helpr's page and never WHAT to fix
 * or by when (revision_note was not in the page's read). The page now reads revision_note and revision_deadline and
 * shows them, for both parties, while the fix is open.
 *
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | cancellation_fee, revision_note, revision_deadline, require_photo_proof | cancellation_fee, require_photo_proof
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   if (job.status !== "revision_requested") return null; |   return null;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {(isPoster \|\| isHired) && <RevisionAsk job={job} | {false && <RevisionAsk job={job}
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { RevisionAsk } from "@/pages/jobs/jobPage/JobPageParts";

const row = (over: Partial<JobPageRow>): JobPageRow => ({
  id: "j", title: "Haul off a couch", description: null, category: "moving", budget: 120, date_needed: null, start_time: null,
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "revision_requested", payment_status: "escrow",
  urgent_fee: null, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  ...over,
});

afterEach(cleanup);

describe("what to fix, on the job page (JA-31)", () => {
  it("the Helpr reads the poster's words and the fix deadline in Louisiana time", () => {
    const { container } = render(<RevisionAsk job={row({ revision_note: "The back gate area was missed.", revision_deadline: "2037-10-21T14:30:00Z" })} side="helpr" posterFirst="Dana" />);
    const t = container.textContent ?? "";
    expect(t).toContain("Dana's note: The back gate area was missed.");
    expect(t).toContain("Send the fix by Wed, Oct 21, 9:30 AM.");
  });

  it("the poster sees their own note; nothing once the fix is done or with nothing to say", () => {
    expect(render(<RevisionAsk job={row({ revision_note: "Gate missed" })} side="poster" />).container.textContent).toContain("Your note: Gate missed");
    cleanup();
    expect(render(<RevisionAsk job={row({ status: "in_progress", revision_note: "Gate missed" })} side="helpr" />).container.innerHTML).toBe("");
    cleanup();
    expect(render(<RevisionAsk job={row({})} side="helpr" />).container.innerHTML).toBe("");
  });

  it("the page reads both columns and draws the box for both parties", () => {
    const hook = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/useJobPage.ts"), "utf8");
    const party = (hook.match(/const PARTY_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "").split(/,\s*/);
    expect(party.length).toBeGreaterThan(20);
    expect(party).toEqual(expect.arrayContaining(["revision_note", "revision_deadline"]));
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(page).toContain('{(isPoster || isHired) && <RevisionAsk job={job} side={isPoster ? "poster" : "helpr"} posterFirst={posterFirst} />}');
  });
});
