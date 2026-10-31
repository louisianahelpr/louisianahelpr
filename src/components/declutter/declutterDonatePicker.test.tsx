/**
 * The charity choice wears the shared choice cards (Declutter deep audit #53, 2026-10-28, shot
 * 141-seller-donate-chosen-p1-390): the bare native radios read as "•/◦" bullets beside the text.
 * RadioCardList (src/components/ui/RadioCardList.tsx) is the app's one "pick one" list: a full card per
 * charity with a radio circle, and the picked card ringed in olive.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ chosen: null as string | null, picks: [] as string[] }));

vi.mock("@/lib/declutter/donate", () => ({
  fetchDonationPartnersNear: async () => [
    { id: "p1", name: "St. Vincent de Paul", address: "220 St Vincent de Paul Pl", parish: "East Baton Rouge", takes: "Furniture, kitchen", miles: 2, chosen: state.chosen === "p1" },
    { id: "p2", name: "Habitat ReStore", address: "10566 Airline Hwy", parish: "East Baton Rouge", takes: null, miles: 1, chosen: state.chosen === "p2" },
  ],
  chooseDonation: async (_ids: string[], id: string) => {
    state.picks.push(id);
    state.chosen = id;
  },
  donatePostJobPath: (p: string) => p,
  fetchMyDonations: async () => [],
}));
vi.mock("@/lib/declutter/haulAwayLink", () => ({ haulAwayPostJobPath: () => "/post-job" }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { DonatePicker } from "./DeclutterDonate";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DonatePicker itemIds={["i1"]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("donate picker: one card per charity, not bare radios (deep audit #53)", () => {
  beforeEach(() => {
    state.chosen = null;
    state.picks = [];
  });

  // @mutate src/components/declutter/DeclutterDonate.tsx |       <RadioCardList\n        label="Charity" |       <RadioCardListGone\n        label="Charity"
  it("each charity is a shared choice card; tapping one picks it and shows Post a donation job", async () => {
    const { container } = show();
    const group = await screen.findByRole("radiogroup", { name: "Charity" });
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(2);
    // The shared card is a button with role="radio", never a bare native <input type="radio">.
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    for (const c of cards) expect(c.tagName).toBe("BUTTON");
    expect(group).toContainElement(screen.getByText("St. Vincent de Paul"));
    expect(screen.getByText(/220 St Vincent de Paul Pl · about 2 miles/)).toBeInTheDocument();
    expect(screen.getByText("Takes: Furniture, kitchen")).toBeInTheDocument();
    expect(screen.getByText(/about 1 mile$/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Post a donation job" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Habitat ReStore/ }));
    await waitFor(() => expect(state.picks).toEqual(["p2"]));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Habitat ReStore/ })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("radio", { name: /St. Vincent/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("link", { name: "Post a donation job" })).toBeInTheDocument();

    // Tapping the charity already picked sends nothing again.
    fireEvent.click(screen.getByRole("radio", { name: /Habitat ReStore/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.picks).toEqual(["p2"]);
  });
});
