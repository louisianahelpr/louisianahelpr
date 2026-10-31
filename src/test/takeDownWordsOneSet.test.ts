/**
 * NIGHT-SELL-Sellinglist-1 (seller audit 10-30 #1): Manage > Delete listing said "can't be undone" while History then
 * offered Relist, and the row's Take down (the same declutter_withdraw_item) never said the photos go. Both sheets now
 * say the one TAKE_DOWN_WORDS. Behaviour of Delete: declutterManageListing.test.tsx; this checks both sheets use it.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | "Its photos are removed and it moves to your selling history." : TAKE_DOWN_WORDS} | "Its photos are removed and it moves to your selling history." : "Buyers can't see it any more."}
 * @mutate src/components/declutter/DeclutterManageListing.tsx |                 : TAKE_DOWN_WORDS} |                 : "This can't be undone."}
 * @mutate src/components/declutter/takeDownWords.ts | You can relist it from History, but you'll need new photos. | This can't be undone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { TAKE_DOWN_WORDS } from "@/components/declutter/takeDownWords";

const code = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("Sellinglist-1: Delete and Take down say the same thing", () => {
  it("the words say the photos go and Relist is in History, never 'can't be undone'", () => {
    expect(TAKE_DOWN_WORDS).toContain("Its photos are removed");
    expect(TAKE_DOWN_WORDS).toContain("You can relist it from History, but you'll need new photos.");
    expect(TAKE_DOWN_WORDS).not.toMatch(/can't be undone/);
  });

  it("both sheets show them", () => {
    const home = code("src/components/declutter/DeclutterHomeView.tsx");
    const manage = code("src/components/declutter/DeclutterManageListing.tsx");
    expect(home).toMatch(/testId="declutter-take-down"[\s\S]{0,400}: TAKE_DOWN_WORDS\}/);
    expect(manage).toMatch(/view === "sold"\s+\? "We'll take it off sale[^"]*"\s+: TAKE_DOWN_WORDS\}/);
    expect(manage).not.toMatch(/can't be undone/);
  });
});
