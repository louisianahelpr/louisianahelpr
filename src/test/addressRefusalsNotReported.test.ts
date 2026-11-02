/**
 * Q2552 (ledger c0f60811ad78, Sentry JAVASCRIPT-57 "Error: address_not_found", 3 events 11-01): an address the lookup
 * cannot place is the member's to fix. The form shows plain words (declutterErrorMessage), so the MutationCache hook
 * must not log it as a defect. Before this, useExactAddressPoint threw a bare Error(code) and every miss on the return
 * address form (DeclutterReturnBuyer, notFoundCode "address_not_found") reached Sentry. A lookup that could not answer
 * at all ("address_lookup_unavailable") is an outage and is still reported.
 *
 * Class: every refusal the shared hook throws (not found, area only, shared location too far) is a designed refusal.
 *
 * @mutate src/components/declutter/useExactAddressPoint.ts | return Object.assign(new Error(code), { designedRefusal: true }); | return new Error(code);
 * @mutate src/components/declutter/useExactAddressPoint.ts |     throw found.status === "unavailable" ? new Error("address_lookup_unavailable") : refused(notFoundCode); |     throw found.status === "unavailable" ? refused("address_lookup_unavailable") : refused(notFoundCode);
 * @mutate src/components/declutter/DeliveryCantFinish.tsx | if (!point) throw Object.assign(new Error("fix_address_not_found"), { designedRefusal: true }); | if (!point) throw new Error("fix_address_not_found");
 */
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const report = vi.hoisted(() => vi.fn());
const lookup = vi.hoisted(() => ({ fn: vi.fn() }));
const position = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: lookup.fn }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: position.fn }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { reportCacheError } from "@/lib/queryClient";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { useExactAddressPoint } from "@/components/declutter/useExactAddressPoint";
import { blankComments } from "@/test/helpers/blankNonCode";

const TYPED = "101 Sample Bayou Rd, Exampleville, LA 70000";

async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

describe("address refusals are shown, not reported (Q2552)", () => {
  beforeEach(() => { report.mockClear(); lookup.fn.mockReset(); position.fn.mockReset(); });

  const refusals: Array<[string, () => void, string | undefined, string]> = [
    ["not found on the return address form", () => lookup.fn.mockResolvedValue({ status: "not_found" }), "address_not_found", "address_not_found"],
    ["not found on a pickup form", () => lookup.fn.mockResolvedValue({ status: "not_found" }), undefined, "invalid_location"],
    ["only the area found", () => lookup.fn.mockResolvedValue({ status: "approximate", lat: 30.5, lng: -92.1, precision: "town" }), undefined, "address_not_exact"],
  ];

  it.each(refusals)("%s: plain words, and neither cache hook logs it", async (_name, arrange, code, message) => {
    arrange();
    const { result } = renderHook(() => useExactAddressPoint(code as "address_not_found" | undefined));
    let err: unknown;
    await act(async () => { err = await thrown(() => result.current.locate(TYPED)); });
    expect((err as Error).message).toBe(message);
    expect(declutterErrorMessage(err)).not.toMatch(/something went wrong/i);
    reportCacheError("MutationCache", err, ["declutter"]);
    reportCacheError("QueryCache", err, ["declutter"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("a shared location far from the address is a refusal too", async () => {
    lookup.fn.mockResolvedValue({ status: "approximate", lat: 30.5, lng: -92.1, precision: "town" });
    position.fn.mockResolvedValue({ lat: 32.5, lng: -93.7 });
    const { result } = renderHook(() => useExactAddressPoint());
    await act(async () => { await thrown(() => result.current.locate(TYPED)); });
    let err: unknown;
    await act(async () => { err = await thrown(() => result.current.shareMyLocation()); });
    expect((err as Error).message).toBe("location_far_from_address");
    reportCacheError("MutationCache", err, ["declutter"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("a lookup that could not answer is an outage and is still reported", async () => {
    lookup.fn.mockResolvedValue({ status: "unavailable" });
    const { result } = renderHook(() => useExactAddressPoint());
    let err: unknown;
    await act(async () => { err = await thrown(() => result.current.locate(TYPED)); });
    expect((err as Error).message).toBe("address_lookup_unavailable");
    reportCacheError("MutationCache", err, ["declutter"]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("the delivery fix's own address miss (DeliveryCantFinish) is a designed refusal too", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeliveryCantFinish.tsx", "utf8"));
    const throws = src.match(/throw[^;]*"fix_address_not_found"[^;]*;/g) ?? [];
    expect(throws.length).toBeGreaterThan(0);
    for (const t of throws) expect(t).toContain("designedRefusal: true");
  });
});
