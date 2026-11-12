/**
 * "Ship it" in Manage listing (docs/specs/shipping-draft.md sections 6 and 8; owner decisions 8 and 11; Q2259): hidden
 * while the declutter_shipping switch is off for the viewer, the listing is not small, or it is electronics or
 * appliances; otherwise Off plus the four boxes as one-tap choices with "Under 4 oz ships cheapest". A box is sent
 * only after the seller ticks "nothing restricted", and the tick goes to the server with it. The data module is
 * stubbed; the backend proof is src/test/pglite/shippingListingShipIt.pglite.mjs.
 *
 * @mutate src/components/declutter/ShipItRow.tsx | const on = useFeature("declutter_shipping"); | const on = true;
 * @mutate src/components/declutter/ShipItRow.tsx | const allowed = small && !SHIP_PICKUP_ONLY_CATEGORIES.has(category); | const allowed = !SHIP_PICKUP_ONLY_CATEGORIES.has(category);
 * @mutate src/components/declutter/ShipItRow.tsx |     if (preset !== null && !confirmed) { |     if (false) {
 * @mutate src/components/declutter/ShipItRow.tsx |     mutationFn: (preset: ShipPreset \| null) => setShipOptions(itemId, preset, preset !== null), |     mutationFn: (preset: ShipPreset \| null) => setShipOptions(itemId, preset, false),
 * @mutate src/lib/declutter/shipOptions.ts | new Set(["electronics", "appliances"]) | new Set(["appliances"])
 * @mutate src/components/declutter/ShipItRow.tsx | label: t(`lp.sh.p.${p.key}` as MsgKey) | label: p.key
 * @mutate src/lib/i18n/esListingParts.ts |   "lp.sh.p.small_box": "Caja pequeña, hasta 1 lb",\n |
 *
 * F260q: the box words come from the dictionary by key (lp.sh.p.<key>), so a Spanish seller reads them in Spanish.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { on: true, opts: { preset: null as string | null }, sent: [] as unknown[] };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/lib/declutter/api", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/api")>();
  return {
    ...real,
    fetchShipOptions: async () => ({ ...state.opts }),
    setShipOptions: async (_id: string, preset: string | null, nothingRestricted: boolean) => {
      state.sent.push({ preset, nothingRestricted });
      state.opts = { preset };
      return { preset };
    },
  };
});

import { ShipItRow } from "./ShipItRow";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

function show(small = true, category = "kitchen") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ul><ShipItRow itemId="i1" small={small} category={category} rowClassName="row" /></ul></QueryClientProvider>,
  );
}

describe("Ship it in Manage listing", () => {
  beforeEach(() => {
    state.on = true;
    state.opts = { preset: null };
    state.sent = [];
  });

  it("is hidden while the switch is off, for a listing that is not small, and for electronics", async () => {
    state.on = false;
    const settle = () => new Promise((r) => setTimeout(r, 30));
    const a = show();
    await settle();
    expect(a.container.querySelector("[data-ship-it-row]")).toBeNull();
    a.unmount();
    state.on = true;
    const b = show(false);
    await settle();
    expect(b.container.querySelector("[data-ship-it-row]")).toBeNull();
    b.unmount();
    const c = show(true, "electronics");
    await settle();
    expect(c.container.querySelector("[data-ship-it-row]")).toBeNull();
    c.unmount();
    show(true, "kitchen");
    expect(await screen.findByRole("radiogroup", { name: "Ship it" })).toBeTruthy();
  });

  it("offers Off and the four boxes and says what ships cheapest", async () => {
    show();
    const group = await screen.findByRole("radiogroup", { name: "Ship it" });
    const radios = Array.from(group.querySelectorAll('[role="radio"]')).map((r) => r.textContent);
    expect(radios).toEqual(["Off", "Envelope, up to 8 oz", "Small box, up to 1 lb", "Medium box, up to 3 lb", "Large box, up to 10 lb"]);
    expect(radios.length).toBeGreaterThan(4);
    expect(screen.getByText(/Under 4 oz ships cheapest\./)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
  });

  it("F260q: a Spanish seller reads the boxes in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    try {
      show();
      const group = await screen.findByRole("radiogroup");
      const radios = Array.from(group.querySelectorAll('[role="radio"]')).map((r) => r.textContent);
      expect(radios.slice(1)).toEqual(["Sobre, hasta 8 oz", "Caja pequeña, hasta 1 lb", "Caja mediana, hasta 3 lb", "Caja grande, hasta 10 lb"]);
    } finally { __resetLangForTests(); }
  });

  it("sends nothing until the restricted-items tick; then sends the box with the tick; Off sends no tick", async () => {
    show();
    fireEvent.click(await screen.findByRole("radio", { name: "Small box, up to 1 lb" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.sent).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: /USPS restricted list/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Small box, up to 1 lb" }));
    await waitFor(() => expect(state.sent).toEqual([{ preset: "small_box", nothingRestricted: true }]));
    fireEvent.click(await screen.findByRole("radio", { name: "Off" }));
    await waitFor(() => expect(state.sent[state.sent.length - 1]).toEqual({ preset: null, nothingRestricted: false }));
  });
});
