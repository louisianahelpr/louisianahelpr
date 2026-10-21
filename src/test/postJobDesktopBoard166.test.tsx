// Board 166 (desktop Post a Job, step 1): the step rail, the group cards'
// "what's in it" line, and the open group's olive outline (not a fill).
// @mutate src/components/postjob/PostJobStepRail.tsx | {done && onPick ? ( | {false ? (
// @mutate src/components/postjob/JobCategoryGroups.tsx | i === 0 \|\| /^[A-Z]{2}/.test(it.label) | i === 0
// @mutate src/components/postjob/JobCategoryGroups.tsx | ${on ? "border-2 !border-primary" : "border border-border"} | ${on ? "btn-grad-primary" : "border border-border"}
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

describe("board 166: the step rail", () => {
  it("names the five screens, marks the current one, and reopens only a passed one", () => {
    const onPick = vi.fn();
    render(<PostJobStepRail step={3} onPick={onPick} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/, done.*$/, ""))).toEqual(["1What", "2Details", "3Price", "4When and where", "5Review"].map((t, i) => (i < 2 ? t.slice(1) : t)));
    expect(screen.getByText("Price").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
    const back = screen.getAllByRole("button");
    expect(back).toHaveLength(2);
    fireEvent.click(back[1]);
    expect(onPick).toHaveBeenCalledWith(2);
  });
});

describe("board 166: group cards", () => {
  it("say what is in a bigger group, keep acronyms, and outline (not fill) the open group", () => {
    render(<JobCategoryGroups category="pressure_washing" setCategory={() => {}} />);
    const trades = screen.getByRole("button", { name: /^Trades/ });
    expect(trades.textContent).toMatch(/HVAC/);
    const home = screen.getByRole("button", { name: /^Home/ });
    expect(home.getAttribute("aria-expanded")).toBe("true");
    expect(home.className).toContain("border-2");
    expect(home.className).not.toContain("btn-grad-primary");
    expect(home.textContent).toMatch(/^HomeCleaning, handyman/);
  });
});
