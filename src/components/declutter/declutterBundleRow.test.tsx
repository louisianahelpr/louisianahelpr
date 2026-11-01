/**
 * Deep audit #36: "Buy 2+, get 10% off" was advertised on items whose lowest price equals the price, where the
 * discount can never apply. The row now asks declutter_bundle_applies (checkout's own bound) and shows the offer
 * only when one of the items can take it; before that read is deployed it shows as it did.
 *
 * @mutate src/components/declutter/DeclutterBundleRow.tsx | offer: offer && rule.data ? bundleLabel(rule.data) : null | offer: rule.data ? bundleLabel(rule.data) : null
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeclutterItem } from "@/lib/declutter/api";

const state = { applies: new Set<string>() as Set<string> | null };

vi.mock("@/lib/declutter/api", () => ({
  fetchSellerItems: async () => [
    { id: "a1", title: "Lamp", status: "live", seller_id: "s1" },
    { id: "a2", title: "Rug", status: "live", seller_id: "s1" },
  ],
  fetchSellerCard: async () => ({ name: "Dana Smith" }),
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => 10,
  fetchBundleApplies: async () => state.applies,
}));

import { DeclutterBundleRow } from "./DeclutterBundleRow";

const item = { id: "i1", seller_id: "s1", status: "live" } as unknown as DeclutterItem;

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeclutterBundleRow item={item} viewerId="u1" />
    </QueryClientProvider>,
  );
}

describe("deep audit #36: the bundle offer shows only where it can apply", () => {
  beforeEach(() => {
    state.applies = new Set();
  });

  it("no item above its lowest price: the row stays, the offer does not", async () => {
    show();
    await screen.findByText(/2 more from Dana\./);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-bundle-offer]")).toBeNull();
  });

  it("one item can take the discount: the offer shows", async () => {
    state.applies = new Set(["a2"]);
    show();
    expect(await screen.findByText(/Buy 2\+, get 10% off/)).toBeInTheDocument();
  });

  it("before the read is deployed (null): the offer shows as it did", async () => {
    state.applies = null;
    show();
    expect(await screen.findByText(/Buy 2\+, get 10% off/)).toBeInTheDocument();
  });
});
