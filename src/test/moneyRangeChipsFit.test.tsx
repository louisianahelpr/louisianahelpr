/**
 * THE MONEY RANGE ROW FITS AT 320 AND 375 (audit 2026-10-28 P4-3).
 *
 * The bug: Money > Earned's "Lifetime / This week / This month / This year" row
 * (EarningsRangeToggle, also the Spent card's row) needs a 324px track at the
 * default text size; the card gives it 299px at 375 and 244px at 320, so the
 * row scrolled and "This year" sat cut to "This ye" at the card's edge
 * (measured on prod as helper-e2e: track scrollWidth 324 in clientWidth 299).
 *
 * The fix, read from source here (a layout cannot be measured in jsdom):
 *   1. the row sits in its own container (.range-cq) and swaps each option's
 *      full name for a short word below a 324px track, with 8px pill sides;
 *   2. the full name stays the option's accessible name at every width.
 * Measured after the fix (local dev server, helper-e2e, Chromium): track
 * scrollWidth = clientWidth at 320 (244/244), 375 (299/299) and 1440
 * (1100/1100, full names), document 320/375/1440 with no overflow. Senior Mode
 * (14px) still scrolls by 10px at 320 and fits at 375.
 * Shots: ~/.lh-shots/b9-p4/{before,after}/.
 *
 * @mutate src/index.css | .range-cq { container-type: inline-size; } | .range-cq { }
 * @mutate src/index.css | .range-label-full { display: none; } | .range-label-short { display: none; }
 * @mutate src/index.css | .range-cq .segmented-option { padding-left: 0.5rem; padding-right: 0.5rem; } | .range-cq .segmented-option { padding-left: 0.75rem; padding-right: 0.75rem; }
 * @mutate src/components/profile/earningsTab/EarningsRangeToggle.tsx |     <div className="range-cq"> |     <div>
 * @mutate src/components/profile/earningsTab/EarningsRangeToggle.tsx |   { value: "year", label: "This year", short: "Year" }, |   { value: "year", label: "This year", short: "This year" },
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { blankCssComments } from "./helpers/blankNonCode";
import { EarningsRangeToggle } from "@/components/profile/earningsTab/EarningsRangeToggle";

const css = () => blankCssComments(readFileSync(join(process.cwd(), "src/index.css"), "utf8"));

/** The declarations of `selector` at top level (container === null) or inside `@container (<container>)`. */
function ruleBody(src: string, selector: string, container: string | null): string | null {
  const scope = container === null ? src.replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "") : [...src.matchAll(/@container\s*\(([^)]*)\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)]
    .filter((m) => m[1].replace(/\s+/g, " ").trim() === container)
    .map((m) => m[2])
    .join("\n");
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = scope.match(new RegExp(`(^|[\\s}])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[2].replace(/\s+/g, " ").trim() : null;
}

/** The full-name row's measured width at the default text size (Chromium, 12px sides). */
const FULL_ROW_PX = 324;

describe("Money range row fits at 320 and 375 (P4-3)", () => {
  it("index.css: short words with 8px sides below a 324px track, full names with 12px sides from 324px", () => {
    const s = css();
    expect(ruleBody(s, ".range-cq", null)).toBe("container-type: inline-size;");
    expect(ruleBody(s, ".range-label-full", null)).toBe("display: none;");
    expect(ruleBody(s, ".range-label-short", null)).toBeNull();
    expect(ruleBody(s, ".range-cq .segmented-option", null)).toBe("padding-left: 0.5rem; padding-right: 0.5rem;");
    const at = `min-width: ${FULL_ROW_PX}px`;
    expect(ruleBody(s, ".range-label-short", at)).toBe("display: none;");
    expect(ruleBody(s, ".range-label-full", at)).toBe("display: inline;");
    expect(ruleBody(s, ".range-cq .segmented-option", at)).toBe("padding-left: 0.75rem; padding-right: 0.75rem;");
  });

  it("the row sits in the container; each option has a short word and keeps its full name as its accessible name", () => {
    const { container } = render(<EarningsRangeToggle value="lifetime" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Earnings date range" });
    expect(group.parentElement?.classList.contains("range-cq")).toBe(true);
    const radios = within(group).getAllByRole("radio");
    // Inventory floor: the four ranges.
    expect(radios.length).toBeGreaterThan(3);
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["Lifetime", "This week", "This month", "This year"]);
    const shorts = [...container.querySelectorAll(".range-label-short")].map((e) => e.textContent);
    const fulls = [...container.querySelectorAll(".range-label-full")].map((e) => e.textContent);
    expect(shorts).toEqual(["Week", "Month", "Year"]);
    expect(fulls).toEqual(["This week", "This month", "This year"]);
    // A short word is shorter than its full name, or the swap buys nothing.
    shorts.forEach((t, i) => expect((t ?? "").length).toBeLessThan((fulls[i] ?? "").length));
  });
});
