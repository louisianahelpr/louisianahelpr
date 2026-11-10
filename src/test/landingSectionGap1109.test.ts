/**
 * L020 (landing audit 11-09): ~200px stood between "Four ways to get things done" and "How a job works" at 1440 (~115px
 * at 375): the sections block's bottom padding plus How it works' top padding. Below the hero only (the hero's own
 * space is locked, owner 10:33 PM). The gap (sections pb + how-it-works pt) is at most 96px on a phone and 144px from lg.
 *
 * @mutate src/components/landing/SectionsShowcase.tsx | pb-12 sm:pb-14 lg:pb-16 scroll-mt-24 | pb-16 sm:pb-20 lg:pb-28 scroll-mt-24
 * @mutate src/components/landing/HowItWorksSection.tsx | pt-12 sm:pt-16 lg:pt-20 pb-16 | py-16 sm:py-20 lg:py-28 pb-16
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", "components/landing", f), "utf8"));

/** Tailwind spacing px for `side` ("t" | "b") at a breakpoint prefix ("" | "sm:" | "lg:"), falling back to smaller ones. */
function pad(classes: string, side: "t" | "b", bp: "" | "sm:" | "lg:"): number {
  const order = bp === "lg:" ? ["lg:", "sm:", ""] : bp === "sm:" ? ["sm:", ""] : [""];
  for (const p of order) {
    const esc = p.replace(":", "\\:");
    const m = new RegExp(`(?:^|\\s)${esc}p(?:${side}|y)-(\\d+)(?=\\s|$)`).exec(classes);
    if (m) return Number(m[1]) * 4;
  }
  return 0;
}

describe("L020: the gap between the sections block and How it works is calm, not a hole", () => {
  it("at most 96px on a phone and 144px from lg", () => {
    const sections = /id="sections"[^>]*className="([^"]+)"/.exec(read("SectionsShowcase.tsx"))?.[1] ?? "";
    const how = /id="how-it-works"[\s\S]*?className="([^"]+)"/.exec(read("HowItWorksSection.tsx"))?.[1] ?? "";
    expect(sections.length).toBeGreaterThan(10);
    expect(how.length).toBeGreaterThan(10);
    expect(pad(sections, "b", "") + pad(how, "t", "")).toBeLessThanOrEqual(96);
    expect(pad(sections, "b", "lg:") + pad(how, "t", "lg:")).toBeLessThanOrEqual(144);
  });
});
