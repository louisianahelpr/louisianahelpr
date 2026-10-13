/**
 * The cmdk search field's focus ring is the FIELD's, inset, not the bare
 * input's (seen 2026-10-12 proving Q913, admin "Jump To" palette at 375 and
 * 1440): src/index.css's unlayered `:focus-visible` outline (2px, offset 2px)
 * beats the input's layered `outline-none`, so it drew around the text only,
 * leaving the search icon outside, and Command's `overflow-hidden` cut its top
 * edge off. The input now drops that outline with an !important utility (an
 * important layered declaration beats a normal unlayered one) and the wrapper
 * draws an inset ring on focus-within, which no overflow can clip.
 *
 * Inventory: every file that renders <CommandInput> goes through this one
 * primitive (floor 1: AdminCommandPalette), so the rule lives in one place.
 *
 * @mutate src/components/ui/command.tsx | outline-none focus-visible:!outline-none placeholder | outline-none placeholder
 * @mutate src/components/ui/command.tsx | focus-within:ring-inset | focus-within:ring-offset-0
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const PRIMITIVE = join(ROOT, "src/components/ui/command.tsx");

describe("cmdk search field: one inset focus ring around the whole field", () => {
  it("the input drops the global outline; the wrapper rings itself inset on focus-within", () => {
    const src = blankComments(readFileSync(PRIMITIVE, "utf8"));
    const input = src.match(/<CommandPrimitive\.Input[\s\S]*?className=\{cn\(\s*"([^"]+)"/);
    expect(input, "CommandPrimitive.Input className").not.toBeNull();
    expect(input![1].split(/\s+/)).toContain("focus-visible:!outline-none");
    const wrapper = src.match(/<div className="([^"]+)" cmdk-input-wrapper="">/);
    expect(wrapper, "cmdk-input-wrapper div").not.toBeNull();
    const cls = wrapper![1].split(/\s+/);
    expect(cls).toContain("focus-within:ring-2");
    expect(cls).toContain("focus-within:ring-inset");
  });

  it("every cmdk search field is the primitive (no raw CommandPrimitive.Input elsewhere)", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(300);
    const users = files.filter((f) => /<CommandInput\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(users.length).toBeGreaterThanOrEqual(1);
    const raw = files.filter((f) => f !== PRIMITIVE && /CommandPrimitive\.Input\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(raw.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
