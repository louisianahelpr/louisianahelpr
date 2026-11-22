// @mutate src/content/giftGuides.ts | sidebarLabel: "Holiday Gift Guides" | sidebarLabel: "Gift guides"
// @mutate src/lib/giftGuidePageMeta.mjs | title: "Holiday gift guides — Helpr" | title: "Gift guides — Helpr"
// @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx | — Helpr`; | — Louisiana Helpr`;
// @mutate src/lib/i18n/enPublic.ts | "footer.contact": "Contact support" | "footer.contact": "Contact us"
/**
 * Guides polish audit 1122 #25: one feature, one name. The side menu's name ("Holiday Gift Guides") is the menu
 * sheet's title and the sidebar's label, every gift-guide tab ends " — Helpr" (the wish list's said "— Louisiana
 * Helpr"), and the footer's "Contact us" is named for the page it opens ("Contact support").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { giftGuides } from "@/content/giftGuides";
import { publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";

const read = (p: string) => readFileSync(p, "utf8");

describe("one feature name and one tab ending (audit 1122 #25)", () => {
  it("the menu sheet and the sidebar use the side menu's name", () => {
    expect(giftGuides.sidebarLabel).toBe("Holiday Gift Guides");
  });
  it("an unknown guide's tab and the wish-list tabs end ' — Helpr'", () => {
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/nope", null).title).toBe("Holiday gift guides — Helpr");
    expect(read("src/pages/info/giftGuides/GiftGuideSharedList.tsx")).not.toContain("— Louisiana Helpr");
    expect(read("src/pages/info/GiftGuides.tsx")).not.toContain("— Louisiana Helpr");
    expect(PUBLIC_PAGE_META["/gift-guides"].title).toMatch(/ — Helpr$/);
  });
  it("the footer link says what its page is called", () => {
    expect(read("src/lib/i18n/enPublic.ts")).toContain('"footer.contact": "Contact support"');
    expect(PUBLIC_PAGE_META["/support"].title).toBe("Contact support — Helpr");
  });
});
