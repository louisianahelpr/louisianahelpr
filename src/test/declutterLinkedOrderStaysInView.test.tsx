// @mutate src/components/declutter/useLinkedOrder.ts |       if (Math.abs(now - top) > 2) { |       if (Math.abs(now - top) > 2 && now === -1) {
// @mutate src/components/declutter/useLinkedOrder.ts |       if (a !== el && (!a \|\| a === document.body)) el.focus({ preventScroll: true }); |
/**
 * F157 (lab 11-09): /declutter?tab=buying&order=<id> opened the order card, but on a cold load at 1440 the offers and
 * trades above it landed after the scroll and pushed it off screen, with focus on <body>. The card is now kept in view
 * (and focused) while the tab settles, until the member scrolls, taps or types.
 */
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LINKED_ORDER_SETTLE_MS, useScrollToLinkedOrder } from "@/components/declutter/useLinkedOrder";

let cardTop = 0;
function Card({ linked = true }: { linked?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useScrollToLinkedOrder(ref, linked, () => {});
  return <article ref={ref} tabIndex={-1} data-testid="card">order</article>;
}

function setup() {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date"] });
  const scrolls: number[] = [];
  const r = render(<Card />);
  const card = r.getByTestId("card");
  card.getBoundingClientRect = () => ({ top: cardTop, bottom: cardTop + 100, height: 100, left: 0, right: 100, width: 100, x: 0, y: cardTop, toJSON: () => ({}) });
  card.scrollIntoView = () => { scrolls.push(Date.now()); cardTop = 0; };
  return { card, scrolls };
}

afterEach(() => { cleanup(); vi.useRealTimers(); cardTop = 0; });

describe("F157: a linked order stays in view and focused while the tab settles", () => {
  it("content landing above moves the card: it is scrolled back and focused again", () => {
    const { card, scrolls } = setup();
    expect(document.activeElement).toBe(card);
    const first = scrolls.length;
    // Offers load above: the card drops 600px and focus is lost to <body>.
    cardTop = 600;
    card.blur();
    vi.advanceTimersByTime(50);
    expect(scrolls.length).toBeGreaterThan(first);
    expect(document.activeElement).toBe(card);
  });

  it("the member's own scroll wins: after a wheel, nothing pulls the page back", () => {
    const { card, scrolls } = setup();
    fireEvent.wheel(window);
    const n = scrolls.length;
    cardTop = 600;
    vi.advanceTimersByTime(50);
    expect(scrolls.length).toBe(n);
    expect(card).toBeTruthy();
  });

  it("it lets go once the tab has settled", () => {
    const { scrolls } = setup();
    vi.advanceTimersByTime(LINKED_ORDER_SETTLE_MS + 100);
    const n = scrolls.length;
    cardTop = 600;
    vi.advanceTimersByTime(50);
    expect(scrolls.length).toBe(n);
  });
});
