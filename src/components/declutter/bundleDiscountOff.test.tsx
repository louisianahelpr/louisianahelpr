/**
 * NIGHT-SET-Declutterse-2 (audit 1030 night, set-full-375-24-bundle-off): with a bundle discount saved at 10%,
 * pressing Off left every choice unselected (Off checked only `chosen === null`, the press sets 0) while Save
 * would turn it off. Off is the one shown selected, and Save sends Off.
 *
 * @mutate src/components/declutter/BundleDiscountCard.tsx |   const offChosen = chosen === null \|\| chosen === 0; |   const offChosen = chosen === null;
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const saved: (number | null)[] = [];
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/declutter/bundle", () => ({
  BUNDLE_PERCENTS: [5, 10, 15],
  bundleLabel: (p: number) => `Buy 2+, get ${p}% off`,
  fetchBundleRule: async () => 10,
  setBundleDiscount: async (p: number | null) => {
    saved.push(p);
    return p;
  },
}));

import { BundleDiscountCard } from "./BundleDiscountCard";

describe("Bundle discount: Off shows as chosen once pressed", () => {
  it("saved at 10%, pressing Off selects Off (only), and Save turns it off", async () => {
    render(<QueryClientProvider client={new QueryClient()}><BundleDiscountCard /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Bundle discount/ }));
    expect(await screen.findByRole("radio", { name: "10%" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toEqual([null]));
  });
});
