/**
 * Friction 4 (lead GO 2026-10-21): Post a Job's address is ONE search box. A pick fills street, city,
 * state and ZIP; the four fields stay reachable ("Enter it yourself", MapKit not ready, a pick with no
 * city or ZIP). A pick outside Louisiana is refused, never stored.
 * @mutate src/components/postjob/AddressBlock.tsx |                 if (st && st !== "LA") return; |
 * @mutate src/components/postjob/AddressBlock.tsx |                 if (!pickedCity \|\| !pickedZip) setManual(true); |
 * @mutate src/components/postjob/AddressBlock.tsx |                 if (pickedState) setAddrState(normalizeStateCode(pickedState));\n                if (pickedZip) setZipCode(pickedZip);\n                // A pick | if (pickedZip) setZipCode(pickedZip);\n                // A pick
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

const mk = vi.hoisted(() => ({ status: "ready", pick: { street: "222 St Louis St", city: "Baton Rouge", state: "LA", zipCode: "70802" } }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => mk.status }));
vi.mock("@/components/postjob/AddressAutocomplete", () => ({
  AddressAutocomplete: (p: { ariaLabel?: string; onPick: (x: typeof mk.pick) => void }) => (
    <button type="button" onClick={() => p.onPick(mk.pick)}>{`pick in ${p.ariaLabel ?? "Street address"}`}</button>
  ),
}));
vi.mock("@/components/postjob/CurrentLocationPill", () => ({ CurrentLocationPill: () => null }));
vi.mock("@/components/postjob/AppleMapPreview", () => ({ AppleMapPreview: () => null }));
vi.mock("@/components/postjob/CityAutocomplete", () => ({ CityAutocomplete: (p: { value: string }) => <input aria-label="City" readOnly value={p.value} /> }));

import { AddressBlock } from "@/components/postjob/AddressBlock";

let state: Record<string, string> = {};
function Host() {
  const [s, setS] = useState(""); const [c, setC] = useState(""); const [st, setSt] = useState(""); const [z, setZ] = useState("");
  state = { s, c, st, z };
  return <AddressBlock streetAddress={s} setStreetAddress={setS} city={c} setCity={setC} addrState={st} setAddrState={setSt} zipCode={z} setZipCode={setZ} />;
}

describe("one address box (friction 4)", () => {
  beforeEach(() => { mk.status = "ready"; mk.pick = { street: "222 St Louis St", city: "Baton Rouge", state: "LA", zipCode: "70802" }; });

  it("a pick fills all four fields (state normalized to LA) and reads back as one line with Change", () => {
    mk.pick = { ...mk.pick, state: "Louisiana" };
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "pick in Address" }));
    expect(state).toEqual({ s: "222 St Louis St", c: "Baton Rouge", st: "LA", z: "70802" });
    expect(screen.getByTestId("address-summary").textContent).toContain("222 St Louis St, Baton Rouge, LA 70802");
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("a pick outside Louisiana is refused and said", () => {
    mk.pick = { street: "1 Main St", city: "Houston", state: "TX", zipCode: "77002" };
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "pick in Address" }));
    expect(state.s).toBe("");
    expect(screen.getByText("Helpr works in Louisiana only. Pick a Louisiana address.")).toBeInTheDocument();
  });

  it("a pick with no ZIP opens the fields to finish it; Enter it yourself opens them too", () => {
    mk.pick = { street: "5 Bayou Rd", city: "Lafayette", state: "LA", zipCode: "" };
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "pick in Address" }));
    expect(screen.getByRole("textbox", { name: "ZIP code" })).toBeInTheDocument();
  });

  it("the fields are the path when MapKit is not ready (the e2e ZIP 99999 path)", () => {
    mk.status = "missing-token";
    render(<Host />);
    expect(screen.getByRole("textbox", { name: "Street address" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ZIP code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter it yourself" })).toBeNull();
  });

  it("Enter it yourself shows the four fields", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Enter it yourself" }));
    expect(screen.getByRole("textbox", { name: "ZIP code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search for it instead" })).toBeInTheDocument();
  });
});
