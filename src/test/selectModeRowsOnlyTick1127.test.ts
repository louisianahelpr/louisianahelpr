/**
 * Polish audit 11-27 #129: Selling's Select (bulk) mode kept every per-row action (the Manage chevron, haul actions,
 * the saver-offer line) beside the new checkbox. Now a tickable row in Select mode shows only the checkbox, photo,
 * title and price; the bottom bulk bar acts on it, and the row's own actions come back on Done.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx |           const picking = bulk.selecting && bulkPickable(item); |           const picking = false;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |               {!picking && (\n              <div className={oneControl | {(\n              <div className={oneControl
 * @mutate src/components/declutter/DeclutterHomeView.tsx |             {!picking && <SaverOfferLine | {<SaverOfferLine
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const view = blankComments(readFileSync("src/components/declutter/DeclutterHomeView.tsx", "utf8"));

describe("Select mode: a tickable row shows only the tick and the listing (#129)", () => {
  const row = view.slice(view.indexOf('data-listing-row=""'), view.indexOf("</li>", view.indexOf('data-listing-row=""')));

  it("is not vacuous: the Selling row, its bulk tick and its actions are found", () => {
    expect(row.length).toBeGreaterThan(2000);
    expect(row).toContain("<BulkPick item={item} selecting={bulk.selecting}");
    expect(row).toContain('data-listing-actions=""');
    expect(row).toContain("<SaverOfferLine");
  });

  it("picking is the bulk mode on a tickable row (the same rule the tick uses)", () => {
    expect(view).toContain("const picking = bulk.selecting && bulkPickable(item);");
  });

  it("the actions, haul line and saver-offer line wait while picking", () => {
    const actionsAt = row.indexOf('data-listing-actions=""');
    expect(row.slice(Math.max(0, actionsAt - 140), actionsAt)).toContain("{!picking && (");
    expect(row).toMatch(/\{haulOn && !picking && <HaulAwayItemLine/);
    expect(row).toContain("{!picking && <SaverOfferLine");
  });
});
