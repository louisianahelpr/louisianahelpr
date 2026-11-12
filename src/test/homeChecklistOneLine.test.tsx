/**
 * Design audit A D2 (owner approved 11-08, change 5 of 5): on Dashboard "Needs you" (the Next up card) comes first,
 * and each first-week checklist is ONE progress line under it: "<title> · n of m", a segmented bar, and "Next: <first
 * step not done>" that goes where that step is done. "How you get paid" is one row whose full words open on "Read
 * more" (the words themselves are unchanged; firstJobHomeTruth holds them to the shared constants).
 *
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |   const next = steps.find((s) => !s.done); |   const next = steps[0];
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |   const doneCount = steps.filter((s) => s.done).length; |   const doneCount = steps.length;
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |       <details aria-label={tr("home.fj.howPaid")} data-how-paid="" className="group px-1"> |       <details open aria-label={tr("home.fj.howPaid")} data-how-paid="" className="group px-1">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChecklistProgress } from "@/pages/home/homeDashboard/FirstJobHome";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(__dirname, "..", "..", p), "utf8"));

describe("Dashboard: Needs you first, the checklist as one line (design audit A D2)", () => {
  it("one line: the count, one bar segment per step, and Next goes to the first step not done", () => {
    const go = { a: vi.fn(), b: vi.fn(), c: vi.fn() };
    render(
      <ChecklistProgress
        title="Your first job posted"
        steps={[
          { key: "a", label: "Post your first job", done: true, go: go.a },
          { key: "b", label: "Hire a Helpr", done: false, go: go.b },
          { key: "c", label: "Approve the work", done: false, go: go.c },
        ]}
      />,
    );
    expect(screen.getByText("· 1 of 3")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.querySelectorAll("[data-step]")).toHaveLength(3);
    // One button only: the next step (the old list made every step a 44px row).
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Hire a Helpr");
    fireEvent.click(buttons[0]);
    expect(go.b).toHaveBeenCalledTimes(1);
    expect(go.a).not.toHaveBeenCalled();
  });

  it("Next up sits above both first-week cards in HomeDashboard", () => {
    const home = read("src/pages/home/HomeDashboard.tsx");
    const nextUp = home.indexOf('data-testid="next-up"');
    expect(nextUp).toBeGreaterThan(1000);
    expect(home.indexOf("<FirstJobHome ")).toBeGreaterThan(nextUp);
    expect(home.indexOf("<PosterFirstJobCard ")).toBeGreaterThan(nextUp);
    expect(home.indexOf("<FirstJobHome ")).toBeGreaterThan(home.lastIndexOf('title="Coming up"'));
  });

  it("How you get paid is one closed row with Read more", () => {
    const src = read("src/pages/home/homeDashboard/FirstJobHome.tsx");
    expect(src).toContain('<details aria-label={tr("home.fj.howPaid")} data-how-paid="" className="group px-1">');
    expect(src).toContain(">{tr(\"home.fj.readMore\")}</span>");
  });
});
