/**
 * Owner 11-08: a member could not find Declutter items on the landing. Owner 11-18: "can we remove this on the landing
 * and the search just be used for both?": the hero's Jobs | Declutter tabs (F012, 11-09) are gone, and the one box
 * searches jobs AND Declutter:
 *   - no tabs, radios or tablists anywhere in the hero or the sections under it;
 *   - the box says "Search jobs and Declutter", and its words open /search?q= (jobs and Declutter items together,
 *     open to guests) signed in or out; an empty box still opens the jobs;
 *   - under the hero the live jobs come first, then the Declutter grid (both, no picking);
 *   - /#declutter scrolls to the Declutter grid (id="declutter") and turns How it works to "Buy or sell".
 * The LOCKED hero words do not change.
 *
 * @mutate src/components/landing/heroSearch.ts |   return { signedIn: q ? `/search${qs}` : "/jobs", signedOut: q ? `/search${qs}` : "/browse" }; |   return { signedIn: q ? `/search${qs}` : "/jobs", signedOut: `/browse${qs}` };
 * @mutate src/components/landing/HeroSection.tsx |   const searchLabel = es ? es.searchLabel : "Search jobs and Declutter"; |   const searchLabel = es ? es.searchLabel : "Search local jobs";
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |       <LiveJobsSection />\n |
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |         <FreshDeclutterSection />\n |
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |       <div id="declutter" data-testid="landing-declutter" className="scroll-mt-20"> |       <div data-testid="landing-declutter" className="scroll-mt-20">
 * @mutate src/components/landing/landingMode.ts |   if (current === null) current = window.location.hash === LANDING_DECLUTTER_HASH ? "declutter" : "jobs"; |   if (current === null) current = "jobs";
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |     if (hash === LANDING_DECLUTTER_HASH) setLandingMode("declutter"); |     void setLandingMode;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/landing/LiveJobsSection", () => ({ LiveJobsSection: () => <div data-testid="jobs-panel" /> }));
vi.mock("@/components/landing/FreshDeclutterSection", () => ({ FreshDeclutterSection: () => <div data-testid="declutter-panel" /> }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
// Signed out: the hero search goes to the signed-out target.
vi.mock("@/components/landing/goSignedInOr", () => ({
  goSignedInOr: (navigate: (to: string) => void, _signedIn: string, signedOut: string) => navigate(signedOut),
}));

import { LandingBrowseSwitch } from "@/components/landing/LandingBrowseSwitch";
import HeroSection from "@/components/landing/HeroSection";
import { resetLandingModeForTests, useLandingMode } from "@/components/landing/landingMode";
import { heroSearchTargets } from "@/components/landing/heroSearch";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function Mode() {
  return <div data-testid="mode">{useLandingMode()}</div>;
}

const open = (url = "/") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<><HeroSection /><LandingBrowseSwitch /><Mode /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
const box = () => screen.getByRole("searchbox") as HTMLInputElement;

beforeEach(() => resetLandingModeForTests());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetLandingModeForTests();
});

describe("the landing's one search covers jobs and Declutter (owner 11-18)", () => {
  it("no Jobs | Declutter tabs: no tab, radio or tablist in the hero or under it", () => {
    const { container } = open();
    expect(screen.queryByTestId("landing-search-tabs")).toBeNull();
    for (const role of ["tab", "radio", "tablist", "radiogroup"]) expect(within(container).queryAllByRole(role), role).toHaveLength(0);
    // Inventory floor: the hero still has its one search box and button.
    expect(box()).toBeTruthy();
    expect(screen.getByTestId("landing-search-submit")).toBeTruthy();
  });

  it("the box says it searches both, and its words open /search (jobs and Declutter together), signed in or out", () => {
    open();
    expect(box().placeholder).toBe("Search jobs and Declutter");
    fireEvent.change(box(), { target: { value: "  oak  rocking chair " } });
    fireEvent.submit(screen.getByTestId("landing-search"));
    expect(screen.getByTestId("where").textContent).toBe("/search?q=oak+rocking+chair");
    expect(heroSearchTargets("mow")).toEqual({ signedIn: "/search?q=mow", signedOut: "/search?q=mow" });
    expect(heroSearchTargets("  ")).toEqual({ signedIn: "/jobs", signedOut: "/browse" });
  });

  it("under the hero: the live jobs, then the Declutter grid, both at once", () => {
    open();
    const section = screen.getByTestId("landing-browse-switch");
    const jobs = within(section).getByTestId("jobs-panel");
    const declutter = within(section).getByTestId("declutter-panel");
    expect(jobs.compareDocumentPosition(declutter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("mode").textContent).toBe("jobs");
  });

  it("/#declutter: the Declutter grid is the scroll target and How it works leans to Declutter", () => {
    window.history.replaceState(null, "", "/#declutter");
    try {
      open("/#declutter");
      expect(screen.getByTestId("landing-declutter").id).toBe("declutter");
      expect(within(screen.getByTestId("landing-declutter")).getByTestId("declutter-panel")).toBeTruthy();
      expect(screen.getByTestId("mode").textContent).toBe("declutter");
      // The page-load read alone (no switch effect) already opens on Declutter, so How it works never flips.
      cleanup();
      resetLandingModeForTests();
      render(<Mode />);
      expect(screen.getByTestId("mode").textContent).toBe("declutter");
    } finally {
      window.history.replaceState(null, "", "/");
    }
    cleanup();
    resetLandingModeForTests();
    // Followed while the landing is open (the hash arrives after the first read).
    open("/#declutter");
    expect(screen.getByTestId("mode").textContent).toBe("declutter");
  });

  it("the LOCKED hero words stay exactly the same", () => {
    open();
    expect([screen.getByRole("heading", { level: 1 }).textContent, screen.getByText(/^Hire help, find work, or buy and sell/).textContent])
      .toEqual(["Louisiana’s local partner.", "Hire help, find work, or buy and sell. One account, real neighbors."]);
  });
});
