/**
 * A3-75 (audit 11-01): You > Reviews about you. A Declutter review row has Report, which opens the shared ReportDialog
 * for that review ('declutter_review'); a job review row is unchanged here (Jobs reviews are reported from ReviewList).
 * Server rules: src/test/pglite/declutterReviewReport.pglite.mjs.
 *
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx |         declutterReviewId: r.id, |         declutterReviewId: undefined,
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx | reportedType="declutter_review" reportedId={row.declutterReviewId} | reportedType="review" reportedId={row.declutterReviewId}
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx | onClick={() => setReporting(true)} data-report="declutter_review" | onClick={() => setReporting(false)} data-report="declutter_review"
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: [], error: null }) } }));
vi.mock("@/components/ReportDialog", () => ({
  default: ({ reportedType, reportedId }: { reportedType: string; reportedId: string }) => <div role="dialog" data-type={reportedType} data-id={reportedId} />,
}));

import { AboutYouRowCard, aboutYouRows } from "./reviewsAboutYou";

const declutter = [{ id: "dr1", reviewer_side: "buyer", stars: 1, comment: "Rude seller", created_at: "2026-10-30T15:00:00Z", tags: [] }];
const jobs = [{ rating: 5, feedback: "Great", created_at: "2026-10-29T15:00:00Z", reviewerName: "Kyle M.", side: "helpr", jobTitle: "Mow" }] as never;

describe("Reviews about you: Report on a Declutter review (A3-75)", () => {
  it("a Declutter row has Report, which opens the report form for that review", async () => {
    const [row] = aboutYouRows([], declutter);
    render(<AboutYouRowCard row={row} />);
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-type", "declutter_review");
    expect(dialog).toHaveAttribute("data-id", "dr1");
  });

  it("a job review row has no Report here", () => {
    const rows = aboutYouRows(jobs, []);
    expect(rows).toHaveLength(1);
    render(<AboutYouRowCard row={rows[0]} />);
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });
});
