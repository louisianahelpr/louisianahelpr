/**
 * Posts scrolls to a deep-linked job WITHOUT the orange ring (owner,
 * 2026-10-09: "i dont like the orange outline that shows after the job is
 * posted"). View Applicants on Payment Authorized opens /posts?job=<new id>;
 * the card used to get `.highlight-pulse`, a burnt-sienna outline that, with
 * Reduce Motion on, never animated away. Applied cards keep the pulse.
 */
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useHighlightPulse } from "./useHighlightPulse";

function Card({ ring }: { ring?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useHighlightPulse(true, ref, ring === undefined ? undefined : { ring });
  return <div ref={ref} data-testid="card" />;
}

async function mount(ring?: boolean) {
  Element.prototype.scrollIntoView = vi.fn();
  const { getByTestId } = render(<Card ring={ring} />);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  return getByTestId("card");
}

describe("useHighlightPulse", () => {
  it("ring: false scrolls to the card and paints no ring", async () => {
    const el = await mount(false);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(el.classList.contains("highlight-pulse")).toBe(false);
  });

  it("the default still pulses (applied cards)", async () => {
    const el = await mount();
    expect(el.classList.contains("highlight-pulse")).toBe(true);
  });

  // Audit 11-21 (S40): the card a notification opened is marked for 2 s (a static olive ring that Reduce Motion keeps)
  // and takes focus.
  it("the deep-linked card wears the ring for 2 seconds and takes focus", async () => {
    const el = await mount(false);
    expect(el.hasAttribute("data-deep-linked")).toBe(true);
    expect(document.activeElement).toBe(el);
    expect(el.getAttribute("tabindex")).toBe("-1");
    await new Promise((r) => setTimeout(r, 2100));
    expect(el.hasAttribute("data-deep-linked")).toBe(false);
  });

  it("the ring is a static style (no animation), so Reduce Motion still shows it", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/html \[data-deep-linked\]::after \{[^}]*border: 2px solid hsl\(var\(--bark\) \/ 0\.55\);[^}]*pointer-events: none;/);
    expect(css).not.toMatch(/\[data-deep-linked\][^{]*\{[^}]*animation/);
  });

  it("Posts' job card opts out of the ring", () => {
    const src = readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8");
    expect(src).toContain("useHighlightPulse(highlight, cardRef, { ring: false });");
  });
});

// @mutate src/components/job-card/useHighlightPulse.ts | const cls = ring ? "highlight-pulse" : "highlight-soft"; | const cls = "highlight-pulse";
// @mutate src/components/job-card/useHighlightPulse.ts |       el.setAttribute("data-deep-linked", ""); |       void 0;
// @mutate src/components/job-card/useHighlightPulse.ts |       el.focus({ preventScroll: true }); |       void 0;
