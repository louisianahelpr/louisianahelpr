/*
 * F359o (audit 11-10): the seller reading their own listing when the session ends is told "You've been signed out.
 * Log in again to manage this listing." with a Log in that returns here, instead of the page silently turning into
 * the guest view ("Signing up is free. We'll bring you back to this item.").
 */
// @mutate src/components/declutter/DeclutterGuest.tsx |   if (ownListing) ownedBefore.current = true; |   ownedBefore.current = ownListing;
// @mutate src/components/declutter/DeclutterGuest.tsx |   return !signedIn && ownedBefore.current; |   return ownedBefore.current;
// @mutate src/components/declutter/DeclutterItemView.tsx | {canAct && !user && !signedOutOwner && <DeclutterGuestJoin | {canAct && !user && <DeclutterGuestJoin
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DeclutterSignedOutOwner, useSignedOutOwner } from "@/components/declutter/DeclutterGuest";

describe("useSignedOutOwner (F359o)", () => {
  it("is true only after the viewer owned the listing and then lost the session", () => {
    const { result, rerender } = renderHook(({ own, signedIn }) => useSignedOutOwner(own, signedIn), { initialProps: { own: true, signedIn: true } });
    expect(result.current).toBe(false);
    rerender({ own: false, signedIn: false });
    expect(result.current).toBe(true);
    // Logging back in clears it.
    rerender({ own: true, signedIn: true });
    expect(result.current).toBe(false);
  });

  it("is never true for a plain guest, nor for a signed-in buyer, nor for a buyer who signs out", () => {
    const guest = renderHook(({ own, signedIn }) => useSignedOutOwner(own, signedIn), { initialProps: { own: false, signedIn: false } });
    expect(guest.result.current).toBe(false);
    const buyer = renderHook(({ own, signedIn }) => useSignedOutOwner(own, signedIn), { initialProps: { own: false, signedIn: true } });
    expect(buyer.result.current).toBe(false);
    buyer.rerender({ own: false, signedIn: false });
    expect(buyer.result.current).toBe(false);
  });
});

describe("DeclutterSignedOutOwner (F359o)", () => {
  it("says so and its Log in comes back to this listing", () => {
    render(<MemoryRouter initialEntries={["/declutter/item/de8ae5ef?tab=photos"]}><DeclutterSignedOutOwner /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("You've been signed out. Log in again to manage this listing.");
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?redirect=${encodeURIComponent("/declutter/item/de8ae5ef?tab=photos")}`);
  });

  it("the item page shows it to the signed-out seller instead of the guest join line", () => {
    const src = readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8");
    expect(src).toContain("const signedOutOwner = useSignedOutOwner(ownListing, !!user);");
    expect(src).toContain("{signedOutOwner && <DeclutterSignedOutOwner />}");
    expect(src).toContain("{canAct && !user && !signedOutOwner && <DeclutterGuestJoin");
  });
});
