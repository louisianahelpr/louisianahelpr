/**
 * Only a house-level point or the member's own position at the address is ever handed back: a street or town point
 * would fail the 200 m handover checks after the sale (lead 2026-10-30). Made-up places only.
 *
 * @mutate src/components/declutter/useExactAddressPoint.ts |       if (metresBetween(here, inexact.near) > SHARED_LOCATION_MAX_METRES) { |       if (false) {
 * @mutate src/components/declutter/useExactAddressPoint.ts |       throw new Error("address_not_exact"); |       return { lat: found.lat, lng: found.lng, address };
 * @mutate src/components/declutter/useExactAddressPoint.ts |     throw new Error(found.status === "unavailable" ? "address_lookup_unavailable" : notFoundCode); |     throw new Error(notFoundCode);
 * @mutate src/components/declutter/useSellFlowState.ts |       const c = await place.locate(form.pickupAddress); |       const c = { lat: 0, lng: 0 };
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       const c = await place.locate(pickupAddress);\n      // Only a change is saved |       const c = { lat: 0, lng: 0 };\n      // Only a change is saved
 * @mutate src/components/declutter/DeclutterRefundReturn.tsx |       const g = await place.locate(address, { allowApproximate: true }); |       const g = await place.locate(address);
 * @mutate src/components/declutter/useExactAddressPoint.ts |     if (found.status === "approximate" && opts?.allowApproximate) return { lat: found.lat, lng: found.lng, address, approximate: true }; |     if (found.status === "approximate") return { lat: found.lat, lng: found.lng, address, approximate: true };
 */
import { readFileSync } from "node:fs";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({ fn: vi.fn() }));
const position = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: lookup.fn }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: position.fn }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { RefundRequestView } from "@/lib/declutter/refundRequests";
import { DeclutterReturnBuyer } from "./DeclutterRefundReturn";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { declutterErrorMessage } from "@/lib/declutter/errors";

const TYPED = "101 Sample Bayou Rd, Exampleville, LA 70000";
const AREA = { status: "approximate", lat: 30.5, lng: -92.1, precision: "town" };

describe("useExactAddressPoint", () => {
  beforeEach(() => { lookup.fn.mockReset(); position.fn.mockReset(); });

  it("a house-level match is the point, and is not looked up twice", async () => {
    lookup.fn.mockResolvedValue({ status: "exact", lat: 30.4, lng: -92 });
    const { result } = renderHook(() => useExactAddressPoint());
    await act(async () => { expect(await result.current.locate(TYPED)).toEqual({ lat: 30.4, lng: -92, address: TYPED }); });
    await act(async () => { await result.current.locate(`  ${TYPED} `); });
    expect(lookup.fn).toHaveBeenCalledTimes(1);
  });

  it("an area match never comes back as a point: it refuses and opens the note", async () => {
    lookup.fn.mockResolvedValue(AREA);
    const { result } = renderHook(() => useExactAddressPoint());
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow("address_not_exact"); });
    expect(result.current.point).toBeNull();
    expect(result.current.inexact?.near).toEqual({ lat: 30.5, lng: -92.1 });
  });

  it("'couldn't look up just now' and 'couldn't find it' are different errors with different words", async () => {
    const { result } = renderHook(() => useExactAddressPoint());
    lookup.fn.mockResolvedValue({ status: "unavailable" });
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow("address_lookup_unavailable"); });
    lookup.fn.mockResolvedValue({ status: "not_found" });
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow("invalid_location"); });
    const down = declutterErrorMessage(new Error("address_lookup_unavailable"));
    expect(down).toMatch(/just now/);
    expect(down).not.toMatch(/couldn't find/i);
    expect(declutterErrorMessage(new Error("invalid_location"))).toMatch(/couldn't find/i);
  });

  it("the return form's own not-found word is kept", async () => {
    lookup.fn.mockResolvedValue({ status: "not_found" });
    const { result } = renderHook(() => useExactAddressPoint("address_not_found"));
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow("address_not_found"); });
  });

  it("a location near the area becomes the point, and the next save uses it without a lookup", async () => {
    lookup.fn.mockResolvedValue(AREA);
    position.fn.mockResolvedValue({ lat: 30.52, lng: -92.12 });
    const { result } = renderHook(() => useExactAddressPoint());
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow(); });
    await act(async () => { await result.current.shareMyLocation(); });
    expect(result.current.inexact).toBeNull();
    lookup.fn.mockClear();
    await act(async () => { expect(await result.current.locate(TYPED)).toEqual({ lat: 30.52, lng: -92.12, address: TYPED }); });
    expect(lookup.fn).not.toHaveBeenCalled();
  });

  it("a location far from the area is refused and saves nothing", async () => {
    lookup.fn.mockResolvedValue(AREA);
    position.fn.mockResolvedValue({ lat: 32.5, lng: -93.7 });
    const { result } = renderHook(() => useExactAddressPoint());
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow(); });
    await act(async () => { await expect(result.current.shareMyLocation()).rejects.toThrow("location_far_from_address"); });
    expect(result.current.point).toBeNull();
    expect(result.current.inexact).not.toBeNull();
  });

  it("location turned off says so and saves nothing", async () => {
    lookup.fn.mockResolvedValue(AREA);
    position.fn.mockRejectedValue(new Error("location_required"));
    const { result } = renderHook(() => useExactAddressPoint());
    await act(async () => { await expect(result.current.locate(TYPED)).rejects.toThrow(); });
    await act(async () => { await expect(result.current.shareMyLocation()).rejects.toThrow("location_required"); });
    expect(result.current.point).toBeNull();
  });
});

describe("AddressNeedsExactSpot", () => {
  it("says it plainly, offers the location, and goes away once the address is edited", async () => {
    const share = vi.fn(async () => undefined);
    const inexact = { address: TYPED };
    const { rerender } = render(<AddressNeedsExactSpot typedAddress={TYPED} inexact={inexact} locating={false} shareMyLocation={share} />);
    expect(screen.getByText(/not your house on the map/)).toBeInTheDocument();
    expect(screen.getByText(/come back to this when you're home/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I'm at this address, use my location" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    rerender(<AddressNeedsExactSpot typedAddress="102 Sample Bayou Rd" inexact={inexact} locating={false} shareMyLocation={share} />);
    expect(screen.queryByRole("button", { name: /use my location/ })).toBeNull();
  });
});

const toasted = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasted }));
const refund = vi.hoisted(() => ({ setReturnAddress: vi.fn(async () => undefined) }));
vi.mock("@/lib/declutter/refundReturns", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/refundReturns")>()), setReturnAddress: refund.setReturnAddress }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" } }) }));

describe("the return address form", () => {
  it("a refund never waits on the house: it saves the typed address with the area's point, and says the map may be rough", async () => {
    lookup.fn.mockReset();
    lookup.fn.mockResolvedValue(AREA);
    refund.setReturnAddress.mockClear();
    const v = { order_id: "o1", request: { id: "r1", status: "returning", return_way: "collect", return_at: null, return_address: null } } as unknown as RefundRequestView;
    render(<QueryClientProvider client={new QueryClient()}><DeclutterReturnBuyer v={v} who="The seller" /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Where should they pick it up?"), { target: { value: TYPED } });
    fireEvent.click(screen.getByRole("button", { name: "Send the address" }));
    await waitFor(() => expect(refund.setReturnAddress).toHaveBeenCalledWith("r1", TYPED, { lat: 30.5, lng: -92.1 }));
    await waitFor(() => expect(toasted).toHaveBeenCalledWith(expect.stringMatching(/map may only show the area.*address you typed/)));
    expect(screen.queryByRole("button", { name: /use my location/ })).toBeNull();
  });

  it("a lookup that failed still stops and says so: there is no point at all to send", async () => {
    lookup.fn.mockReset();
    lookup.fn.mockResolvedValue({ status: "unavailable" });
    refund.setReturnAddress.mockClear();
    toasted.error.mockClear();
    const v = { order_id: "o1", request: { id: "r1", status: "returning", return_way: "collect", return_at: null, return_address: null } } as unknown as RefundRequestView;
    render(<QueryClientProvider client={new QueryClient()}><DeclutterReturnBuyer v={v} who="The seller" /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Where should they pick it up?"), { target: { value: TYPED } });
    fireEvent.click(screen.getByRole("button", { name: "Send the address" }));
    await waitFor(() => expect(toasted.error).toHaveBeenCalledWith(expect.stringMatching(/just now/)));
    expect(refund.setReturnAddress).not.toHaveBeenCalled();
  });
});

describe("the four callers share it", () => {
  const CALLERS = ["useSellFlowState.ts", "DeclutterBunchView.tsx", "SellerSetup.tsx", "DeclutterRefundReturn.tsx"];
  it.each(CALLERS)("%s uses the one lookup, and loads it only when used", (file) => {
    const src = readFileSync(`src/components/declutter/${file}`, "utf8");
    expect(src).toContain("useExactAddressPoint");
    expect(src).not.toMatch(/from "@\/lib\/(geocode|addressLookup)"/);
  });
  it("the moving sale's place comes from the shared lookup", () => {
    // The moving sale is the bunch flow now.
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBunchView.tsx", "utf8"));
    expect(src).toContain("const c = await place.locate(pickupAddress);");
    expect(src).toContain("pickupLat: c.lat, pickupLng: c.lng");
  });
  it("the hook import()s the lookup rather than bundling it", () => {
    const src = readFileSync("src/components/declutter/useExactAddressPoint.ts", "utf8");
    expect(src).toContain('await import("@/lib/addressLookup")');
    expect(src).not.toMatch(/from "@\/lib\/addressLookup"/);
    expect(CALLERS.length).toBeGreaterThan(3);
  });
});
