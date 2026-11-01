/**
 * Owner 2026-11-01 (checkout screenshot): "Deliver to" was a plain box; "314 Lynn Street" + Get price said "We couldn't
 * find that address". It is now the app's shared address search (AddressAutocomplete, as SellerAddressField uses it),
 * and a pick hands the WHOLE address on at once, so the price is asked for an address Apple already found. Driven through
 * the real AddressAutocomplete with a stand-in for Apple's search (sellerAddressField.test.tsx's pattern).
 * Wired into checkout: DeclutterTradeViews (Helpr delivery) and SellerDeliveryChoice (seller delivery).
 *
 * @mutate src/components/declutter/DropoffAddressField.tsx |     if (line.length >= 5) onPicked(line); |     void line;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |           <DropoffAddressField id={addressId} value={address} |           <input id={addressId} value={address}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ status: "ready" }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => h.status }));
vi.mock("@/lib/analytics", async (orig) => ({ ...(await orig<object>()), track: vi.fn() }));

import { DropoffAddressField, dropoffLine } from "./DropoffAddressField";

const LYNN = {
  displayLines: ["314 Lynn St", "New Iberia, LA"],
  place: { subThoroughfare: "314", thoroughfare: "Lynn St", locality: "New Iberia", administrativeAreaCode: "LA", postCode: "70560", coordinate: { latitude: 30.0, longitude: -91.8 } },
};
class FakeSearch {
  autocomplete(_q: string, cb: (e: Error | null, d: { results: unknown[] }) => void) { cb(null, { results: [LYNN] }); }
  search(r: { place: Record<string, unknown> }, cb: (e: Error | null, d: { places: Record<string, unknown>[] }) => void) { cb(null, { places: [r.place] }); }
}
beforeEach(() => {
  h.status = "ready";
  (window as unknown as { mapkit: unknown }).mapkit = { Search: FakeSearch, Coordinate: class {}, CoordinateRegion: class {}, CoordinateSpan: class {} };
});
afterEach(cleanup);

describe("Deliver to is the shared address search", () => {
  it("typing opens the list, and a pick hands on the whole address to price", async () => {
    const picked = vi.fn();
    let value = "";
    const { rerender } = render(<DropoffAddressField id="d1" value={value} onTyped={(v) => { value = v; }} onPicked={picked} />);
    fireEvent.change(screen.getByLabelText("Deliver to"), { target: { value: "314 Lynn" } });
    rerender(<DropoffAddressField id="d1" value={value} onTyped={(v) => { value = v; }} onPicked={picked} />);
    fireEvent.click(await screen.findByText("314 Lynn St"));
    await waitFor(() => expect(picked).toHaveBeenCalledWith("314 Lynn St, New Iberia, LA 70560"));
    expect(screen.getByRole("button", { name: /use my current location/i })).toBeTruthy();
  });

  it("the line: whole, a town never twice, Louisiana as LA", () => {
    expect(dropoffLine("314 Lynn St", "New Iberia", "Louisiana", "70560")).toBe("314 Lynn St, New Iberia, LA 70560");
    expect(dropoffLine("New Iberia", "New Iberia", "LA", "")).toBe("New Iberia, LA");
  });

  it("both checkout delivery boxes use it (source)", () => {
    for (const f of ["src/components/declutter/DeclutterTradeViews.tsx", "src/components/declutter/SellerDeliveryChoice.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("<DropoffAddressField");
      expect(src, f).not.toContain("Deliver to (street number, street and town)");
    }
  });
});
