/**
 * Audit 11-10 F399: on the Selling tab the one-time "Turn on trades for all your listings?" card sat right under the
 * chips, above the sale to hand over, the offers and questions to answer and the listings, so the work that waits on
 * the seller started below the fold. It now comes after every to-do and list, just before the settings rows.
 *
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("taken") && <TakenDownSection items={takenDown} ended={ended} />}\n |       {only === null && <DeclutterTradesPrompt userId={userId} />}\n      {show("taken") && <TakenDownSection items={takenDown} ended={ended} />}\n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterMineViews.tsx"), "utf8"));
const body = src.slice(src.indexOf("export function SellingDash"));
const at = (needle: string) => {
  const i = body.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe("F399: Selling's to-dos come before the trades card", () => {
  const work = [
    "{soldFirst && sold}",
    "<QuestionsToAnswer",
    "<FreeAsksToPick",
    "<BundleRequestsSection",
    "<TradeOffersSection",
    "<OffersSection",
    '{show("listings") && listings}',
    "<SalesWaiting",
    "{!soldFirst && sold}",
    "<TakenDownSection",
  ];
  it.each(work)("the trades card is drawn after %s", (needle) => {
    expect(body.split("<DeclutterTradesPrompt").length - 1).toBe(1);
    expect(at("<DeclutterTradesPrompt")).toBeGreaterThan(at(needle));
  });
  it("checks every to-do and list on the tab", () => {
    expect(work.length).toBeGreaterThan(9);
  });
});
