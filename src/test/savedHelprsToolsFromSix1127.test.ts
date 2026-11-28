/**
 * Polish audit 11-27 #133 (tools half): Saved Helprs showed Filter + Sort (+ Search) for 2 people. Filter and Sort now
 * show from SAVED_TOOLS_FROM (6) saved Helprs, and always while a filter is on (so it can be cleared); the "N saved"
 * readout stays on the row either way.
 *
 * @mutate src/components/profile/SavedHelpersTab.tsx | const SAVED_TOOLS_FROM = 6; | const SAVED_TOOLS_FROM = 0;
 * @mutate src/components/profile/SavedHelpersTab.tsx |               {(helpers.length >= SAVED_TOOLS_FROM \|\| !!categoryFilter) && (<> |               {(true) && (<>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const tab = blankComments(readFileSync("src/components/profile/SavedHelpersTab.tsx", "utf8"));

describe("Saved Helprs: Filter and Sort only once there are enough to sort (#133)", () => {
  it("is not vacuous: both popovers and the readout are found", () => {
    expect(tab.match(/<Popover>/g)).toHaveLength(2);
    expect(tab).toContain("{countLabel}");
  });

  it("the threshold is six", () => {
    expect(tab).toContain("const SAVED_TOOLS_FROM = 6;");
  });

  it("both popovers sit inside the threshold gate; the readout does not", () => {
    const gate = tab.indexOf("{(helpers.length >= SAVED_TOOLS_FROM || !!categoryFilter) && (<>");
    const end = tab.indexOf("</>)}", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(gate);
    const inside = tab.slice(gate, end);
    expect(inside.match(/<Popover>/g)).toHaveLength(2);
    expect(tab.indexOf("{countLabel}")).toBeGreaterThan(end);
  });
});
