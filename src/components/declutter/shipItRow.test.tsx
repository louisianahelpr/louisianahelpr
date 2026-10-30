/**
 * "Ship it" in Manage listing (docs/specs/shipping-draft.md section 6; owner decisions 8, 9, 11; Q2259): hidden
 * while the declutter_shipping switch is off for the viewer or the listing is not small; otherwise Off plus the four
 * boxes as one-tap choices with "Under 4 oz ships cheapest", and "I'll pay shipping" only once a box is picked.
 * Each choice is sent to the server as is. The data module is stubbed; the backend proof is
 * src/test/pglite/shippingS3ListingOptions.pglite.mjs.
 *
 * @mutate src/components/declutter/ShipItRow.tsx |   if (!on \|\| !small \|\| state.data === "not_deployed") return null; |   if (state.data === "not_deployed") return null;
 * @mutate src/components/declutter/ShipItRow.tsx |       {cur.preset !== null && ( |       {true && (
 * @mutate src/components/declutter/ShipItRow.tsx | save.mutate({ preset, seller_pays: preset === null ? false : cur.seller_pays }); | save.mutate({ preset, seller_pays: cur.seller_pays });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { on: true, opts: { preset: null as string | null, seller_pays: false }, sent: [] as unknown[] };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/lib/declutter/api", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/api")>();
  return {
    ...real,
    fetchShipOptions: async () => ({ ...state.opts }),
    setShipOptions: async (_id: string, next: { preset: string | null; seller_pays: boolean }) => {
      state.sent.push(next);
      state.opts = { ...next };
      return next;
    },
  };
});

import { ShipItRow } from "./ShipItRow";

function show(small = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ul><ShipItRow itemId="i1" small={small} rowClassName="row" /></ul></QueryClientProvider>,
  );
}

describe("Ship it in Manage listing", () => {
  beforeEach(() => {
    state.on = true;
    state.opts = { preset: null, seller_pays: false };
    state.sent = [];
  });

  it("is hidden while the switch is off, and for a listing that is not small", () => {
    state.on = false;
    const a = show();
    expect(a.container.querySelector("[data-ship-it-row]")).toBeNull();
    a.unmount();
    state.on = true;
    const b = show(false);
    expect(b.container.querySelector("[data-ship-it-row]")).toBeNull();
  });

  it("offers Off and the four boxes, says what ships cheapest, and hides I'll pay shipping until a box is picked", async () => {
    show();
    const group = await screen.findByRole("radiogroup", { name: "Ship it" });
    const radios = Array.from(group.querySelectorAll('[role="radio"]')).map((r) => r.textContent);
    expect(radios).toEqual(["Off", "Envelope, up to 8 oz", "Small box, up to 1 lb", "Medium box, up to 3 lb", "Large box, up to 10 lb"]);
    expect(screen.getByText(/Under 4 oz ships cheapest\./)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("I'll pay shipping")).toBeNull();
  });

  it("a tap sends that box; I'll pay shipping appears and is sent with it; Off clears both", async () => {
    show();
    fireEvent.click(await screen.findByRole("radio", { name: "Small box, up to 1 lb" }));
    await waitFor(() => expect(state.sent).toEqual([{ preset: "small_box", seller_pays: false }]));
    const pays = await screen.findByRole("switch", { name: "I'll pay shipping" });
    fireEvent.click(pays);
    await waitFor(() => expect(state.sent.at(-1)).toEqual({ preset: "small_box", seller_pays: true }));
    fireEvent.click(await screen.findByRole("radio", { name: "Envelope, up to 8 oz" }));
    await waitFor(() => expect(state.sent.at(-1)).toEqual({ preset: "envelope", seller_pays: true }));
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    await waitFor(() => expect(state.sent.at(-1)).toEqual({ preset: null, seller_pays: false }));
    expect(state.sent.length).toBeGreaterThan(3);
  });
});
