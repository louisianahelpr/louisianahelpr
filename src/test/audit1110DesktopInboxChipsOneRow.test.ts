/**
 * Audit 11-10 W5 F483: on the desktop website the Messages filter chips (All / Unread / Jobs / Declutter) wrapped onto a
 * second line inside the ~327px inbox pane at 1440. Desktop chips now wear tighter horizontal padding (0.7rem instead of
 * the phone's 0.95rem) and a smaller gap, so the four share one row. Source-scan: the desktop rule exists and is tighter.
 *
 * @mutate src/index.css | html.web-desktop .chip-row > button {\n  padding: 0 0.7rem !important; | html.web-desktop .chip-row > button {\n  padding: 0 0.95rem !important;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const css = blankCssComments(readFileSync(join(__dirname, "..", "index.css"), "utf8"));

function sidePaddingRem(block: string): number {
  const m = /padding:\s*0\s+([\d.]+)rem/.exec(block);
  if (!m) throw new Error(`no "padding: 0 Xrem" in: ${block}`);
  return Number(m[1]);
}

describe("F483: desktop inbox filter chips share one row", () => {
  it("the desktop chip rule pads tighter than the phone chip rule", () => {
    const phone = /\.category-chip-row > button,\s*\.chip-row > button \{([^}]*)\}/.exec(css);
    const desktop = /html\.web-desktop \.chip-row > button \{([^}]*)\}/.exec(css);
    expect(phone, "phone chip rule").toBeTruthy();
    expect(desktop, "desktop chip rule").toBeTruthy();
    const phonePad = sidePaddingRem(phone![1]);
    const desktopPad = sidePaddingRem(desktop![1]);
    expect(desktopPad).toBeLessThanOrEqual(0.75);
    expect(desktopPad).toBeLessThan(phonePad);
    expect(desktop![1]).toContain("!important");
  });
  it("the desktop row's gap is tighter than the phone row's", () => {
    const desktopRow = /html\.web-desktop \.chip-row \{([^}]*)\}/.exec(css);
    expect(desktopRow).toBeTruthy();
    expect(desktopRow![1]).toMatch(/gap:\s*0\.375rem !important/);
  });
});
