import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { statValueSize } from "./statValueSize";

// Q179: a word in a stat tile overflowed at the numeral display size.
// @mutate src/lib/statValueSize.ts | : "text-ds-16 text-balance [overflow-wrap:break-word]"; | : "text-ds-28 tabular-nums";
// @mutate src/pages/profile/HelprWrapped.tsx | className={`${statValueSize(value)} font-sans | className={`text-ds-28 font-sans

describe("statValueSize (Q179)", () => {
  it("keeps numerals at the display size", () => {
    for (const v of ["165", "$1,255", "4.9", "22"]) expect(statValueSize(v)).toContain("text-ds-28");
  });

  it("never sets a word at the numeral size", () => {
    for (const v of ["Cleaning", "Moving help", "Handyman"]) {
      expect(statValueSize(v)).not.toContain("text-ds-28");
      expect(statValueSize(v)).toContain("[overflow-wrap:break-word]");
    }
  });

  it("Wrapped's stat tile sizes its value through it", () => {
    const src = readFileSync("src/pages/profile/HelprWrapped.tsx", "utf8");
    expect(src).toMatch(/className=\{`\$\{statValueSize\(value\)\} font-sans/);
    expect(src).not.toMatch(/text-ds-28 font-sans font-bold tabular-nums/);
  });
});
