// @mutate src/components/dashboard/filterSheet/FilterSheetRows.tsx | disabled={!hasAvailability} | disabled={false}
// @mutate src/components/dashboard/filterSheet/FilterSheetRows.tsx | onCheckedChange={(v) => { hapticLight(); onChange(v); }} | onCheckedChange={() => { hapticLight(); }}
/*
 * The "Show only" rows extracted from FilterSheet.tsx (OPEN.md Q184), pinned
 * through the public builder that mounts them, so a broken extraction (a row
 * no longer wired, a switch that no longer reports) fails here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildJobFilterSections } from "@/components/dashboard/FilterSheet";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

type Args = Parameters<typeof buildJobFilterSections>[0];

function renderShowOnly(overrides: Partial<Args>) {
  const args = {
    selectedCategory: "all",
    setSelectedCategory: vi.fn(),
    sortBy: "newest",
    setSortBy: vi.fn(),
    expiresWithin: "any",
    setExpiresWithin: vi.fn(),
    boostedOnly: false,
    setBoostedOnly: vi.fn(),
    urgentOnly: false,
    setUrgentOnly: vi.fn(),
    ...overrides,
  } as unknown as Args;
  const sections = buildJobFilterSections(args);
  const showOnly = sections.find((s) => s.key === "show-only");
  expect(showOnly).toBeDefined();
  render(<MemoryRouter>{showOnly!.content}</MemoryRouter>);
  return args;
}

describe("FilterSheet 'Show only' rows", () => {
  it("a toggle row reports its new value and names itself with its visible label", () => {
    const args = renderShowOnly({});
    const boosted = screen.getByRole("switch", { name: /^Boosted Jobs/ });
    expect(boosted.getAttribute("aria-label")).toBe("Boosted Jobs — Show boosted jobs only");
    fireEvent.click(boosted);
    expect(args.setBoostedOnly).toHaveBeenCalledWith(true);
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(2);
  });

  it("signed out, the account-only rows are signup links, not switches", () => {
    renderShowOnly({ signupHref: "/signup?redirect=/browse" });
    const links = screen.getAllByRole("link");
    expect(links.length).toBe(3);
    for (const a of links) expect(a.getAttribute("href")).toBe("/signup?redirect=/browse");
    expect(screen.getByText("Saved Searches")).toBeTruthy();
  });

  it("the availability row is inert until hours exist, and live once they do", () => {
    renderShowOnly({ setMatchAvailability: vi.fn(), hasAvailability: false });
    const off = screen.getByRole("switch", { name: /^Jobs During My Hours/ });
    expect(off.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /set hours/ })).toBeTruthy();
  });

  it("with saved hours the availability row can be switched on", () => {
    const setMatchAvailability = vi.fn();
    renderShowOnly({ setMatchAvailability, hasAvailability: true });
    const on = screen.getByRole("switch", { name: /^Jobs During My Hours/ });
    expect(on.hasAttribute("disabled")).toBe(false);
    fireEvent.click(on);
    expect(setMatchAvailability).toHaveBeenCalledWith(true);
  });
});
