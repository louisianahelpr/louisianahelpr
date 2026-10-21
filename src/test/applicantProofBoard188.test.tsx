// Board 188: proof on applicants: real completed jobs in this job's category first, or "New to Helpr ·
// ID verified" for someone with none; nothing while the count is not known (switch off / not deployed).
// @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantProofLine.tsx |   if (categoryCount === undefined) return null; |   if (false) return null;
// @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantProofLine.tsx |   } else if (totalCount === 0 && idVerified) { |   } else if (totalCount === 0) {
// @mutate src/pages/posts/postedJobs/useApplicantCategoryCounts.ts |     enabled: on && !!jobId, |     enabled: !!jobId,
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { ApplicantProofLine } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantProofLine";
import { blankComments } from "./helpers/blankNonCode";

describe("board 188: proof on applicants", () => {
  it("leads with the real count in this category, then the total", () => {
    render(<ApplicantProofLine categoryCount={12} totalCount={31} idVerified category="pressure_washing" />);
    expect(screen.getByText("12 pressure washing jobs on Helpr · 31 total")).toBeInTheDocument();
  });

  it("someone new says so only when the ID check is done, never a blank or a number", () => {
    const { container, rerender } = render(<ApplicantProofLine categoryCount={0} totalCount={0} idVerified category="cleaning" />);
    expect(container.textContent).toBe("New to Helpr · ID verified");
    rerender(<ApplicantProofLine categoryCount={0} totalCount={0} idVerified={false} category="cleaning" />);
    expect(container.textContent).toBe("");
  });

  it("other work but none in this category says so; an acronym category keeps its capitals", () => {
    render(<ApplicantProofLine categoryCount={0} totalCount={4} idVerified category="hvac" />);
    expect(screen.getByText("4 jobs on Helpr, none in HVAC yet")).toBeInTheDocument();
  });

  it("nothing while the count is not known (switch off, not deployed, read failed)", () => {
    const { container } = render(<ApplicantProofLine categoryCount={undefined} totalCount={31} idVerified category="cleaning" />);
    expect(container.textContent).toBe("");
  });

  it("the read is gated on the hidden switch and the panel passes undefined until it is known", () => {
    const hook = blankComments(readFileSync("src/pages/posts/postedJobs/useApplicantCategoryCounts.ts", "utf8"));
    expect(hook).toMatch(/useFeature\("applicant_proof"\)/);
    expect(hook).toMatch(/enabled: on && !!jobId,/);
    const panel = blankComments(readFileSync("src/pages/posts/postedJobs/ApplicantsPanel.tsx", "utf8"));
    expect(panel).toMatch(/categoryCount=\{categoryCounts \? categoryCounts\.get\(app\.helper_id\) \?\? 0 : undefined\}/);
  });
});
