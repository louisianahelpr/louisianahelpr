/**
 * POST-S9 (posting audit 10-30 #9): the one-item sell form's photos drag to a new place (heldPhotoReorder.ts).
 * A finger holds first (a moving finger is scrolling), a mouse drags at once, a press on Remove or Make cover is never
 * a drag, and a failed batch does not reorder. The order reaching Post is in declutterSellPhotos.test.tsx 'POST-S9'.
 *
 * @mutate src/components/declutter/heldPhotoReorder.ts |             if (moved > TOUCH_SLOP_PX) stop(); |             void TOUCH_SLOP_PX;
 * @mutate src/components/declutter/heldPhotoReorder.ts |         if (e.button !== 0 \|\| (e.target as HTMLElement).closest("button, a, input, label")) return; |         if (e.button !== 0) return;
 * @mutate src/components/declutter/heldPhotoReorder.ts |           if (to !== null && to !== p.index) onMove(p.index, to); |           if (to !== null) onMove(p.index, p.index);
 * @mutate src/components/declutter/heldPhotoReorder.ts |       if (press.current?.active) e.preventDefault(); |       void e;
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |   const reorder = useHeldPhotoReorder(held.length, heldFailed ? undefined : onReorderHeld); |   const reorder = useHeldPhotoReorder(held.length, onReorderHeld);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SellPhotos } from "./DeclutterSellPhotos";
import { LONG_PRESS_MS, moveTo } from "./heldPhotoReorder";

const files = ["a.jpg", "b.jpg", "c.jpg"].map((n) => new File(["x"], n, { type: "image/jpeg" }));
const tiles = () => [...document.querySelectorAll<HTMLElement>("[data-held-index]")];

function draw(onReorderHeld = vi.fn(), heldFailed = false) {
  render(
    <SellPhotos uploaded={[]} held={files} onFiles={() => {}} onRemoveUploaded={() => {}} onRemoveHeld={() => {}} uploading={0}
      onMakeCover={() => {}} onReorderHeld={onReorderHeld} heldFailed={heldFailed} aiPanel={null} />,
  );
  return onReorderHeld;
}
/** The tile under the pointer is tile `i`. */
const pointAt = (i: number) => {
  // jsdom has no elementFromPoint (no layout): the test says which tile is under the pointer.
  (document as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => tiles()[i];
};

afterEach(() => {
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("moveTo", () => {
  it("moves one entry and closes up; out of range or in place is the same array", () => {
    expect(moveTo(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveTo(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    const same = ["a", "b"];
    expect(moveTo(same, 1, 1)).toBe(same);
    expect(moveTo(same, 0, 5)).toBe(same);
  });
});

describe("dragging a held photo (POST-S9)", () => {
  it("a finger held still, then moved onto photo 1, moves photo 3 there; the page cannot scroll while it drags", () => {
    vi.useFakeTimers();
    const onMove = draw();
    pointAt(0);
    fireEvent.pointerDown(tiles()[2], { button: 0, pointerType: "touch", clientX: 200, clientY: 10, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(tiles()[2].hasAttribute("data-photo-dragging")).toBe(true);
    const scroll = new Event("touchmove", { cancelable: true });
    document.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(true);
    fireEvent.pointerMove(tiles()[2], { pointerType: "touch", clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(tiles()[2], { pointerType: "touch", clientX: 20, clientY: 10, pointerId: 1 });
    expect(onMove).toHaveBeenCalledWith(2, 0);
    // Once it ends, the page scrolls again.
    const after = new Event("touchmove", { cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("a finger that moves before the hold is scrolling: no drag", () => {
    vi.useFakeTimers();
    const onMove = draw();
    pointAt(0);
    fireEvent.pointerDown(tiles()[2], { button: 0, pointerType: "touch", clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(tiles()[2], { pointerType: "touch", clientX: 200, clientY: 60, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(tiles()[2].hasAttribute("data-photo-dragging")).toBe(false);
    fireEvent.pointerUp(tiles()[2], { pointerType: "touch", clientX: 20, clientY: 10, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a press on Remove or Make cover is never a drag; dropping in place moves nothing", () => {
    const onMove = draw();
    pointAt(0);
    const cover = tiles()[2].querySelector("button[aria-label^='Make photo']") as HTMLElement;
    fireEvent.pointerDown(cover, { button: 0, pointerType: "mouse", clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(cover, { pointerType: "mouse", clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(cover, { pointerType: "mouse", clientX: 20, clientY: 10, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
    pointAt(1);
    fireEvent.pointerDown(tiles()[1], { button: 0, pointerType: "mouse", clientX: 100, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(tiles()[1], { pointerType: "mouse", clientX: 120, clientY: 10, pointerId: 2 });
    fireEvent.pointerUp(tiles()[1], { pointerType: "mouse", clientX: 120, clientY: 10, pointerId: 2 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("photos that failed to upload do not reorder, and the hint is only there when they do", () => {
    const onMove = draw(vi.fn(), true);
    pointAt(0);
    fireEvent.pointerDown(tiles()[2], { button: 0, pointerType: "mouse", clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(tiles()[2], { pointerType: "mouse", clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(tiles()[2], { pointerType: "mouse", clientX: 20, clientY: 10, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
    expect(document.querySelector("[data-photo-count]")?.textContent).not.toMatch(/drag/);
    cleanup();
    draw();
    expect(document.querySelector("[data-photo-count]")?.textContent).toMatch(/hold and drag a photo to move it/);
  });
});
