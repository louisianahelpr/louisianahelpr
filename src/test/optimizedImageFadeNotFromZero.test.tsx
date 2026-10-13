/**
 * Q1172: OptimizedImage's `fadeIn` (job photos on the card strip and the job
 * detail cover) started each image at opacity 0. Chrome's Largest Contentful
 * Paint does not count an element painted at opacity 0, so a photo that is the
 * largest thing on screen was reported only when its fade finished: the same
 * paint-timing class as Q1158's page fades (ds-page-in, since removed). The
 * fade now starts at 0.01, which reads as invisible and counts as painted.
 *
 * Inventory: every caller that passes `fadeIn` is found from source, so a new
 * fading surface is covered by the same rule (the rule lives in one place).
 *
 * @mutate src/components/ui/optimized-image.tsx | opacity: loaded ? 1 : 0.01, | opacity: loaded ? 1 : 0,
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

describe("OptimizedImage fadeIn never paints its first frame at opacity 0 (Q1172)", () => {
  it("the first frame is visible to LCP (opacity > 0), the loaded frame is opaque", () => {
    render(<OptimizedImage src="https://example.com/a.jpg" alt="Job photo" width={512} height={288} fadeIn />);
    const img = screen.getByAltText("Job photo");
    const first = Number.parseFloat(img.style.opacity);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.05);
    fireEvent.load(img);
    expect(img.style.opacity).toBe("1");
  });

  it("every fadeIn caller goes through OptimizedImage (the one place the rule lives)", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(300);
    const callers = files.filter((f) => /<OptimizedImage\b[^>]*\bfadeIn\b/s.test(blankComments(readFileSync(f, "utf8"))));
    // Floor: the job-card photo strip and the job detail cover fade today.
    expect(callers.length).toBeGreaterThanOrEqual(2);
    const src = blankComments(readFileSync(join(ROOT, "src/components/ui/optimized-image.tsx"), "utf8"));
    expect(src).not.toMatch(/opacity:\s*loaded\s*\?\s*1\s*:\s*0\s*[,}]/);
  });
});
