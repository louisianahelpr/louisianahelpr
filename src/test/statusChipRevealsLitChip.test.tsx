/**
 * Audit A2-L18 (2026-10-29, ~/.lh-shots/app-audit-1028/2-jobs-h2/p2e-rcancel-after-375.png): at 375 in Posted, the
 * lit status chip "Waiting" sat under the row's end fade and the search icon, cut to "Wait": the chip row scrolls
 * sideways and nothing brought the selected chip into view. StatusBoxes now scrolls the lit chip fully clear of
 * the 44px end fade whenever the filter changes (and when the chips change width).
 *
 * jsdom has no layout, so the rects are stubbed. "Waiting" starting at x≈259 is read off the shot (a 2x capture,
 * its chip starts at 518px); the other numbers are illustrative.
 *
 * @mutate src/components/sections/StatusBoxes.tsx |       if (d !== 0) track.scrollLeft += d; |       if (d !== 0) void d;
 * @mutate src/components/sections/StatusBoxes.tsx |   const over = chip.right - (track.right - endFade); |   const over = chip.right - track.right;
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusBoxes, revealDelta } from "@/components/sections/StatusBoxes";

const BOXES = [
  { key: "needs_you", label: "Needs you", count: 17 },
  { key: "waiting", label: "Waiting", count: 3 },
  { key: "done", label: "Done", count: 47 },
] as const;
type K = (typeof BOXES)[number]["key"];

describe("revealDelta: how far the lit chip must scroll", () => {
  it("a chip running under the end fade scrolls left until its right edge clears the fade", () => {
    // Track 20..355 at 375 with a 44px fade: visible clear up to 311. "Waiting" 259..360 must move 49px.
    expect(revealDelta({ left: 20, right: 355 }, { left: 259, right: 360 }, 44)).toBe(49);
  });
  it("a chip already clear of the fade does not move", () => {
    expect(revealDelta({ left: 20, right: 355 }, { left: 120, right: 250 }, 44)).toBe(0);
  });
  it("a chip scrolled off the start comes back to the start", () => {
    expect(revealDelta({ left: 20, right: 355 }, { left: -30, right: 60 }, 44)).toBe(-50);
  });
  it("with no end control there is no fade to clear", () => {
    expect(revealDelta({ left: 20, right: 355 }, { left: 259, right: 350 }, 0)).toBe(0);
  });
});

describe("StatusBoxes scrolls the lit chip into view (A2-L18)", () => {
  it("lighting 'Waiting' under the end fade scrolls the track by the overshoot", () => {
    const onToggle = () => {};
    const { container, rerender } = render(<StatusBoxes<K> boxes={BOXES} value={null} onToggle={onToggle} allCount={267} end={<button type="button">Search</button>} />);
    const track = container.querySelector<HTMLElement>("[role='group'][aria-label='Filter by status']")!;
    const chips = Array.from(track.querySelectorAll("button"));
    expect(chips.length).toBeGreaterThan(3);
    let scrollLeft = 0;
    Object.defineProperty(track, "scrollLeft", { configurable: true, get: () => scrollLeft, set: (v: number) => { scrollLeft = v; } });
    track.getBoundingClientRect = () => ({ left: 20, right: 355 }) as DOMRect;
    const waiting = track.querySelector<HTMLElement>("[data-status-box='waiting']")!;
    waiting.getBoundingClientRect = () => ({ left: 259 - scrollLeft, right: 360 - scrollLeft }) as DOMRect;

    rerender(<StatusBoxes<K> boxes={BOXES} value="waiting" onToggle={onToggle} allCount={267} end={<button type="button">Search</button>} />);
    expect(scrollLeft).toBe(49);
    // In view now: its right edge sits at the fade's start, so it is never cut.
    expect(waiting.getBoundingClientRect().right).toBe(355 - 44);
  });
});
