/**
 * Audit BUY-34: the review stars are role="radio", so they move with the arrow keys and are one Tab stop, as a screen
 * reader's user is told. Shared by Jobs' reviews and Declutter's.
 *
 * @mutate src/components/reviewPanel/StarRow.tsx |       onKeyDown={onKeyDown}\n |
 * @mutate src/components/reviewPanel/StarRow.tsx |             tabIndex={s === (value \|\| 1) ? 0 : -1}\n |
 * @mutate src/components/reviewPanel/StarRow.tsx |     pick(((value \|\| (step > 0 ? 0 : 1)) + step + 4) % 5 + 1); |     pick(value);
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import { StarRow } from "./StarRow";

function Row({ start = 0 }: { start?: number }) {
  const [v, setV] = useState(start);
  return <StarRow value={v} onChange={setV} label="Stars" />;
}
const star = (n: number) => screen.getByRole("radio", { name: `${n} star${n > 1 ? "s" : ""}` });
const tabStops = () => screen.getAllByRole("radio").filter((r) => r.getAttribute("tabindex") === "0");

describe("StarRow keys", () => {
  it("one Tab stop: the first star before a pick, then the picked one", () => {
    render(<Row />);
    expect(tabStops()).toEqual([star(1)]);
    fireEvent.click(star(3));
    expect(tabStops()).toEqual([star(3)]);
  });

  it.each([
    ["ArrowRight", 3, 4],
    ["ArrowUp", 3, 4],
    ["ArrowLeft", 3, 2],
    ["ArrowDown", 3, 2],
    ["ArrowRight", 5, 1],
    ["ArrowLeft", 1, 5],
    ["ArrowRight", 0, 1],
    ["ArrowLeft", 0, 5],
  ])("%s from %i picks %i and moves focus there", (key, from, to) => {
    render(<Row start={from} />);
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Stars" }), { key });
    expect(star(to)).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(star(to));
  });

  it("any other key picks nothing", () => {
    render(<Row start={2} />);
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Stars" }), { key: "a" });
    expect(star(2)).toHaveAttribute("aria-checked", "true");
  });

  it("Declutter's review form uses this row, not its own", () => {
    const src = readFileSync(resolve(__dirname, "../declutter/DeclutterReviewForm.tsx"), "utf8");
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("<StarRow ");
    expect(src).not.toContain('role="radio"');
  });
});
