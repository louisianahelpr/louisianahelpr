/**
 * Owner 2026-11-01 (Sell a bunch): ONE list button. Step 3 had "List 3 items" while the sticky bar still said
 * "All 3 set. / Next: list 3 items". Once the list step (its List button with the confirm tick right above it) is on
 * screen, the bar's Next goes; before that, Next still takes the seller there.
 *
 * @mutate src/components/declutter/DeclutterBunchBar.tsx |   const nextRow = !listing && !sorting && itemCount > 0 && !(listStepInView && !(needs && onNeeds)); |   const nextRow = !listing && !sorting && itemCount > 0;
 * @mutate src/components/declutter/DeclutterBunchBar.tsx |     const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold: 0.15 }); |     const io = new IntersectionObserver(() => setInView(false), { threshold: 0.15 });
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BunchBar } from "./DeclutterBunchBar";

let seen: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
class FakeIO {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { seen.push(cb); }
  observe() { /* the test calls back by hand */ }
  disconnect() { /* nothing held */ }
}
const g = globalThis as unknown as { IntersectionObserver?: unknown };
const real = g.IntersectionObserver;
beforeEach(() => { seen = []; g.IntersectionObserver = FakeIO; });
afterEach(() => { cleanup(); g.IntersectionObserver = real; });

function Page({ needs = null }: { needs?: string | null }) {
  return (
    <>
      <section><h2 id="bunch-list">3. List 3 items</h2><button type="button">List 3 items</button></section>
      <BunchBar sorting={null} found={0} listing={null} runNames={[]} undo={null} itemCount={3} readyCount={3} needs={needs} onNeeds={needs ? () => {} : null}
        onNext={() => {}} onUndo={() => {}} onUseOtherPrice={() => {}} />
    </>
  );
}

describe("Sell a bunch has one list button on screen", () => {
  it("the bar's Next shows until the list step is in view, then only the step's List button is left", () => {
    render(<Page />);
    expect(screen.getByRole("button", { name: "Next: list 3 items" })).toBeTruthy();
    expect(seen.length).toBeGreaterThan(0);
    act(() => seen.forEach((cb) => cb([{ isIntersecting: true }])));
    expect(screen.queryByRole("button", { name: "Next: list 3 items" })).toBeNull();
    expect(document.querySelector("[data-bunch-bar]")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^List 3 items$|^Next: list/ })).toHaveLength(1);
    act(() => seen.forEach((cb) => cb([{ isIntersecting: false }])));
    expect(screen.getByRole("button", { name: "Next: list 3 items" })).toBeTruthy();
  });

  it("an item still needing something keeps its pointer in the bar, without a second list button", () => {
    render(<Page needs="1 item needs a price" />);
    act(() => seen.forEach((cb) => cb([{ isIntersecting: true }])));
    expect(screen.getByRole("button", { name: "1 item needs a price" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Next: list/ })).toBeNull();
  });
});
