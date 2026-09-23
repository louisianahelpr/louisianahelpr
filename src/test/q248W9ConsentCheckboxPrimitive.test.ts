// PROVEN ABLE TO FAIL: reverting to a raw `<input type="checkbox">` in the
// W-9 consent block turns this red.
// @mutate src/components/W9CollectionDialog.tsx | <Checkbox\n              id="w9-consent" | <input\n              type="checkbox"

/**
 * Q248(c): the W-9 consent control uses the shared Checkbox primitive
 * (src/components/ui/checkbox — Radix, brand-token checked state, haptic),
 * not a raw hand-rolled `<input type="checkbox">`, while keeping the label
 * associated to it via matching htmlFor/id.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../components/W9CollectionDialog.tsx");

describe("Q248(c): W-9 consent uses the shared Checkbox primitive", () => {
  const src = readFileSync(FILE, "utf8");

  it("imports the shared Checkbox primitive", () => {
    expect(src).toMatch(/import\s*\{\s*Checkbox\s*\}\s*from\s*"@\/components\/ui\/checkbox"/);
  });

  it("has no raw <input type=\"checkbox\">", () => {
    expect(src).not.toMatch(/<input[^>]*type="checkbox"/);
  });

  it("renders <Checkbox> with an id, associated to its label via htmlFor", () => {
    const checkboxMatch = /<Checkbox\s+id="([^"]+)"/.exec(src);
    expect(checkboxMatch, "Checkbox with id= not found").toBeTruthy();
    const id = checkboxMatch![1];
    expect(src).toContain(`htmlFor="${id}"`);
  });
});
