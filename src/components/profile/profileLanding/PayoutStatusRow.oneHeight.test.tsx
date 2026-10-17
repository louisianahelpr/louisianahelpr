/**
 * THE PAYOUT ROW IS ONE HEIGHT IN EVERY STATE, AND THE SKELETON HOLDS THAT
 * HEIGHT WITH THE ROW ITSELF (reds, 2026-10-17).
 *
 * page-settle /profile at 375 measured cls 0.0111 whenever the Stripe status
 * check failed: the error row wrapped to three lines (67px) where the reserve,
 * the setup row and ProfilePageSkeleton's `h-[52px]` bone were two (52px), so
 * the settings list dropped 15px after the page had painted.
 *
 * jsdom lays nothing out, so this guards the CONSTRUCTION that makes the
 * heights equal rather than a pixel number: every state renders the SAME text
 * and action cells (both states' words, stacked in one grid cell, the inactive
 * one `invisible`), so the tallest copy and the widest action size every state;
 * and the skeleton draws this row's own reserve instead of a fixed bone. The
 * pixel proof (375 and 1440, all three states) is in the commit message.
 *
 * @mutate src/components/profile/profileLanding/PayoutStatusRow.tsx | <StackedCopy shown="error" /> | <p className="flex-1 min-w-0 text-ds-11">We couldn't check your payout account. Check it before you count on getting paid.</p>
 * @mutate src/components/profile/profileLanding/PayoutStatusRow.tsx | const cell = (s: Shown) => `[grid-area:1/1] ${shown === s ? "" : "invisible"}`.trim(); | const cell = (s: Shown) => (shown === s ? "" : "hidden");
 * @mutate src/components/profile/ProfilePageSkeleton.tsx | <PayoutStatusRow prompt={RESERVE} onSetUp={noop} onRetry={noop} /> | <Skeleton className="h-[52px] rounded-ds-md" />
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PayoutStatusRow } from "./PayoutStatusRow";
import { ProfilePageSkeleton } from "@/components/profile/ProfilePageSkeleton";
import type { PayoutPrompt } from "@/hooks/useStripeConnectStatus";

const noop = () => {};
const STATES: PayoutPrompt[] = [{ kind: "reserve" }, { kind: "setup" }, { kind: "error" }];

/** Every sizing cell of the row: its stack, its words and whether it is hidden. */
function cells(root: ParentNode) {
  return [...root.querySelectorAll("[data-payout-copy], [data-payout-action]")].map((el) => ({
    slot: el.hasAttribute("data-payout-copy") ? `copy:${el.getAttribute("data-payout-copy")}` : `action:${el.getAttribute("data-payout-action")}`,
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    stacked: /\[grid-area:1\/1\]/.test(el.getAttribute("class") ?? "") && /\bgrid\b/.test(el.parentElement?.getAttribute("class") ?? ""),
    hidden: /\binvisible\b/.test(el.getAttribute("class") ?? ""),
  }));
}

describe("PayoutStatusRow: one height in every state", () => {
  const states = () => STATES.map((p) => {
    const { container, unmount } = render(<PayoutStatusRow prompt={p} onSetUp={noop} onRetry={noop} />);
    const c = cells(container);
    unmount();
    return { kind: p.kind, cells: c };
  });

  it("every state lays out the same four cells with the same words, all stacked", () => {
    const byState = states();
    const shape = (c: ReturnType<typeof cells>) => c.map(({ slot, text, stacked }) => ({ slot, text, stacked }));
    expect(byState[0].cells).toHaveLength(4);
    for (const s of byState) {
      expect(shape(s.cells), `${s.kind} differs from reserve`).toEqual(shape(byState[0].cells));
      expect(s.cells.every((c) => c.stacked), `${s.kind} has a cell outside the stack`).toBe(true);
    }
    // Non-vacuous: the two copies really are different lengths (the 67 vs 52px cause).
    const copy = byState[0].cells.filter((c) => c.slot.startsWith("copy:")).map((c) => c.text.length);
    expect(new Set(copy).size).toBe(2);
  });

  it("shows exactly its own words: setup shows setup, error shows error, the reserve shows none", () => {
    const byState = states();
    const shown = (k: string) => byState.find((s) => s.kind === k)!.cells.filter((c) => !c.hidden).map((c) => c.slot).sort();
    expect(shown("setup")).toEqual(["action:setup", "copy:setup"]);
    expect(shown("error")).toEqual(["action:error", "copy:error"]);
    expect(shown("reserve")).toEqual([]);
  });

  it("the landing skeleton holds the slot with the row's own reserve, not a bone of a guessed height", () => {
    const byState = states();
    const { container } = render(<MemoryRouter><ProfilePageSkeleton /></MemoryRouter>);
    const skel = cells(container);
    expect(skel.map(({ slot, text }) => ({ slot, text }))).toEqual(byState[0].cells.map(({ slot, text }) => ({ slot, text })));
    expect(container.querySelector('[class*="h-[52px]"]')).toBeNull();
  });
});
