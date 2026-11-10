/**
 * Owner 11-08: a member could not find Declutter items on the landing (the "Fresh on Declutter" strip sat ~1.5 screens
 * down, under the jobs). Since Direction A (owner 11-10) "Near you this week" (NearYouSection.tsx) shows jobs AND items,
 * and follows the Jobs | Declutter choice:
 *   - Jobs (the default) puts the jobs first; Declutter puts the Declutter items first;
 *   - the visitor's pick is remembered in localStorage (wrapped: storage that throws falls back to jobs, never a crash);
 *   - /#declutter opens on Declutter (a Facebook link), over a remembered "jobs".
 * F012 (owner's UI audit 11-09): the hero search has Jobs | Declutter tabs above the box (landingMode.ts): picking
 * Declutter turns the section too, the box says "Search Declutter" and its words go to /declutter?q=. The LOCKED hero
 * words do not change.
 * D001 (landing design audit 11-10, High): the section's own second switch ("Find help or work | Shop Declutter") is
 * gone; the hero's tabs are the landing's ONE Jobs | Declutter switch, and Near you has none.
 *
 * @mutate src/components/landing/landingMode.ts |   if (current === null) current = window.location.hash === LANDING_DECLUTTER_HASH ? "declutter" : readSavedMode() ?? "jobs"; |   if (current === null) current = readSavedMode() ?? "jobs";
 * @mutate src/components/landing/landingMode.ts |   if (remember) saveMode(mode); |   void saveMode;
 * @mutate src/components/landing/landingMode.ts | : readSavedMode() ?? "jobs"; | : readSavedMode() ?? "declutter";
 * @mutate src/components/landing/landingMode.ts |   listeners.forEach((l) => l()); |
 * @mutate src/components/landing/NearYouSection.tsx |       data-mode={mode} |       data-mode="jobs"
 * @mutate src/components/landing/NearYouSection.tsx |     if (hash === LANDING_DECLUTTER_HASH) setLandingMode("declutter", false); |
 * @mutate src/components/landing/HeroSection.tsx |                 onChange={(next) => setLandingMode(next)} |                 onChange={() => {}}
 * @mutate src/components/landing/NearYouSection.tsx |           <div className="flex flex-wrap items-center gap-x-5" data-testid="landing-near-you-links"> |           <div role="tablist"><button role="tab">Find help or work</button></div><div className="flex flex-wrap items-center gap-x-5" data-testid="landing-near-you-links">
 * @mutate src/components/landing/heroSearch.ts |   if (mode === "declutter") return { signedIn: `/declutter${qs}`, signedOut: `/declutter${qs}` }; |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

// One job and one item, always loaded, so the order shows which kind leads (the "panel" the mode picks).
vi.mock("@/components/landing/LiveJobsSection", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/LiveJobsSection")>();
  const jobs = [{ id: "j1", title: "Job 1", budget: 50, date_needed: null, parish: "Iberia", category: "yard_work", pricing_mode: "fixed", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null }];
  return { ...real, useLiveJobs: () => ({ kind: "ok", jobs }) };
});
vi.mock("@/components/landing/FreshDeclutterSection", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/FreshDeclutterSection")>();
  const items = [{ id: "i1", title: "Lamp", category: "kitchen", condition_stars: 4, porch_ok: false, price_cents: 1500, current_price_cents: 1500, area_label: "New Iberia", photo: null, photoFull: null }];
  return { ...real, useFreshItems: () => ({ kind: "ok", items }) };
});
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: null, settled: false, failed: false }) };
});
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
// Signed out: the hero search goes to the signed-out target.
vi.mock("@/components/landing/goSignedInOr", () => ({
  goSignedInOr: (navigate: (to: string) => void, _signedIn: string, signedOut: string) => navigate(signedOut),
}));

import { NearYouSection } from "@/components/landing/NearYouSection";
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
        <Route path="/" element={<><HeroSection /><NearYouSection /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
/**
 * Which kind leads Near you: the mode the section draws with (its cards are a lazy chunk; that the mode really orders
 * them is src/test/landingDirectionA1110.test.tsx).
 */
const lead = () => (screen.getByTestId("landing-near-you").dataset.mode === "declutter" ? "item" : "job");
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
    const section = screen.getByTestId("landing-near-you");
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
    expect(lead()).toBe("job");
        fireEvent.click(heroTab("Declutter"));
    expect(lead()).toBe("item");
        fireEvent.click(heroTab("Jobs"));
    expect(lead()).toBe("job");
      });

  it("remembers the pick for the next visit", () => {
    open();
    fireEvent.click(heroTab("Declutter"));
    expect(window.localStorage.getItem(LANDING_MODE_KEY)).toBe("declutter");
    cleanup();
    resetLandingModeForTests(); // a new page load
    open();
    expect(lead()).toBe("item");
    fireEvent.click(heroTab("Jobs"));
    cleanup();
    resetLandingModeForTests();
    open();
    expect(lead()).toBe("job");
  });

  it("a /#declutter link followed while the landing is already open switches to Declutter too", () => {
    function Go() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/#declutter")}>go</button>;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<><Go /><HeroSection /><NearYouSection /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(lead()).toBe("job");
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(lead()).toBe("item");
    // A followed link does not overwrite the visitor's own remembered pick.
    expect(window.localStorage.getItem(LANDING_MODE_KEY)).toBeNull();
  });

  it("/#declutter opens on Declutter, even over a remembered jobs pick, and the switch is the scroll target", () => {
    window.localStorage.setItem(LANDING_MODE_KEY, "jobs");
    window.history.replaceState(null, "", "/#declutter");
    try {
      open("/#declutter");
      expect(lead()).toBe("item");
      expect(screen.getByTestId("landing-near-you").id).toBe("declutter");
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
    expect(lead()).toBe("job");
    fireEvent.click(heroTab("Declutter"));
    expect(lead()).toBe("item");
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
    expect(lead()).toBe("item");
    fireEvent.click(heroTab("Jobs"));
    expect(heroTab("Jobs").getAttribute("aria-checked")).toBe("true");
    expect(box().placeholder).toBe("Search local jobs");
    expect(lead()).toBe("job");
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
