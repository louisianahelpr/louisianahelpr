/**
 * NIGHT-SELL-Sellinglist-1 (seller audit 10-30 #1): Manage > Delete listing said "can't be undone" while History then
 * offered Relist, and the row's Take down (the same declutter_withdraw_item) never said the photos go. Both sheets now
 * say the same words. Behaviour of Delete: declutterManageListing.test.tsx; this checks both sheets use them.
 * F260q: the words are dictionary words now. Selling's sheet reads enDeclutter (decl.sl.takeDownWords), Manage listing
 * reads enListingParts (lp.m.takeDownWords): two chunks, so two keys, held equal in both languages here.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | t("decl.sl.draftWords") : t("decl.sl.takeDownWords")} | t("decl.sl.draftWords") : "Buyers can't see it any more."}
 * @mutate src/components/declutter/DeclutterManageListing.tsx |                 : t("lp.m.takeDownWords")} |                 : "This can't be undone."}
 * @mutate src/lib/i18n/enListingParts.ts | "lp.m.takeDownWords": "Its photos are removed and open offers close. Nothing is charged. You can relist it from History, but you'll need new photos.", | "lp.m.takeDownWords": "Its photos are removed. This can't be undone.",
 * @mutate src/lib/i18n/esDeclutter.ts | Puede volver a publicarlo desde Historial, pero necesitará fotos nuevas." | No se puede deshacer."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { enDeclutter } from "@/lib/i18n/enDeclutter";
import { esDeclutter } from "@/lib/i18n/esDeclutter";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";

const code = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("Sellinglist-1: Delete and Take down say the same thing", () => {
  it("the words say the photos go and Relist is in History, never 'can't be undone'", () => {
    const words = enListingParts["lp.m.takeDownWords"];
    expect(words).toContain("Its photos are removed");
    expect(words).toContain("You can relist it from History, but you'll need new photos.");
    expect(words).not.toMatch(/can't be undone/);
  });

  it("one set of words in each language, whichever sheet says them", () => {
    expect(enDeclutter["decl.sl.takeDownWords"]).toBe(enListingParts["lp.m.takeDownWords"]);
    expect(esDeclutter["decl.sl.takeDownWords"]).toBe(esListingParts["lp.m.takeDownWords"]);
    expect(esListingParts["lp.m.takeDownWords"]).toContain("Historial");
  });

  it("both sheets show them", () => {
    const home = code("src/components/declutter/DeclutterHomeView.tsx");
    const manage = code("src/components/declutter/DeclutterManageListing.tsx");
    expect(home).toMatch(/testId="declutter-take-down"[\s\S]{0,400}: t\("decl\.sl\.takeDownWords"\)\}/);
    expect(manage).toMatch(/view === "sold"\s+\? t\("lp\.m\.soldWords"\)\s+: t\("lp\.m\.takeDownWords"\)\}/);
    expect(manage).not.toMatch(/can't be undone/);
  });
});
