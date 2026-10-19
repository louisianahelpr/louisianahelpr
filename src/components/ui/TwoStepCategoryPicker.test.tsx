/**
 * The shared two-step category picker: subs stay hidden until their main is
 * tapped, one expanded main collapses the other, choosing a sub sets the SAME
 * slug the old grouped <select> stored.
 *
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx |                {isOpen && ( |                {true && (
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | setExpanded(isOpen ? null : g.slug) | setExpanded(g.slug)
 * @mutate src/components/ui/TwoStepCategoryPicker.tsx | onChange(c.slug); | onChange(g.slug);
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
});
