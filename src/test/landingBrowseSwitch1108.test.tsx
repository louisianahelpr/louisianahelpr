/**
 * Owner 11-08: a member could not find Declutter items on the landing (the "Fresh on Declutter" strip sat ~1.5 screens
 * down, under the jobs). Now a Jobs | Declutter switch sits right under the hero (LandingBrowseSwitch.tsx):
 *   - "Find help or work" (the default) shows the live jobs; "Shop Declutter" shows the Declutter grid IN PLACE of them;
 *   - the visitor's pick is remembered in localStorage (wrapped: storage that throws falls back to jobs, never a crash);
 *   - /#declutter opens on Declutter (a Facebook link), over a remembered "jobs".
 *
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |   if (hash === LANDING_DECLUTTER_HASH) return "declutter"; |   if (hash === "#shop") return "declutter";
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |     saveMode(next); |     void saveMode;
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |   return readSavedMode() ?? "jobs"; |   return readSavedMode() ?? "declutter";
 * @mutate src/components/landing/LandingBrowseSwitch.tsx |         {mode === "jobs" ? <LiveJobsSection /> : <FreshDeclutterSection />} |         <LiveJobsSection /><FreshDeclutterSection />
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/landing/LiveJobsSection", () => ({ LiveJobsSection: () => <div data-testid="jobs-panel" /> }));
vi.mock("@/components/landing/FreshDeclutterSection", () => ({ FreshDeclutterSection: () => <div data-testid="declutter-panel" /> }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));

import { LandingBrowseSwitch, LANDING_MODE_KEY } from "@/components/landing/LandingBrowseSwitch";

const open = (url = "/") => render(<MemoryRouter initialEntries={[url]}><LandingBrowseSwitch /></MemoryRouter>);
const tab = (name: string) => screen.getByRole("tab", { name });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the landing's Jobs | Declutter switch (owner 11-08)", () => {
  it("two buttons; jobs by default; Shop Declutter swaps the jobs for the Declutter grid and back", () => {
    open();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Find help or work", "Shop Declutter"]);
    expect(tab("Find help or work").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
    expect(screen.queryByTestId("declutter-panel")).toBeNull();
    fireEvent.click(tab("Shop Declutter"));
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
    expect(screen.queryByTestId("jobs-panel")).toBeNull(); // in place of the jobs, not under them
    expect(tab("Shop Declutter").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tab("Find help or work"));
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
    expect(screen.queryByTestId("declutter-panel")).toBeNull();
  });

  it("remembers the pick for the next visit", () => {
    open();
    fireEvent.click(tab("Shop Declutter"));
    expect(window.localStorage.getItem(LANDING_MODE_KEY)).toBe("declutter");
    cleanup();
    open();
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
    fireEvent.click(tab("Find help or work"));
    cleanup();
    open();
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
  });

  it("/#declutter opens on Declutter, even over a remembered jobs pick, and the switch is the scroll target", () => {
    window.localStorage.setItem(LANDING_MODE_KEY, "jobs");
    open("/#declutter");
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
    expect(screen.getByTestId("landing-browse-switch").id).toBe("declutter");
  });

  it("storage that throws (private window, blocked site data) falls back to jobs and the switch still works", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    open();
    expect(screen.getByTestId("jobs-panel")).toBeTruthy();
    fireEvent.click(tab("Shop Declutter"));
    expect(screen.getByTestId("declutter-panel")).toBeTruthy();
  });
});
