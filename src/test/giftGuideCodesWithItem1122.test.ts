/**
 * Codes go WITH the item (owner 2026-11-21 9:58 PM: "you can put the code with the item but no we dont need a long list
 * of codes on each guide only if we have a code should you put it with the items").
 *
 * On For Her, For Him and For Kids, a pick carries a code chip exactly when one of our codes works at the store its
 * link goes to (store match: the code's store name is the pick's store name), with the code's last day as codeEnds
 * (the card hides the chip after it). A code that works only somewhere else (Muck Boot's codes vs our Amazon MUCK link,
 * Therabody's DEAL codes vs our Ulta / Exclusive Beauty Club links) never shows. The pages show no list of codes: the
 * codes list lives only on the deals pages.
 * @mutate scripts/giftGuideOwnerAdds1122.mjs | const CAMP_SNAP_CODE = "LEXILOMBAS7"; | const CAMP_SNAP_CODE = undefined;
 * @mutate src/content/giftGuides.ts | code: "LEXI5", offer: "5% off; stacks with their sales", expires: "2026-12-12" | code: "LEXI15", offer: "5% off; stacks with their sales"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeCodes, discountCodes } from "@/content/giftGuides";
import { RESEARCHED_STORES } from "@/content/giftGuidePicks";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { HER_ADDS_1122 } from "../../scripts/giftGuideOwnerAdds1122.mjs";

type Pick = { name: string; href: string; store: string; code?: string; codeEnds?: string };
const GUIDES = ["her", "him", "kids"] as const;
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const storeName = (p: Pick) => RESEARCHED_STORES[p.store]?.name ?? "";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// The day the pages were built (codes that ended before it are already gone from the data).
const TODAY = "2026-11-22";

describe("codes ride with their item on Her, Him and Kids (owner 11-21)", () => {
  const picks = GUIDES.flatMap((g) => chunk(g).map((p) => ({ ...p, guide: g })));

  it("every pick whose store has one of our codes carries it, with the code's last day", () => {
    let matched = 0;
    for (const p of picks) {
      const codes = discountCodes.filter((c) => norm(c.store) === norm(storeName(p)) && (!c.expires || c.expires >= TODAY));
      if (!codes.length) continue;
      matched++;
      const live = activeCodes(codes, TODAY);
      expect(live.length, `${p.guide}: ${p.name}`).toBeGreaterThan(0);
      expect(p.code, `${p.guide}: ${p.name}`).toBe(live[0].code);
      expect(p.codeEnds, `${p.guide}: ${p.name}`).toBe(live[0].expires);
    }
    // Camp Snap (Her) and the two xtratuf.com boots (Him) at least.
    expect(matched).toBeGreaterThan(2);
  });

  it("no pick carries a code that does not work at its own store", () => {
    const coded = picks.filter((p) => p.code);
    expect(coded.length).toBeGreaterThan(2);
    for (const p of coded) {
      const c = discountCodes.find((d) => d.code === p.code && norm(d.store) === norm(storeName(p)));
      expect(c, `${p.guide}: ${p.name} (${p.code} at ${storeName(p)})`).toBeDefined();
    }
  });

  it("Camp Snap's LEXILOMBAS7 is on her Camp Snap pick (no end date), and XT25 on the xtratuf.com boots until Nov 29", () => {
    const her = chunk("her");
    const camp = her.find((p) => p.store === "store-camp-snap");
    expect(camp?.code).toBe("LEXILOMBAS7");
    expect(camp?.codeEnds).toBeUndefined();
    // The module too, so a generator change shows before the page is regenerated. Owner 11-22 PM ("Choose one" Camp
    // Snap): the CS-8 Micro keychain left the 11-21 Her module, so her Camp Snap rows (and their code) are the 11-22 adds.
    expect(HER_ADDS_1122.find((p) => p.store === "store-camp-snap")?.code).toBe("LEXILOMBAS7");
    const boots = chunk("him").filter((p) => p.store === "store-xtratuf");
    expect(boots.length).toBe(2);
    for (const b of boots) expect([b.code, b.codeEnds]).toEqual(["XT25", "2026-11-29"]);
    // A MUCK pick links Amazon, where Muck Boot's codes do not work.
    for (const p of chunk("him").filter((x) => /muck/i.test(x.name))) expect(p.code).toBeUndefined();
  });

  it("the three pages show no codes list (owner-list guides; the deals pages hold the codes)", () => {
    for (const g of GUIDES) expect(isOwnerList(g)).toBe(true);
    const view = blankComments(readFileSync("src/pages/info/giftGuides/GiftGuideView.tsx", "utf8"));
    expect(view).not.toMatch(/discountCodes|DEAL_CODES|codesOn\(/);
  });
});

describe("Club Recess: LEXI5 through Dec 12, LEXI15 from Dec 13 (ShopMy-codes-1121-night.md)", () => {
  it("shows the right code on each side of the switch", () => {
    const cr = discountCodes.filter((c) => c.store === "Club Recess");
    expect(activeCodes(cr, "2026-11-22").map((c) => c.code)).toEqual(["LEXI5"]);
    expect(activeCodes(cr, "2026-12-12").map((c) => c.code)).toEqual(["LEXI5"]);
    expect(activeCodes(cr, "2026-12-13").map((c) => c.code)).toEqual(["LEXI15"]);
  });
});
