/**
 * A category chip's label never breaks inside a word (owner, 2026-10-19, on
 * Post a Job at 320: the Handyman chip read "Handyma" / "n"). Measured at 320
 * (local build, real fonts): the label had 63px and "Handyman" needs 68.6px,
 * so `break-words` split it; "Appliance" (62.3) and "Carpentry" (61.8) sat
 * within a pixel of the same fate. The label now wraps only between words,
 * and below 360px the chip gives it room (24px icon, 8px gap, 6px side
 * padding). The pixel half is the chip measurement in the design-polish shot
 * run (~/.lh-shots/design-polish/chips-after: no label's longest word wider
 * than its box at 320 or 375).
 *
 * @mutate src/components/postjob/detailsSection/CategoryPicker.tsx | line-clamp-2 max-[359px]:line-clamp-3 break-normal hyphens-none text-ds-12 | line-clamp-2 max-[359px]:line-clamp-3 break-words text-ds-12
 * @mutate src/components/postjob/detailsSection/CategoryPicker.tsx | line-clamp-2 max-[359px]:line-clamp-3 break-normal | line-clamp-2 break-normal
 * @mutate src/components/postjob/detailsSection/CategoryPicker.tsx | gap-2.5 max-[359px]:gap-2 p-2 max-[359px]:px-1.5 text-left | gap-2.5 p-2 text-left
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(process.cwd(), "src/components/postjob/detailsSection/CategoryPicker.tsx"), "utf8"));
const label = SRC.match(/<span\s+className="font-sans font-semibold leading-tight line-clamp-2[^"]*"/)?.[0] ?? "";

describe("category chip labels never break inside a word", () => {
  it("the label wraps only between words", () => {
    expect(label.length, "the chip label span was not found").toBeGreaterThan(40);
    expect(label).toContain("break-normal");
    expect(label).not.toMatch(/break-words|break-all|overflow-wrap:anywhere|\bhyphens-auto\b/);
  });
  it("below 360px the label may take a third line (Auto & Small Engine is never cut)", () => {
    expect(label).toContain("max-[359px]:line-clamp-3");
  });
  it("below 360px the chip gives the label room (gap, side padding, icon)", () => {
    expect(SRC).toContain("gap-2.5 max-[359px]:gap-2 p-2 max-[359px]:px-1.5");
    expect(SRC).toContain("w-7 h-7 max-[359px]:w-6 max-[359px]:h-6");
  });
});
