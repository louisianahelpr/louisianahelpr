/**
 * F262 (audit 11-10): the floating "+ Post a job" pill sat on card content mid-list (a Working card's progress bar
 * and "Manage job" row, Posted's "More options", Browse's town and time). Bottom room (F150) clears only the last
 * row. Now the pill folds to its round "+" while the member scrolls down a panel, and opens again on the way up or
 * back at the top; its name stays on aria-label, and it still goes to the same place.
 *
 * @mutate src/components/sections/SectionCreateFab.tsx |       else if (top - before > 4) setFolded(true); |       else if (top - before > 4) setFolded(false);
 * @mutate src/components/sections/SectionCreateFab.tsx |       {!folded && text} |       {text}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticLight: () => {} }));

import { SectionCreateFab } from "@/components/sections/SectionCreateFab";

afterEach(cleanup);

function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
    fireEvent.scroll(el);
  });
}

describe("the create pill folds while scrolling down (F262)", () => {
  it("opens at rest, folds on the way down, opens on the way up and at the top", () => {
    render(
      <MemoryRouter>
        <div data-testid="panel" style={{ overflow: "auto", height: 200 }}><div style={{ height: 2000 }} /></div>
        <SectionCreateFab section="jobs" text="Post a job" />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId("panel");
    const fab = () => screen.getByTestId("section-create-fab");
    expect(fab().textContent).toContain("Post a job");
    expect(fab().hasAttribute("data-folded")).toBe(false);

    scrollTo(panel, 300);
    expect(fab().hasAttribute("data-folded")).toBe(true);
    expect(fab().textContent).not.toContain("Post a job");
    // Still named for screen readers while folded.
    expect(fab().getAttribute("aria-label")).toBe("Post a job");

    scrollTo(panel, 200);
    expect(fab().hasAttribute("data-folded")).toBe(false);
    expect(fab().textContent).toContain("Post a job");

    scrollTo(panel, 600);
    expect(fab().hasAttribute("data-folded")).toBe(true);
    scrollTo(panel, 0);
    expect(fab().hasAttribute("data-folded")).toBe(false);
  });
});
