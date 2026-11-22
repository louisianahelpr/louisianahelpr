// @mutate src/content/giftGuides.ts | sidebarLabel: "Holiday gift guides" | sidebarLabel: "Gift guides"
// @mutate src/lib/giftGuidePageMeta.mjs | title: "Holiday gift guides — Helpr" | title: "Gift guides — Helpr"
// @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx | — Helpr`; | — Louisiana Helpr`;
// @mutate src/components/DesktopSidebarNav.tsx | label: "Holiday gift guides" | label: "Holiday Gift Guides"
// @mutate src/components/Navbar.tsx |                 Holiday gift guides\n              </Link> |                 Holiday Gift Guides\n              </Link>
// @mutate src/lib/i18n/enPublic.ts | "footer.contact": "Contact support" | "footer.contact": "Contact us"
/**
 * Guides polish audit 1122 #25: one feature, one name. The side menu's name ("Holiday gift guides") is the menu
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
    expect(giftGuides.sidebarLabel).toBe("Holiday gift guides");
  });
  it("an unknown guide's tab and the wish-list tabs end ' — Helpr'", () => {
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/nope", null)?.title).toBe("Holiday gift guides — Helpr");
    expect(read("src/pages/info/giftGuides/GiftGuideSharedList.tsx")).not.toContain("— Louisiana Helpr");
    expect(read("src/pages/info/GiftGuides.tsx")).not.toContain("— Louisiana Helpr");
    expect(PUBLIC_PAGE_META["/gift-guides"].title).toMatch(/ — Helpr$/);
  });
  it("every surface writes the name in the owner's sentence case (nav, menus, promo, landing, page and share titles)", () => {
    expect(giftGuides.title).toBe("Holiday gift guides");
    for (const f of ["src/components/Navbar.tsx", "src/components/DesktopSidebarNav.tsx", "src/components/DesktopTopNav.tsx", "src/components/GiftGuidesPromo.tsx", "src/components/profile/profileLanding/YouMenu.tsx", "src/lib/i18n/enLanding.ts", "src/content/sponsorPage.ts", "src/lib/seoBodies.mjs", "api/share.ts"]) {
      expect(read(f), f).not.toContain("Holiday Gift Guides");
    }
    expect(read("src/components/Navbar.tsx")).toContain("Holiday gift guides");
  });
  it("the footer link says what its page is called", () => {
    expect(read("src/lib/i18n/enPublic.ts")).toContain('"footer.contact": "Contact support"');
    expect(PUBLIC_PAGE_META["/support"].title).toBe("Contact support — Helpr");
  });
});
