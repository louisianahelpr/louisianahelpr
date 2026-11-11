/**
 * F436 (whole-app audit 2026-11-10, Suggestion): tapping "Hallie H. has arrived" in the bell opened /posts?job=<id>,
 * which scrolled to the job but marked nothing, so a first-timer "landed in a long list and did not know where my
 * notice went". The orange ring stays off Posts (owner, 2026-10-09: it read as an error); instead the card gets a soft
 * olive wash that fades away by itself (`.highlight-soft`), no outline, nothing left on screen with Reduce Motion.
 * @mutate src/components/job-card/useHighlightPulse.ts | const cls = ring ? "highlight-pulse" : "highlight-soft"; | const cls = ring ? "highlight-pulse" : "";
 * @mutate src/index.css | .highlight-soft {\n  animation: highlight-soft-fade | .highlight-soft {\n  outline: 1.5px solid hsl(var(--burnt-sienna) / 0.35);\n  animation: highlight-soft-fade
 */
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useHighlightPulse } from "@/components/job-card/useHighlightPulse";

function Card() {
  const ref = useRef<HTMLDivElement>(null);
  useHighlightPulse(true, ref, { ring: false });
  return <div ref={ref} data-testid="card" />;
}

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start) + 1);
}

describe("F436: a deep-linked Posts card flashes softly, never the orange ring", () => {
  it("ring: false still marks the card, with the soft class, not the ring", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { getByTestId } = render(<Card />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const el = getByTestId("card");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(el.classList.contains("highlight-soft")).toBe(true);
    expect(el.classList.contains("highlight-pulse")).toBe(false);
    el.dispatchEvent(new Event("animationend"));
    expect(el.classList.contains("highlight-soft")).toBe(false);
  });

  it("the soft flash is an olive wash that fades: no outline, no burnt sienna, nothing static under Reduce Motion", () => {
    const css = readFileSync("src/index.css", "utf8");
    const rule = cssBlock(css, ".highlight-soft");
    expect(rule).toMatch(/animation: highlight-soft-fade/);
    expect(rule).not.toMatch(/outline|burnt-sienna/);
    const kf = css.slice(css.indexOf("@keyframes highlight-soft-fade"), css.indexOf("}", css.indexOf("100%", css.indexOf("@keyframes highlight-soft-fade"))) + 1);
    expect(kf).toMatch(/--bark/);
    expect(kf).toMatch(/100%\s*\{\s*background-color: transparent;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.highlight-soft \{\s*animation: none;\s*\}/);
  });
});
