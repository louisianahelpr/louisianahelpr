/**
 * Owner 11-08: a member could not find Declutter items on the landing (the "Fresh on Declutter" strip sat ~1.5 screens
 * down, under the jobs). The section right under the hero (LandingBrowseSwitch.tsx) follows the Jobs | Declutter choice:
 *   - Jobs (the default) shows the live jobs; Declutter shows the Declutter grid IN PLACE of them;
 *   - the visitor's pick is remembered in localStorage (wrapped: storage that throws falls back to jobs, never a crash);
 *   - /#declutter opens on Declutter (a Facebook link), over a remembered "jobs".
 * F012 (owner's UI audit 11-09): the hero search has Jobs | Declutter tabs above the box (landingMode.ts): picking
 * Declutter turns the section too, the box says "Search Declutter" and its words go to /declutter?q=. The LOCKED hero
 * words do not change.
 * D001 (landing design audit 11-10, High): the section's own second switch ("Find help or work | Shop Declutter") is
 * gone; the hero's tabs are the landing's ONE Jobs | Declutter switch.
 *
 * @mutate src/components/landing/landingMode.ts |   if (current === null) current = window.location.hash === LANDING_DECLUTTER_HASH ? "declutter" : readSavedMode() ?? "jobs"; |   if (current === null) current = readSavedMode() ?? "jobs";
 * @mutate src/components/landing/landingMode.ts |   if (remember) saveMode(mode); |   void saveMode;
 * @mutate src/components/landing/landingMode.ts | : readSavedMode() ?? "jobs"; | : readSavedMode() ?? "declutter";
 * @mutate src/components/landing/landingMode.ts |   listeners.forEach((l) => l()); |
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |         {mode === "jobs" ? <LiveJobsSection /> : <FreshDeclutterSection />} |         <LiveJobsSection /><FreshDeclutterSection />
 * @mutate src/components/landing/HeroSection.tsx |                 onChange={(next) => setLandingMode(next)} |                 onChange={() => {}}
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |       {mode === "jobs" ? <LiveJobsSection /> : <FreshDeclutterSection />} |       <div role="tablist"><button role="tab">Find help or work</button></div>{mode === "jobs" ? <LiveJobsSection /> : <FreshDeclutterSection />}
 * @mutate src/components/landing/heroSearch.ts |   if (mode === "declutter") return { signedIn: `/declutter${qs}`, signedOut: `/declutter${qs}` }; |
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
import { LANDING_MODE_KEY, resetLandingModeForTests } from "@/components/landing/landingMode";
import { heroSearchTargets } from "@/components/landing/heroSearch";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const open = (url = "/") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<><HeroSection /><LandingBrowseSwitch /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
const heroTab = (name: string) => within(screen.getByTestId("landing-search-tabs")).getByRole("radio", { name });
const box = () => screen.getByRole("searchbox") as HTMLInputElement;

beforeEach(() => {
  window.localStorage.clear();
  resetLandingModeForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetLandingModeForTests();
});

describe("the landing's Jobs | Declutter switch (owner 11-08)", () => {
  it("D001: ONE switch on the landing, the hero's; the section under it has none", () => {
    open();
    const section = screen.getByTestId("landing-browse-switch");
    expect(within(section).queryAllByRole("tab")).toHaveLength(0);
    expect(within(section).queryAllByRole("radio")).toHaveLength(0);
    expect(within(section).queryAllByRole("tablist")).toHaveLength(0);
    // Inventory floor: the landing still has its one switch, with both choices.
    const choices = within(screen.getByTestId("landing-search-tabs")).getAllByRole("radio");
    expect(choices.length).toBeGreaterThan(1);
    expect(choices.map((t) => t.textContent)).toEqual(["Jobs", "Declutter"]);
  });

  it("jobs by default; the hero's Declutter swaps the jobs for the Declutter grid and back", () => {
    open();
    expect(heroTab("Jobs").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
    expect(screen.queryByTestId("declutter-panel")).toBeNull();
    fireEvent.click(heroTab("Declutter"));
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
    expect(screen.queryByTestId("jobs-panel")).toBeNull(); // in place of the jobs, not under them
    fireEvent.click(heroTab("Jobs"));
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
    expect(screen.queryByTestId("declutter-panel")).toBeNull();
  });

  it("remembers the pick for the next visit", () => {
    open();
    fireEvent.click(heroTab("Declutter"));
    expect(window.localStorage.getItem(LANDING_MODE_KEY)).toBe("declutter");
    cleanup();
    resetLandingModeForTests(); // a new page load
    open();
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
    fireEvent.click(heroTab("Jobs"));
    cleanup();
    resetLandingModeForTests();
    open();
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
  });

  it("/#declutter opens on Declutter, even over a remembered jobs pick, and the switch is the scroll target", () => {
    window.localStorage.setItem(LANDING_MODE_KEY, "jobs");
    window.history.replaceState(null, "", "/#declutter");
    try {
      open("/#declutter");
      expect(screen.getByTestId("declutter-panel")).toBeTruthy();
      expect(screen.getByTestId("landing-browse-switch").id).toBe("declutter");
      // The link does not overwrite the visitor's own remembered pick.
      expect(window.localStorage.getItem(LANDING_MODE_KEY)).toBe("jobs");
      // The hero alone reads the hash on its first render too (the switch's effect is not what turns it).
      cleanup();
      resetLandingModeForTests();
      render(<MemoryRouter initialEntries={["/"]}><HeroSection /></MemoryRouter>);
      expect(box().placeholder).toBe("Search Declutter");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("storage that throws (private window, blocked site data) falls back to jobs and the switch still works", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    open();
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
    fireEvent.click(heroTab("Declutter"));
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
  });
});

describe("the hero search's Jobs | Declutter tabs drive the section (F012, 11-09)", () => {
  it("the hero tabs turn the section and the box's words", () => {
    open();
    expect(heroTab("Jobs").getAttribute("aria-checked")).toBe("true");
    expect(box().placeholder).toBe("Search local jobs");
    fireEvent.click(heroTab("Declutter"));
    expect(heroTab("Declutter").getAttribute("aria-checked")).toBe("true");
    expect(box().placeholder).toBe("Search Declutter");
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
    fireEvent.click(heroTab("Jobs"));
    expect(heroTab("Jobs").getAttribute("aria-checked")).toBe("true");
    expect(box().placeholder).toBe("Search local jobs");
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
  });

  it("on the Declutter tab the words search Declutter; on Jobs, the jobs board", () => {
    open();
    fireEvent.click(heroTab("Declutter"));
    fireEvent.change(box(), { target: { value: "  oak  rocking chair " } });
    fireEvent.submit(screen.getByTestId("landing-search"));
    expect(screen.getByTestId("where").textContent).toBe("/declutter?q=oak+rocking+chair");
    cleanup();
    resetLandingModeForTests();
    window.localStorage.clear();
    open();
    fireEvent.change(box(), { target: { value: "mow" } });
    fireEvent.submit(screen.getByTestId("landing-search"));
    expect(screen.getByTestId("where").textContent).toBe("/browse?q=mow");
    expect(heroSearchTargets("mow", "declutter")).toEqual({ signedIn: "/declutter?q=mow", signedOut: "/declutter?q=mow" });
    expect(heroSearchTargets("", "declutter")).toEqual({ signedIn: "/declutter", signedOut: "/declutter" });
  });

  it("the LOCKED hero words stay exactly the same on either tab", () => {
    open();
    const words = () => [screen.getByRole("heading", { level: 1 }).textContent, screen.getByText(/^Hire help, find work, or buy and sell/).textContent];
    const before = words();
    expect(before).toEqual(["Louisiana’s local partner.", "Hire help, find work, or buy and sell. One account, real neighbors."]);
    fireEvent.click(heroTab("Declutter"));
    expect(words()).toEqual(before);
  });
});
