/**
 * M2 (Declutter buy audit 11-08): after Back from Stripe's page, a back-forward-cache restore (pageshow, persisted)
 * must clear Pay's "Opening…" state. The hook runs its callback on exactly that event, and the checkout uses it.
 *
 * @mutate src/hooks/usePageRestored.ts |       if (e.persisted) latest.current(); |       if (!e.persisted) latest.current();
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   usePageRestored(() => { setOpening(false); invalidateTrades(qc); |   usePageRestored(() => { invalidateTrades(qc);
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";
import { usePageRestored } from "./usePageRestored";
import { blankComments } from "@/test/helpers/blankNonCode";

function pageshow(persisted: boolean) {
  const e = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(e, "persisted", { value: persisted });
  window.dispatchEvent(e);
}

describe("Back from Stripe's page recovers the Pay button (M2)", () => {
  it("runs on a back-forward-cache restore only, and stops after unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => usePageRestored(cb));
    pageshow(false);
    expect(cb).not.toHaveBeenCalled();
    pageshow(true);
    expect(cb).toHaveBeenCalledTimes(1);
    unmount();
    pageshow(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("the checkout's Pay clears Opening… and re-reads the order on that restore", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterTradeViews.tsx", "utf8"));
    expect(src).toMatch(/usePageRestored\(\(\) => \{ setOpening\(false\); invalidateTrades\(qc\);/);
  });
});
