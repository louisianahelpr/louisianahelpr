// Boards 22/170: pick 2-3 applicants, compare side by side from real row facts, hire through the card's own handler.
// @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantCompare.tsx |   if (picked.length < 2) return null; |   if (picked.length < 1) return null;
// @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantCompare.tsx | : cur.length >= COMPARE_MAX ? cur : [...cur, id])); | : [...cur, id]));
// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | {!wide && sortedApplications.slice(0, shown).map( | {!wide && sortedApplications.map(
// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | <CompareBar apps={applications} ids={compare.ids} clear={compare.clear} onHire={onAcceptApplication} | <CompareBar apps={applications} ids={[]} clear={compare.clear} onHire={onAcceptApplication}
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { CompareBar, CompareCheck, ShowMoreApplicants, useApplicantCompare } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantCompare";
import { blankComments } from "./helpers/blankNonCode";

const app = (id: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id, helper_id: `h-${id}`, status: "pending", message: `note ${id}`, flagged_hidden: false, reviewCount: 4, avgRating: 4.75,
    profiles: { full_name: name, is_id_verified: true, is_payout_ready: true }, ...over }) as never;

describe("boards 22/170: compare applicants", () => {
  it("picks at most three", () => {
    const { result } = renderHook(() => useApplicantCompare());
    for (const id of ["a", "b", "c", "d"]) act(() => result.current.toggle(id));
    expect(result.current.ids).toEqual(["a", "b", "c"]);
    render(<CompareCheck id="d" name="Dee" ids={result.current.ids} toggle={result.current.toggle} />);
    expect(screen.getByRole("checkbox", { name: "Compare Dee" })).toBeDisabled();
  });

  it("shows nothing for one pick; for two, a side-by-side of real facts and a Hire that uses the card's handler", () => {
    const apps = [app("a", "Andre Lafleur"), app("b", "Bree Simon", { reviewCount: 0, flagged_hidden: true, profiles: { full_name: "Bree Simon", is_id_verified: false, is_payout_ready: false } })];
    const onHire = vi.fn();
    const { rerender } = render(<CompareBar apps={apps} ids={["a"]} clear={() => {}} distanceOf={() => null} onHire={onHire} />);
    expect(screen.queryByText(/selected/)).toBeNull();
    rerender(<CompareBar apps={apps} ids={["a", "b"]} clear={() => {}} distanceOf={(x) => ((x as { id: string }).id === "a" ? "Under 5 mi" : null)} onHire={onHire} />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare side by side" }));
    expect(screen.getByText("4.8 from 4")).toBeInTheDocument();
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.getByText("Payout setup not finished")).toBeInTheDocument();
    expect(screen.getByText("Under 5 mi")).toBeInTheDocument();
    // A note the scanner hid is never shown.
    expect(screen.queryByText(/note b/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/take.?home|receives/i);
    fireEvent.click(screen.getByRole("button", { name: "Hire Andre" }));
    expect(onHire).toHaveBeenCalledWith(apps[0]);
  });

  it("the Applicants panel wires the tick on pending cards and the bar under the list", () => {
    const src = blankComments(readFileSync("src/pages/posts/postedJobs/ApplicantsPanel.tsx", "utf8"));
    expect(src).toMatch(/app\.status === "pending" && applications\.length > 1 && <CompareCheck/);
    expect(src).toMatch(/<CompareBar apps=\{applications\} ids=\{compare\.ids\}/);
  });

  // Board 173: long lists load 10 at a time, no infinite scroll on the poster side.
  it("board 173: 'Show 10 more' under a long list, the remainder at the end, nothing once all show", () => {
    const more = vi.fn();
    const { rerender, container } = render(<ShowMoreApplicants total={50} shown={10} onMore={more} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    expect(more).toHaveBeenCalled();
    rerender(<ShowMoreApplicants total={50} shown={46} onMore={more} />);
    expect(screen.getByRole("button", { name: "Show 4 more" })).toBeInTheDocument();
    rerender(<ShowMoreApplicants total={50} shown={50} onMore={more} />);
    expect(container.textContent).toBe("");
    const src = blankComments(readFileSync("src/pages/posts/postedJobs/ApplicantsPanel.tsx", "utf8"));
    expect(src).toMatch(/sortedApplications\.slice\(0, shown\)\.map\(/);
    expect(src).toMatch(/useState\(10\)/);
  });
});
