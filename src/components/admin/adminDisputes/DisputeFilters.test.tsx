/**
 * AUD31-45 (audit 10-31, Admin > Disputes at 375): the Filters card filled the whole first phone screen (the first
 * dispute ~775px down), and "Filed by" sat beside its control while Age and Category sat above theirs.
 * On a phone the card is closed until Show; its title counts the filters that are on; each label sits above its group.
 *
 * @mutate src/components/admin/adminDisputes/DisputeFilters.tsx |   const open = !isMobile \|\| shown; |   const open = true;
 * @mutate src/components/admin/adminDisputes/DisputeFilters.tsx | title={active > 0 ? `Filters (${active} on)` : "Filters"} | title="Filters"
 * @mutate src/components/admin/adminDisputes/FilterChipGroup.tsx |   <div className="flex flex-col items-start gap-1.5"> |   <div className="flex items-center gap-1.5 flex-wrap">
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const phone = vi.hoisted(() => ({ on: true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone.on }));

const { DisputeFilters } = await import("./DisputeFilters");

const props = (over: Record<string, unknown> = {}) => ({
  ageFilter: "all", setAgeFilter: vi.fn(), ageCount: () => 1,
  partyFilter: "all", setPartyFilter: vi.fn(), partyCount: () => 1,
  categoryFilter: "all", setCategoryFilter: vi.fn(), categoryCount: () => 1,
  clearFilters: vi.fn(),
  ...over,
}) as Parameters<typeof DisputeFilters>[0];

describe("AUD31-45: the disputes filters don't fill a phone's first screen", () => {
  it("phone: closed until Show, then all three groups, each label above its control", () => {
    phone.on = true;
    render(<DisputeFilters {...props()} />);
    expect(screen.queryByRole("radiogroup", { name: "Age" }) ?? screen.queryByText("Age")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
    const labels = ["Age", "Filed by", "Category"].map((l) => screen.getByText(l));
    expect(labels).toHaveLength(3);
    for (const l of labels) expect(l.parentElement?.className).toMatch(/\bflex-col\b/);
  });

  it("phone: the closed card says how many filters are on, and Reset stays reachable", () => {
    phone.on = true;
    const clearFilters = vi.fn();
    render(<DisputeFilters {...props({ ageFilter: "1-7d", partyFilter: "poster", clearFilters })} />);
    expect(screen.getByText("Filters (2 on)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Filters" }));
    expect(clearFilters).toHaveBeenCalledTimes(1);
  });

  it("wider screens: open, with no Show toggle", () => {
    phone.on = false;
    render(<DisputeFilters {...props()} />);
    expect(screen.getByText("Filed by")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(Show|Hide)$/ })).toBeNull();
  });
});
