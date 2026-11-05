/**
 * CLASS GUARD (Q2709, 11-04; owner 10-31 "Nothing hand-made"): the "Add photo" tile is the shared AddPhotoTile
 * (src/components/ui/AddPhotoTile.tsx), one look for the native button and the web file picker.
 *   1. onClick -> a real <button type="button"> with the focus-visible ring (the old native tile had none).
 *   2. onFiles -> a <label> wrapping a hidden file <input> with the caller's accept / multiple, focus-within ring.
 *   3. Both wear the same 80px dashed tile.
 *   4. PhotoProof draws both of its add tiles with it and keeps no hand-written dashed tile.
 *
 * @mutate src/components/ui/AddPhotoTile.tsx | cn(TILE, RING, "focus-visible:ring-2", className) | cn(TILE, className)
 * @mutate src/components/ui/AddPhotoTile.tsx | <input type="file" className="sr-only" onChange={onFiles} {...picker} /> | <input type="file" className="sr-only" onChange={onFiles} />
 * @mutate src/components/ui/AddPhotoTile.tsx | border-[1.5px] border-dashed | border
 * @mutate src/components/PhotoProof.tsx | <AddPhotoTile onClick={handleNativeAdd}> | <AddPhotoTile accept="image/*" onFiles={() => {}}>
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AddPhotoTile } from "@/components/ui/AddPhotoTile";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");

describe("the Add photo tile is shared (Q2709)", () => {
  it("onClick is a real button with the focus ring", () => {
    const onClick = vi.fn();
    render(<AddPhotoTile onClick={onClick}>Add photo</AddPhotoTile>);
    const b = screen.getByRole("button", { name: "Add photo" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.className.split(/\s+/)).toContain("focus-visible:ring-2");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("onFiles is a label around a hidden file input that keeps the caller's accept and multiple", () => {
    const onFiles = vi.fn();
    const { container } = render(<AddPhotoTile accept="image/*" multiple onFiles={onFiles}>Add photo</AddPhotoTile>);
    const label = container.querySelector("label[data-add-photo-tile]") as HTMLLabelElement;
    expect(label).toBeTruthy();
    expect(label.className.split(/\s+/)).toContain("focus-within:ring-2");
    const input = label.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe("image/*");
    expect(input.multiple).toBe(true);
    expect(input.className).toContain("sr-only");
    fireEvent.change(input, { target: { files: [] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it("both ways wear the same dashed 80px tile", () => {
    const { container } = render(
      <>
        <AddPhotoTile onClick={() => {}}>A</AddPhotoTile>
        <AddPhotoTile accept="image/*" onFiles={() => {}}>B</AddPhotoTile>
      </>,
    );
    const tiles = [...container.querySelectorAll<HTMLElement>("[data-add-photo-tile]")];
    expect(tiles.length).toBe(2);
    for (const t of tiles) for (const c of ["w-20", "h-20", "rounded-2xl", "border-dashed", "border-[1.5px]"]) expect(t.className.split(/\s+/), c).toContain(c);
  });

  it("PhotoProof draws both add tiles with AddPhotoTile and keeps no hand-written dashed tile", () => {
    const src = blankComments(readFileSync(resolve(REPO, "src/components/PhotoProof.tsx"), "utf8"));
    expect((src.match(/<AddPhotoTile\b/g) ?? []).length).toBe(2);
    expect(src).toMatch(/<AddPhotoTile onClick=\{handleNativeAdd\}>/);
    expect(src).toMatch(/<AddPhotoTile accept="image\/\*" multiple onFiles=\{handleSelect\}>/);
    expect(src).not.toMatch(/dashed/);
  });
});
