/**
 * A category chip's label never breaks inside a word (owner, 2026-10-19, on
 * Post a Job at 320: the Handyman chip read "Handyma" / "n"). The Post a Job
 * category picker is now board 23's groups + chips (JobCategoryGroups.tsx,
 * builder2-jobs 2026-10-20); its group tiles and its chips both wrap only
 * between words. The chip class is the shared one (src/components/ui/chipClasses.ts,
 * builder2b-jobs 2026-10-20), so every chip row inherits the rule.
 *
 * @mutate src/components/ui/chipClasses.ts | leading-tight break-normal hyphens-none text-left transition-transform | leading-tight break-words text-left transition-transform
 * @mutate src/components/postjob/JobCategoryGroups.tsx | font-semibold leading-tight break-normal hyphens-none transition-transform | font-semibold leading-tight break-all transition-transform
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(process.cwd(), "src/components/postjob/JobCategoryGroups.tsx"), "utf8"));
const CHIPS = blankComments(readFileSync(join(process.cwd(), "src/components/ui/chipClasses.ts"), "utf8"));
const CHIP = CHIPS.match(/export const CHIP =\s*"([^"]+)"/)?.[1] ?? "";
const TILE = SRC.match(/className=\{`flex min-h-12[^`]*`\}/)?.[0] ?? "";

describe("category chip labels never break inside a word", () => {
  it("found the chip and the group tile classes", () => {
    expect(CHIP.length, "the chip class was not found").toBeGreaterThan(40);
    expect(TILE.length, "the group tile class was not found").toBeGreaterThan(40);
  });
  it("the chip label wraps only between words", () => {
    expect(CHIP).toContain("break-normal");
    expect(CHIP).not.toMatch(/break-words|break-all|\bhyphens-auto\b/);
  });
  it("the group tile label wraps only between words", () => {
    expect(TILE).toContain("break-normal");
    expect(TILE).not.toMatch(/break-words|break-all|\bhyphens-auto\b/);
  });
});
