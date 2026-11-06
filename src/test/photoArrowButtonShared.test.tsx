/**
 * Q2709 "nothing hand-made" (Declutter packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * The Declutter item gallery's Previous / Next photo arrows were hand-made <button>s with one class set (only the
 * side inset differed); they are the shared PhotoArrowButton now. Look-identical by construction: the rendered class
 * SET equals the hand-made literal (CSS does not read class order), type stays "button", and the gallery keeps its
 * labels, disabled ends and handlers.
 *
 * @mutate src/components/ui/PhotoArrowButton.tsx | bg-background/90 text-foreground shadow-sm | bg-background text-foreground shadow-sm
 * @mutate src/components/ui/PhotoArrowButton.tsx | transition-opacity disabled:opacity-0 sm:flex | transition-opacity disabled:opacity-50 sm:flex
 * @mutate src/components/ui/PhotoArrowButton.tsx |     <button ref={ref} type="button" {...props} |     <button ref={ref} {...props}
 * @mutate src/components/declutter/DeclutterGallery.tsx |               className="right-3" |               className="right-2"
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { PhotoArrowButton } from "@/components/ui/PhotoArrowButton";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
// The hand-made literal, verbatim from DeclutterGallery.tsx at main 793859cd9c (the left arrow).
const HAND_MADE =
  "absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity disabled:opacity-0 sm:flex";

describe("the Declutter gallery arrows are the shared PhotoArrowButton, class for class the hand-made look", () => {
  it("renders the hand-made class set with the caller's inset, as type=button", () => {
    for (const side of ["left-3", "right-3"]) {
      const b = render(<PhotoArrowButton aria-label="Next photo" className={side}>x</PhotoArrowButton>).container.querySelector("button")!;
      expect(set(b.className)).toEqual(set(HAND_MADE.replace("left-3", side)));
      expect(b.getAttribute("type")).toBe("button");
    }
  });

  it("the gallery uses it for both arrows, each at its own side; no hand-made arrow is left", () => {
    const s = readFileSync("src/components/declutter/DeclutterGallery.tsx", "utf8");
    expect(s).not.toContain("bg-background/90 text-foreground shadow-sm");
    // Each opening tag runs to its glyph (an onClick arrow function holds a ">", so no tag-end regex).
    const tags = [...s.matchAll(/<PhotoArrowButton\b[\s\S]*?<Chevron/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(1);
    expect(tags.length).toBe(2);
    expect(tags[0]).toContain('aria-label="Previous photo"');
    expect(tags[0]).toContain('className="left-3"');
    expect(tags[1]).toContain('aria-label="Next photo"');
    expect(tags[1]).toContain('className="right-3"');
  });
});
