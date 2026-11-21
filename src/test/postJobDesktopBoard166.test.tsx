// Board 166 (desktop Post a job, step 1): the step rail, the group cards'
// "what's in it" line, and the open group's olive outline (not a fill).
// @mutate src/components/postjob/PostJobStepRail.tsx | {done && onPick && (canPick?.(key) ?? true) ? ( | {false ? (
// @mutate src/lib/jobCategoryGroups.ts |   trades: "Electrical, plumbing, HVAC", |   trades: "Electrical, plumbing, hvac",
// @mutate src/components/postjob/JobCategoryGroups.tsx | ${pressed ? "border-2 !border-primary" : "border border-border"} | ${pressed ? "btn-grad-primary" : "border border-border"}
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

describe("board 166: the step rail", () => {
  // Owner 11-20 (ease batch, item 1): the rail is the 3-step flow from the one list (POST_JOB_STEPS): What you need
  // (the group grid, JA-41, is its first screen), When, Budget, then Post. Was six screens.
  it("names the steps from the one list, marks the current one, and reopens only a passed step canPick allows", () => {
    const onPick = vi.fn();
    const { unmount } = render(<PostJobStepRail screen="price" onPick={onPick} canPick={(s) => s === "groups" || s === "where"} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/, done.*$/, ""))).toEqual(["What you need", "When", "3Budget", "4Post"]);
    expect(screen.getByText("Budget").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
    const back = screen.getAllByRole("button");
    expect(back).toHaveLength(2);
    fireEvent.click(back[0]);
    expect(onPick).toHaveBeenLastCalledWith("groups");
    fireEvent.click(back[1]);
    expect(onPick).toHaveBeenLastCalledWith("where");
    unmount();
    // A passed step canPick refuses is not a button; a step ahead never is.
    render(<PostJobStepRail screen="where" onPick={onPick} canPick={(s) => s === "where"} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("When").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
  });
});

describe("board 166: group cards", () => {
  it("say what is in a bigger group, keep acronyms, and outline (not fill) the group holding the pick", () => {
    render(<JobCategoryGroups category="pressure_washing" setCategory={() => {}} group={null} setGroup={() => {}} onPicked={() => {}} />);
    const trades = screen.getByRole("button", { name: /^Trades/ });
    expect(trades.textContent).toMatch(/HVAC/);
    const home = screen.getByRole("button", { name: /^Home/ });
    expect(home.getAttribute("aria-pressed")).toBe("true");
    expect(home.className).toContain("border-2");
    expect(home.className).not.toContain("btn-grad-primary");
    // F113 (owner 11-09): the group icon is a line icon (svg), so the tile's text starts with its title.
    expect(home.textContent).toMatch(/^HomeCleaning, handyman/u);
    expect(home.querySelector("[data-tile-icon] svg")).not.toBeNull();
  });
});
