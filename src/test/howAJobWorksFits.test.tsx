/**
 * LEAD-HOWJOB-GUARANTEE (owner, 2026-10-31): the home page's "How a job works"
 * shows no "Covered by the Helpr Guarantee" box ("it doesn't fit there"), on
 * either side of the toggle, and its pieces cannot push past the column: the
 * owner's 1440 capture had step 3 ("Pay when it's done") and the toggle's
 * "I need help" past the right edge.
 *
 * Layout is checked on the rendered classes jsdom can see: the steps grid is
 * one column then three `minmax(0, 1fr)` tracks (Tailwind grid-cols-3), each
 * card is `min-w-0` (a grid item's default min-width:auto lets long content
 * widen its track past the column), the column is `w-full max-w-6xl`, and the
 * heading row wraps, so the toggle drops under the heading instead of running
 * off the edge. A tester confirms the pixels at 1440 and 375.
 *
 * @mutate src/components/landing/HowItWorksSection.tsx |               className="landing-card h-full min-w-0 flex flex-col p-6 lg:p-7" |               className="landing-card h-full flex flex-col p-6 lg:p-7"
 * @mutate src/components/landing/HowItWorksSection.tsx |         <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"> |         <div className="flex items-center justify-between gap-x-6 gap-y-4">
 * @mutate src/components/landing/HowItWorksSection.tsx |         <div className="grid grid-cols-1 sm:grid-cols-3 items-stretch gap-3 sm:gap-4 lg:gap-5"> |         <div className="grid grid-cols-[repeat(3,1fr)] items-stretch gap-3 sm:gap-4 lg:gap-5">
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HowItWorksSection from "@/components/landing/HowItWorksSection";

afterEach(cleanup);

const renderSection = () =>
  render(
    <MemoryRouter>
      <HowItWorksSection />
    </MemoryRouter>,
  );

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("How a job works: no Guarantee box, nothing past the column (LEAD-HOWJOB-GUARANTEE)", () => {
  it("shows no Helpr Guarantee box on either side", () => {
    renderSection();
    expect(screen.getByText("Pay when it's done")).toBeTruthy();
    expect(screen.queryByText(/Covered by the Helpr Guarantee/)).toBeNull();
    expect(document.querySelector('[data-testid="guarantee-promise"]')).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "I want to work" }));
    expect(screen.getByText("Get paid when it's done")).toBeTruthy();
    expect(document.querySelector('[data-testid="guarantee-promise"]')).toBeNull();
  });

  it("keeps the three steps and the toggle inside the column", () => {
    renderSection();
    const card3 = screen.getByText("Pay when it's done").closest(".landing-card");
    const grid = card3?.parentElement ?? null;
    const cards = grid ? [...grid.children] : [];
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(classes(c)).toContain("min-w-0");
    expect(classes(grid)).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "sm:grid-cols-3"]));
    const column = grid?.parentElement ?? null;
    expect(classes(column)).toEqual(expect.arrayContaining(["w-full", "max-w-6xl", "mx-auto"]));
    const headRow = screen.getByRole("heading", { name: "How a job works" }).parentElement;
    expect(classes(headRow)).toContain("flex-wrap");
    expect(headRow?.contains(screen.getByRole("tab", { name: "I need help" }))).toBe(true);
  });
});
