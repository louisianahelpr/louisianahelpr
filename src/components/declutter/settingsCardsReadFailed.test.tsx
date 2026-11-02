/**
 * NIGHT-SET-Declutterse-1 (settings audit 10-30 #1): when the reads failed, Pickup times, I can deliver and Bundle
 * discount each returned nothing, so "Pickup, delivery and bundles" sat over an empty space. Each now says it could
 * not load, with Try again, as Pickup places and Listing defaults do; Try again reads again. (The Pickup times card
 * itself is gone, LEAD-PLACE-TIMES 2026-10-31: each pickup place has its own hours.)
 *
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |   if (mine.isError) return <ErrorState | if (mine.isError) return null; if (false) return <ErrorState
 * @mutate src/components/declutter/BundleDiscountCard.tsx |   if (rule.isError) return <ErrorState | if (rule.isError) return null; if (false) return <ErrorState
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = vi.hoisted(() => ({ delivery: 0, bundle: 0 }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchMySellerDelivery: async () => { calls.delivery++; throw new Error("network down"); },
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => { calls.bundle++; throw new Error("network down"); },
}));

import { SellerDeliveryCard } from "./SellerDeliverySettings";
import { BundleDiscountCard } from "./BundleDiscountCard";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SellerDeliveryCard /><BundleDiscountCard pick={undefined} onPick={() => {}} /></QueryClientProvider>);
}

describe("Declutterse-1: a settings card whose read failed says so", () => {
  it("each of the two shows its own error with Try again, and Try again reads again", async () => {
    show();
    for (const title of ["We couldn't load your delivery setting.", "We couldn't load your bundle discount."]) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    const retries = screen.getAllByRole("button", { name: /try again/i });
    expect(retries).toHaveLength(2);
    const before = { ...calls };
    retries.forEach((b) => fireEvent.click(b));
    await waitFor(() => {
      expect(calls.delivery).toBeGreaterThan(before.delivery);
      expect(calls.bundle).toBeGreaterThan(before.bundle);
    });
  });
});
