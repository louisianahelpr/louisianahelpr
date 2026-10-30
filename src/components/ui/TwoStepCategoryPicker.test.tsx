/**
 * The shared two-step category picker: subs stay hidden until their main is
 * tapped, one expanded main collapses the other, choosing a sub sets the SAME
 * slug the old grouped <select> stored.
 *
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx |                {isOpen && ( |                {true && (
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | setExpanded(isOpen ? null : g.slug) | setExpanded(g.slug)
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | onChange(c.slug); | onChange(g.slug);
 *
 * Tester 10-30: the panel's own 60vh scroll sat inside the Wanted sheet's scroll and ran 5px past the screen; wrapped
 * rows touched. One scroller (the sheet or page around it), the expanded main brought into view, and rows with room.
 * Measured in a browser at 375 and 1440 (~/.lh-shots/b27-picker): this DOM has no layout, so these pin the causes.
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | className={`mt-1 rounded-md | className={`mt-1 max-h-[60vh] overflow-y-auto rounded-md
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | (expandedRef.current ?? panelRef.current)?.scrollIntoView?.({ block: "nearest" }); |
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | ref={isOpen ? expandedRef : undefined} |
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | rounded px-3 py-2 text-left text-base sm:text-sm ctl-tint | rounded px-3 text-left text-base sm:text-sm ctl-tint
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TwoStepCategoryPicker } from "./TwoStepCategoryPicker";

const groups: Parameters<typeof TwoStepCategoryPicker>[0]["groups"] = [
  { slug: "food", label: "Food to order", items: [{ slug: "baking", label: "Baking" }, { slug: "bbq", label: "BBQ" }] },
  { slug: "trades", label: "Trades", items: [{ slug: "plumbing", label: "Plumbing" }] },
];

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [v, setV] = useState("");
  return <TwoStepCategoryPicker id="c" value={v} groups={groups} onChange={(s) => { setV(s); onChange(s); }} />;
}

describe("TwoStepCategoryPicker", () => {
  it("shows only main categories until one is tapped, and only one expands at a time", () => {
    render(<Harness onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /choose a category/i }));
    expect(screen.getByRole("button", { name: "Food to order" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Baking")).toBeNull();
    expect(screen.queryByText("Plumbing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Food to order" }));
    expect(screen.getByText("Baking")).toBeTruthy();
    expect(screen.queryByText("Plumbing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(screen.getByText("Plumbing")).toBeTruthy();
    expect(screen.queryByText("Baking")).toBeNull();
    expect(screen.getByRole("button", { name: "Food to order" })).toHaveAttribute("aria-expanded", "false");
  });

  it("sets the sub's own slug, closes, and shows Main › Sub on the trigger", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /choose a category/i }));
    fireEvent.click(screen.getByRole("button", { name: "Food to order" }));
    fireEvent.click(screen.getByRole("button", { name: "BBQ" }));
    expect(onChange).toHaveBeenCalledWith("bbq");
    expect(screen.queryByText("Baking")).toBeNull();
    expect(screen.getByRole("button", { name: "Food to order › BBQ" })).toHaveAttribute("aria-expanded", "false");
  });

  describe("in a scrolling sheet or page", () => {
    const original = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    it("the panel never scrolls by itself", () => {
      render(<Harness onChange={() => {}} />);
      const trigger = screen.getByRole("button", { name: /choose a category/i });
      fireEvent.click(trigger);
      const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
      expect(panel.className).not.toMatch(/max-h|overflow-/);
    });

    it("expanding a main brings that main with all its subs into view", () => {
      const seen: { el: Element; options: unknown }[] = [];
      Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
        seen.push({ el: this, options });
      };
      render(<Harness onChange={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: /choose a category/i }));
      fireEvent.click(screen.getByRole("button", { name: "Food to order" }));
      const last = seen[seen.length - 1];
      expect(last.options).toEqual({ block: "nearest" });
      expect(last.el.contains(screen.getByRole("button", { name: "Food to order" }))).toBe(true);
      expect(last.el.contains(screen.getByRole("button", { name: "BBQ" }))).toBe(true);
      expect(last.el.contains(screen.getByRole("button", { name: "Trades" }))).toBe(false);
    });

    it("a sub row that wraps keeps a gap from the next row", () => {
      render(<Harness onChange={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: /choose a category/i }));
      fireEvent.click(screen.getByRole("button", { name: "Food to order" }));
      expect(screen.getByRole("button", { name: "Baking" }).className).toContain("py-2");
    });
  });
});
