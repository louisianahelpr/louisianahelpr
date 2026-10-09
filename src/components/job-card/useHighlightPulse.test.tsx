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

  it("Posts' job card opts out of the ring", () => {
    const src = readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8");
    expect(src).toContain("useHighlightPulse(highlight, cardRef, { ring: false });");
  });
});

// @mutate src/components/job-card/useHighlightPulse.ts |       if (!ring) return; |
