/**
 * Owner 11-09 (10:45 PM, #7): "The home landing page doesn't really talk about Declutter much." Below the hero only,
 * Declutter gets equal weight with Jobs, calmly (owner 10:33 PM: not busy):
 *   - How it works has a third side, "Buy or sell", with Declutter's three steps and its own Sell / Shop actions;
 *   - the money band says Declutter's rule in one line (the seller is paid once the buyer says they got it);
 *   - the close names both sections' first steps as quiet links (Find work, Post a job, Shop Declutter, Sell something);
 *   - the sections line names what is open today instead of repeating "One account".
 * BUILT ON ITS OWN BRANCH (ready/landing-declutter-preview) for the owner's morning review; not landed until approved.
 *
 * @mutate src/components/landing/HowItWorksSection.tsx |   { value: "sell", label: "Buy or sell" }, |
 * @mutate src/components/landing/SectionsShowcase.tsx |               On Declutter, the same rule: the seller is paid once the buyer says they got it. |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

import HowItWorksSection, { SELL_SIGNED_OUT } from "@/components/landing/HowItWorksSection";
import { TrustAndJoin } from "@/components/landing/SectionsShowcase";

afterEach(() => cleanup());

describe("owner #7: the landing gives Declutter equal weight below the hero", () => {
  it("How it works has a Buy or sell side with Declutter's three steps and its actions", () => {
    render(<MemoryRouter><HowItWorksSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Buy or sell" }));
    for (const t of ["List it in a minute", "Neighbors buy or offer", "Hand it over, get paid"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByTestId("landing-sell").getAttribute("href")).toBe(SELL_SIGNED_OUT);
    expect(screen.getByTestId("landing-shop").getAttribute("href")).toBe("/declutter");
    expect(screen.queryByTestId("landing-post-job")).toBeNull();
  });

  it("the money band and the close name Declutter too", () => {
    render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
    expect(screen.getByTestId("landing-money-declutter").textContent).toMatch(/seller is paid once the buyer says they got it/);
    const starts = within(screen.getByTestId("landing-join-starts")).getAllByRole("link").map((a) => a.textContent);
    expect(starts).toEqual(["Find work", "Post a job", "Shop Declutter", "Sell something"]);
  });
});
