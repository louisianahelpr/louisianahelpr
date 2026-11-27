/**
 * Owner 11-09 (10:45 PM, #7): "The home landing page doesn't really talk about Declutter much." Below the hero only,
 * Declutter gets equal weight with Jobs, calmly (owner 10:33 PM: not busy):
 *   - How it works has a third side, "Buy or sell", with Declutter's three steps and its own Sell action;
 *   - the close names both sections' first steps as quiet links (Browse jobs, Post a job, Shop Declutter, Sell something);
 *   - the sections line names what is open today instead of repeating "One account".
 * Owner 11-10: "SHIP IT" with three tweaks (~/.lh-shots/landing-design-1110/FINDINGS.md):
 *   1. How it works opens on "Buy or sell" in Declutter mode (the hero's Jobs | Declutter choice, landingMode.ts);
 *   2. the Declutter money rule is folded into the band's headline, not a ninth claim (D009: one headline, three steps
 *      in one row; the trust badges went 2026-11-17);
 *   3. "Shops and Homes are on the way" stays, as one line, and the Coming soon cards shrink away (D005,
 *      landingOpeningSoonCopy.test.tsx).
 * D008 (11-10): How it works wore the hero's quiet selected style; owner 11-20 (site polish B1) made it solid olive.
 * D012 / D020 (11-10): each side has ONE action. Owner 11-20 (site polish B1-B3): the selected side is solid olive, the
 * action is a real button under the cards (Post a job / Find work / Start selling), and each step card has an icon.
 *
 * @mutate src/components/landing/HowItWorksSection.tsx |   { value: "sell", label: "Buy or sell" }, |
 * @mutate src/components/landing/HowItWorksSection.tsx |   return mode === "declutter" ? "sell" : "hire"; |   return "hire";
 * @mutate src/components/landing/HowItWorksSection.tsx |   useEffect(() => setSide(sideForMode(mode)), [mode]); |
 * @mutate src/components/landing/HowItWorksSection.tsx |               tone="solid"\n |               tone="quiet"\n
 * @mutate src/components/landing/HowItWorksSection.tsx |                   <Icon key={side} className="h-5 w-5" /> | {null}
 * @mutate src/components/landing/HowItWorksSection.tsx |         {/* Polish audit 11-27 #16 (owner: remove the repeats): no "Post a job" / "Find work" | <div data-how-action="" />{/* x
 * @mutate src/components/landing/SectionsShowcase.tsx | const MONEY_HEADLINE = "Nobody gets paid until it’s really done, or really handed over."; | const MONEY_HEADLINE = "Nobody gets paid until the job is really done.";
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: new Set(["declutter"]), settled: true, failed: false }) };
});
vi.mock("@/lib/routePrefetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/routePrefetch")>();
  return { ...real, whenPageSettled: () => () => {} };
});
vi.mock("@/lib/socialAuth", () => ({ SOCIAL_SIGN_IN_ENABLED: false, signInWithProvider: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import HowItWorksSection from "@/components/landing/HowItWorksSection";
import { TrustAndJoin } from "@/components/landing/SectionsShowcase";
import { resetLandingModeForTests, setLandingMode } from "@/components/landing/landingMode";

beforeEach(() => {
  window.localStorage.clear();
  resetLandingModeForTests();
});
afterEach(() => {
  cleanup();
  resetLandingModeForTests();
});

const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!;

describe("owner #7: the landing gives Declutter equal weight below the hero", () => {
  it("How it works has a Buy or sell side with Declutter's three steps", () => {
    render(<MemoryRouter><HowItWorksSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Buy or sell" }));
    for (const t of ["List it in a minute", "Neighbors buy or offer", "Hand it over, get paid"]) expect(screen.getByText(t)).toBeTruthy();
  });

  // Polish audit 11-27 #16 (owner: remove the repeats): no "Post a job" / "Find work" / "Start selling" under the steps.
  // @mutate src/components/landing/HowItWorksSection.tsx |         {/* Polish audit 11-27 #16 (owner: remove the repeats): no "Post a job" | <a href="/post-job">Post a job</a>{/* x
  it("no side carries an action link under its steps (the page has each one already)", () => {
    const { container } = render(<MemoryRouter><HowItWorksSection /></MemoryRouter>);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(2);
    for (const t of tabs) {
      fireEvent.click(t);
      expect(container.querySelectorAll("a").length, t.textContent!).toBe(0);
      expect(container.querySelector("[data-how-action]"), t.textContent!).toBeNull();
    }
  });

  it("tweak 1: in Declutter mode How it works opens on Buy or sell, and follows the hero's choice", () => {
    setLandingMode("declutter");
    render(<MemoryRouter><HowItWorksSection /></MemoryRouter>);
    expect(selected().textContent).toBe("Buy or sell");
    act(() => setLandingMode("jobs"));
    expect(selected().textContent).toBe("I need help");
    act(() => setLandingMode("declutter"));
    expect(selected().textContent).toBe("Buy or sell");
  });

  it("B1 (owner 11-20, replaces D008): the selected side is filled solid olive with white words; each step card has its icon", () => {
    render(<MemoryRouter><HowItWorksSection /></MemoryRouter>);
    expect(selected().className).toContain("btn-grad-primary");
    expect(selected().className).not.toContain("segmented-option-quiet-selected");
    // B3: a small accent icon on every step card, on every side.
    for (const t of screen.getAllByRole("tab")) {
      fireEvent.click(t);
      const steps = [...document.querySelectorAll("[data-how-step]")];
      expect(steps.length, t.textContent!).toBe(3);
      for (const s of steps) expect(s.querySelector("[data-how-step-icon] svg"), t.textContent!).not.toBeNull();
      // Phone audit 11-25 #3 (owner 11-17: no icon-in-circle rows): the icon has no circle or tint behind it.
      for (const s of steps) expect(s.querySelector("[data-how-step-icon]")!.className).not.toMatch(/rounded-full|\bbg-/);
    }
  });

  it("tweak 2 / D009: one band headline covers jobs and Declutter; three steps in a row; no badges (owner 2026-11-17)", () => {
    render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
    const band = screen.getByTestId("landing-money-band");
    expect(within(band).getByRole("heading", { level: 2 }).textContent).toBe("Nobody gets paid until it’s really done, or really handed over.");
    expect(screen.queryByTestId("landing-money-declutter")).toBeNull(); // folded in, not a ninth claim
    const steps = within(screen.getByTestId("landing-money-steps")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(screen.getByTestId("landing-money-steps").className).toMatch(/\bsm:grid-cols-3\b/);
    // Owner 2026-11-17: no row of trust badges, and no icon circle above each step (title and text stay).
    expect(screen.queryByTestId("landing-trust-badges")).toBeNull();
    for (const st of steps) {
      expect(st.querySelector("svg"), st.textContent!).toBeNull();
      expect(st.querySelector("h3")?.textContent, st.textContent!).toBeTruthy();
    }
    // D015: no tracked-out eyebrow over the headline.
    expect(band.textContent).not.toMatch(/Your money, protected/i);
  });

  // Polish audit 11-27 #16 (owner: remove the repeats): the close is one "Create your free account" + Apple, no line of
  // "Post a job · Sell something" under them.
  // @mutate src/components/landing/SectionsShowcase.tsx |           {/* Polish audit 11-27 #16 (owner: remove the repeats): the close is one | <nav data-testid="landing-join-starts"><a href="/post-job">Post a job</a></nav>{/* x
  it("the close is one account button (and Apple), with no start links under it", () => {
    render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
    expect(screen.queryByTestId("landing-join-starts")).toBeNull();
    expect(screen.getByTestId("landing-signup").textContent).toBe("Create your free account");
    expect(screen.queryByRole("link", { name: /Post a job|Sell something/ })).toBeNull();
  });
});
