/**
 * The gift-tag design picker (owner 2026-11-21, from /gift-guides/printables: "how do I see the rest of the tags? can
 * they hold the picture down to make it bigger so they can see better?"):
 *   - every design shows in a wrapping grid, never a sideways-scrolling row that hides the rest;
 *   - every design has a real "Bigger look at <name>" button, and pressing and holding a design (~400 ms) opens the same
 *     big preview: the FULL-size picture (loaded only then; the grid shows the light thumbs), its name, "Use this design";
 *   - "Use this design" picks it; a quick tap just picks, never opens; the click that ends a hold does not pick;
 *   - Escape closes the preview and gives focus back to the magnifier.
 *
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx | .pr-designs{display:grid; | .pr-designs{display:flex;overflow-x:auto;
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx | const HOLD_MS = 400; | const HOLD_MS = 4000;
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx |           swallowNextClick(); |           void 0;
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx |     ev.stopPropagation(); |     void 0;
 * @mutate src/content/printables.ts |     if (seen.has(d.set)) return []; |     if (false) return [];
 * @mutate src/content/printables.ts |     : set.length > 1 ? set[(set.indexOf(chosen) + i) % set.length] |     : set.length > 99 ? set[0]
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx |         held.current = false;\n        e.preventDefault(); |         held.current = false;\n        void 0;
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx | onClick={() => { setDesignId(zoomDesign.id); setZoomId(null); }} | onClick={() => { setZoomId(null); }}
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx | src={zoomDesign.image} | src={zoomDesign.thumb ?? zoomDesign.image}
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DESIGN_SETS, PRINTABLES, pickerDesigns, sheetPages, type OverlayProduct } from "@/content/printables";
import NameMaker from "@/pages/info/giftGuides/printables/NameMaker";

const tags = PRINTABLES.find((p): p is OverlayProduct => p.kind === "overlay" && p.id === "gift-tags")!;
const radio = (id: string) => document.querySelector<HTMLInputElement>(`[data-printable-design="${id}"]`)!;
const label = (id: string) => radio(id).closest("label")!;
const dialog = () => document.querySelector<HTMLElement>("[data-printable-zoom-dialog]");
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

afterEach(() => act(() => cleanup()));

describe("the gift-tag design picker", () => {
  it("shows every design in a wrapping grid, each with its name and a labelled magnifier", () => {
    expect(tags.designs.length).toBeGreaterThan(19);
    render(<NameMaker product={tags} />);
    const grid = document.querySelector<HTMLElement>("[data-printable-designs]")!;
    const css = getComputedStyle(grid);
    expect(css.display).toBe("grid");
    expect(css.overflowX).not.toMatch(/auto|scroll/);
    // Holiday audit 1121 area 5 #19: the 9 vintage scallop tags show once, as their set.
    const shown = pickerDesigns(tags);
    expect(shown.length).toBe(tags.designs.length - 8);
    expect(grid.querySelectorAll("[data-printable-design]").length).toBe(shown.length);
    for (const d of shown) {
      // The radio's name is the design's name (the label wraps it), and the zoom is a real button.
      expect(screen.getByRole("radio", { name: d.name })).toBe(radio(d.id));
      const zoom = screen.getByRole("button", { name: `Bigger look at ${d.name}` });
      expect(zoom.tagName).toBe("BUTTON");
      expect(zoom.getAttribute("data-printable-zoom")).toBe(d.id);
    }
  });

  it("press and hold opens the big preview with the full-size picture; Use this design picks it", async () => {
    render(<NameMaker product={tags} />);
    const d = tags.designs[6];
    expect(d.thumb && d.thumb !== d.image).toBeTruthy();
    // Thumbs only until the preview opens.
    expect(document.querySelector(`img[src="${d.image}"]`)).toBeNull();
    fireEvent.pointerDown(label(d.id), { button: 0, clientX: 10, clientY: 10, pointerType: "touch" });
    await waitFor(() => expect(dialog()?.getAttribute("data-printable-zoom-dialog")).toBe(d.id), { timeout: 1500 });
    const img = dialog()!.querySelector<HTMLImageElement>("[data-printable-zoom-img]")!;
    expect(img.getAttribute("src")).toBe(d.image);
    expect(img.getAttribute("alt")).toBe(d.name);
    expect(screen.getByRole("dialog", { name: d.name })).toBeTruthy();
    // The click that ends the hold does not pick the design.
    fireEvent.pointerUp(label(d.id), { pointerType: "touch" });
    fireEvent.click(label(d.id), { detail: 1 });
    expect(radio(d.id).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Use this design" }));
    expect(dialog()).toBeNull(); // the open preview closes in the same act (no waitFor on emptiness: waitForEmptyIsVacuous)
    expect(radio(d.id).checked).toBe(true);
    expect(radio(tags.designs[0].id).checked).toBe(false);
  });

  it("a quick tap just picks the design and never opens the preview", async () => {
    render(<NameMaker product={tags} />);
    const d = tags.designs[3];
    fireEvent.pointerDown(label(d.id), { button: 0, clientX: 10, clientY: 10, pointerType: "touch" });
    await sleep(120);
    fireEvent.pointerUp(label(d.id), { pointerType: "touch" });
    fireEvent.click(label(d.id), { detail: 1 });
    await sleep(500);
    expect(dialog()).toBeNull();
    expect(radio(d.id).checked).toBe(true);
    // A finger that moves (a scroll) is not a hold either.
    fireEvent.pointerDown(label(tags.designs[4].id), { button: 0, clientX: 10, clientY: 10, pointerType: "touch" });
    fireEvent.pointerMove(label(tags.designs[4].id), { clientX: 10, clientY: 60, pointerType: "touch" });
    await sleep(500);
    expect(dialog()).toBeNull();
  });

  it("the magnifier opens the same preview; Escape closes it and gives focus back", async () => {
    render(<NameMaker product={tags} />);
    const d = tags.designs.find((x) => x.name === "Red berries")!;
    const zoom = screen.getByRole("button", { name: `Bigger look at ${d.name}` });
    zoom.focus();
    fireEvent.click(zoom);
    await waitFor(() => expect(dialog()?.getAttribute("data-printable-zoom-dialog")).toBe(d.id));
    expect(dialog()!.querySelector("[data-printable-zoom-img]")!.getAttribute("src")).toBe(d.image);
    // Portaled to <body>, outside the maker.
    expect(document.querySelector("[data-printable-maker]")!.contains(dialog())).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(dialog()).toBeNull(); // the open preview closes in the same act (no waitFor on emptiness: waitForEmptyIsVacuous)
    await waitFor(() => expect(document.activeElement).toBe(zoom));
    // Closing without "Use this design" picks nothing.
    expect(radio(d.id).checked).toBe(false);
  });

  it("a set shows once and prints its tags in turn (holiday audit 1121 area 5 #19)", () => {
    const set = tags.designs.filter((d) => d.set === "vintage-scallop");
    expect(set.length).toBe(9);
    const tile = pickerDesigns(tags).find((d) => d.set === "vintage-scallop")!;
    expect(tile.name).toBe(DESIGN_SETS["vintage-scallop"]);
    const pages = sheetPages(tags, 9, { mode: "same", same: { to: "Mia", from: "Lexi" }, rows: [], designId: set[0].id, mixDesigns: false });
    expect(pages[0].map((x) => x.design.id)).toEqual(set.map((d) => d.id));
    // Picking a tag outside a set still prints that one design.
    const one = sheetPages(tags, 9, { mode: "same", same: { to: "Mia", from: "Lexi" }, rows: [], designId: tags.designs[0].id, mixDesigns: false });
    expect(new Set(one[0].map((x) => x.design.id)).size).toBe(1);
  });

  it("the click that follows a hold never lands on the preview's own buttons (holiday audit 1121 area 5 #2)", async () => {
    render(<NameMaker product={tags} />);
    const d = tags.designs[1];
    fireEvent.pointerDown(label(d.id), { button: 0, clientX: 10, clientY: 300, pointerType: "touch" });
    await waitFor(() => expect(dialog()).not.toBeNull(), { timeout: 1500 });
    fireEvent.pointerUp(label(d.id), { pointerType: "touch" });
    // The finger lifted over the sheet's Close: the browser's click lands there, and the preview stays open.
    fireEvent.click(screen.getByRole("button", { name: "Close" }), { detail: 1 });
    expect(dialog()).not.toBeNull();
    // A real tap after that works.
    fireEvent.click(screen.getByRole("button", { name: "Close" }), { detail: 1 });
    expect(dialog()).toBeNull();
  });
});
