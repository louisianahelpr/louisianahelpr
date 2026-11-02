/**
 * A CLOSED COLLAPSIBLE TAKES NO SPACE: NO DISPLAY CLASS ON <CollapsibleContent> (Q2656).
 *
 * Account audit 1102d row 16 (~/.lh-shots/audit-1102d-findings.md, h-settings-375.png): Settings' "Your profile link"
 * row stood 16px taller than every row beside it. Measured on a local build at 375 (~/.lh-shots/b179/walk-log.jsonl,
 * q2656-row): the row was 81px = its 64px trigger + the CLOSED panel at 16px. Radix keeps a closed
 * CollapsibleContent mounted with the `hidden` attribute, and the panel's own `flex` class beat the [hidden] rule,
 * so it rendered as an empty box with its `pb-4`. The CLASS: any display utility in a CollapsibleContent's
 * className does the same. Layout goes on an inner element instead.
 *
 * Inventory: every <CollapsibleContent> in src (tsx), comments blanked.
 */
// @mutate src/components/profile/ProfileLinkRow.tsx |       <CollapsibleContent id="profile-link-panel"> |       <CollapsibleContent id="profile-link-panel" className="px-4 pb-4 flex flex-col gap-3">
import { describe, it, expect } from "vitest";
import { resolve, relative } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DISPLAY = /(^|\s)(?:[a-z0-9-]+:)*(flex|inline-flex|grid|inline-grid|block|inline-block|inline|table|contents|flow-root)(?=\s|$)/;

const uses: { file: string; cls: string | null }[] = [];
for (const file of walkSource([resolve(ROOT, "src")], [".tsx"])) {
  if (/\.test\.tsx$/.test(file)) continue;
  const src = readSource(file);
  if (!src || !src.includes("CollapsibleContent")) continue;
  for (const m of blankComments(src).matchAll(/<CollapsibleContent\b([^>]*)>/g)) {
    const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(m[1]);
    uses.push({ file: relative(ROOT, file), cls: cls ? (cls[1] ?? cls[2]) : null });
  }
}

describe("CollapsibleContent carries no display class (Q2656)", () => {
  it("finds the app's collapsible panels (inventory floor)", () => {
    expect(uses.length).toBeGreaterThan(3);
  });
  it("no panel sets a display utility on itself", () => {
    const offenders = uses.filter((u) => u.cls && DISPLAY.test(u.cls)).map((u) => `${u.file}: "${u.cls}"`);
    expect(offenders).toEqual([]);
  });
});
