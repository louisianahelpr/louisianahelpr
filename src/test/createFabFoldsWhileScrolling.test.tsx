/**
 * F262 (audit 11-10): the floating "+ Post a job" pill sat on card content mid-list (a Working card's progress bar
 * and "Manage job" row, Posted's "More options", Browse's town and time). Bottom room (F150) clears only the last
 * row. Now the pill folds to its round "+" while the member scrolls down a panel, and opens again on the way up or
 * back at the top; its name stays on aria-label, and it still goes to the same place.
 *
 * @mutate src/components/sections/SectionCreateFab.tsx |       else if (top - before > 4) setFolded(true); |       else if (top - before > 4) setFolded(false);
 * @mutate src/components/sections/SectionCreateFab.tsx |       {!folded && text} |       {text}
 * @mutate src/components/sections/SectionCreateFab.tsx |   return { folded: folded \|\| atEnd, away: folded }; |   return { folded, away: folded };
 * @mutate src/components/sections/SectionCreateFab.tsx |   const folded = scroll.folded \|\| round; |   const folded = scroll.folded;
 *
 * Polish audit 11-27 #6: folding was not enough (the round "+" on Declutter sat on a card's save heart while the grid
 * scrolled). Scrolling DOWN now also hides it: faded, moved down, aria-hidden, untappable; up or the top brings it back.
 * @mutate src/components/sections/SectionCreateFab.tsx |   return { folded: folded \|\| atEnd, away: folded }; |   return { folded: folded \|\| atEnd, away: false };
 * @mutate src/components/sections/SectionCreateFab.tsx | ${away ? "pointer-events-none translate-y-4 opacity-0" : ""} | ${away ? "translate-y-4" : ""}
 * @mutate src/components/declutter/DeclutterHomeView.tsx | \|\| view === "buying" \|\| view === "selling"; | \|\| view === "buying";
 * @mutate src/components/sections/SectionCreateFab.tsx |   return el.clientHeight > 0 && scrollLeft(el) <= END_FOLD_PX; |   return false;
 *
 * Phone audit 11-25 #1: the open pill sat on the END of a list ("That's every open job…") whenever the list's end was
 * on screen. Within END_FOLD_PX of the scroll's end the pill is the round "+" too, whichever way the member scrolls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticLight: () => {} }));

import { END_FOLD_PX, SectionCreateFab, endNear } from "@/components/sections/SectionCreateFab";

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

describe("the create pill hides while scrolling down (polish audit 11-27 #6)", () => {
  it("is away (untappable, hidden) on the way down, back on the way up and at the top, round Declutter + too", () => {
    for (const round of [false, true]) {
      render(
        <MemoryRouter>
          <div data-testid="panel" style={{ overflow: "auto", height: 200 }}><div style={{ height: 2000 }} /></div>
          <SectionCreateFab section="declutter" text="Sell" round={round} />
        </MemoryRouter>,
      );
      const panel = screen.getByTestId("panel");
      const fab = () => screen.getByTestId("section-create-fab");
      expect(fab().hasAttribute("data-away"), String(round)).toBe(false);
      scrollTo(panel, 300);
      expect(fab().hasAttribute("data-away"), String(round)).toBe(true);
      expect(fab().className).toMatch(/(^|\s)pointer-events-none(\s|$)/);
      expect(fab().className).toMatch(/(^|\s)opacity-0(\s|$)/);
      expect(fab().getAttribute("aria-hidden")).toBe("true");
      expect(fab().getAttribute("tabindex")).toBe("-1");
      scrollTo(panel, 200);
      expect(fab().hasAttribute("data-away")).toBe(false);
      expect(fab().className).not.toMatch(/(^|\s)pointer-events-none(\s|$)/);
      scrollTo(panel, 600);
      scrollTo(panel, 0);
      expect(fab().hasAttribute("data-away")).toBe(false);
      cleanup();
    }
  });
});

function panelWithGeometry(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

describe("the create pill folds at the end of the list (phone audit 11-25 #1)", () => {
  it("endNear: within END_FOLD_PX of the end of a laid-out panel; never for an unlaid one", () => {
    expect(END_FOLD_PX).toBeGreaterThan(100);
    expect(endNear({ scrollHeight: 2000, scrollTop: 0, clientHeight: 800 })).toBe(false);
    expect(endNear({ scrollHeight: 2000, scrollTop: 1100, clientHeight: 800 })).toBe(true);
    expect(endNear({ scrollHeight: 900, scrollTop: 0, clientHeight: 800 })).toBe(true); // a short list: its end is on screen
    expect(endNear({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 })).toBe(false);
  });

  it("scrolling UP near the end keeps the round +; scrolling back up the list opens it again", () => {
    render(
      <MemoryRouter>
        <div data-testid="panel" style={{ overflow: "auto", height: 800 }}><div style={{ height: 2000 }} /></div>
        <SectionCreateFab section="jobs" text="Post a job" />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId("panel");
    panelWithGeometry(panel, 2000, 800);
    const fab = () => screen.getByTestId("section-create-fab");
    scrollTo(panel, 1200); // the very end, on the way down
    expect(fab().hasAttribute("data-folded")).toBe(true);
    scrollTo(panel, 1100); // up a little: the end card is still on screen, so the pill stays round
    expect(fab().hasAttribute("data-folded")).toBe(true);
    expect(fab().textContent).not.toContain("Post a job");
    scrollTo(panel, 500); // well up the list, on the way up: open again (F262)
    expect(fab().hasAttribute("data-folded")).toBe(false);
  });
});

describe("lead 11-25 (phone audit #1): Declutter Browse's pill is round from the start; none on Selling", () => {
  it("round: the + alone at rest, still named", () => {
    render(
      <MemoryRouter>
        <SectionCreateFab section="declutter" text="Sell" round />
      </MemoryRouter>,
    );
    const fab = screen.getByTestId("section-create-fab");
    expect(fab.hasAttribute("data-folded")).toBe(true);
    expect(fab.textContent).not.toContain("Sell");
    expect(fab.getAttribute("aria-label")).toBeTruthy();
  });

  it("Declutter's home view: no pill on Selling, round on Browse", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterHomeView.tsx", "utf8"));
    expect(src).toContain('const ownMainButton = view === "wanted" || view === "deliver" || view === "buying" || view === "selling";');
    expect(src).toContain('<SectionCreateFab section="declutter" text={t("decl.hv.sell")} round={view === "browse"} />');
  });
});
