import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobHelprsChip } from "./JobCardMetaRow";

// Q1409: a booked crew's re-listed spot says how many spots are open.
// @mutate src/components/job-card/JobCardMetaRow.tsx |   return spotsOpen != null && spotsOpen > 0 && spotsOpen < count ? spotsOpen : null; |   return null;
// @mutate src/components/job-card/JobCardMetaRow.tsx | {`${open} spot${open === 1 ? "" : "s"} open`} | {`${open}`}

describe("JobHelprsChip", () => {
  it("a crew of 3 with 1 spot open says so", () => {
    render(<JobHelprsChip helpersNeeded={3} spotsOpen={1} />);
    expect(screen.getByText("1 spot open")).toBeInTheDocument();
    expect(screen.getByText("on a crew of 3", { exact: false })).toBeInTheDocument();
  });
  it("two open spots read in the plural", () => {
    render(<JobHelprsChip helpersNeeded={4} spotsOpen={2} />);
    expect(screen.getByText("2 spots open")).toBeInTheDocument();
  });
  it("a crew still wholly open, or with no count read, shows its size", () => {
    const { rerender } = render(<JobHelprsChip helpersNeeded={3} spotsOpen={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    rerender(<JobHelprsChip helpersNeeded={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/open/)).toBeNull();
  });
});
