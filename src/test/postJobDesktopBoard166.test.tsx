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
  it("names the six screens from the one list (JA-41: the group grid is the first screen), marks the current one, and reopens only a passed form screen", () => {
    const onPick = vi.fn();
    render(<PostJobStepRail screen="price" onPick={onPick} canPick={(s) => s === "groups" || s === "details"} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/, done.*$/, ""))).toEqual(["What", "Kind of job", "Details", "4Price", "5When and where", "6Review"]);
    expect(screen.getByText("Price").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
    const back = screen.getAllByRole("button");
    expect(back).toHaveLength(2);
    fireEvent.click(back[1]);
    expect(onPick).toHaveBeenCalledWith("details");
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
    expect(home.textContent).toMatch(/^🏠HomeCleaning, handyman/u);
  });
});
