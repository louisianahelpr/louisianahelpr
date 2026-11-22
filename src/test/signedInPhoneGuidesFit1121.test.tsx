/**
 * Holiday audit 1121 #1 (High, live on www after #4862): signed in on a phone, every gift guide page was 771px wide
 * inside a 375px screen, so names, the banner, the header tools and every heart were off-screen and a signed-in phone
 * user could not save a gift. Signed in, PublicLayout renders AppShell, whose scroll area is a flex column; the page's
 * `max-w-[78rem] mx-auto` container is a flex item there, and auto margins turn stretch off, so it shrank-to-fit its
 * content's min-content, which the phone chip row (nav.gg-pnav: a row of nowrap chips, 771px) set. Guests were fine
 * (their wrapper is a block). The fix keeps the container the column's width (`w-full min-w-0`), and the chip row
 * contributed no intrinsic width (`contain:inline-size`). Owner 11-22 removed the chip row; the phone head row's title
 * shrinks instead.
 *
 * jsdom does no layout, so this guards the two rules (the browser check is in the report: 771 -> 375 measured).
 *
 * @mutate src/components/marketing/PublicHeaderPage.tsx | className={`${PUBLIC_CONTAINER} w-full min-w-0`} | className={PUBLIC_CONTAINER}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-title{flex:1 1 auto} | .gg-head-title{flex:none}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

describe("signed-in phone: a gift guide page fits the screen (holiday audit 1121 #1)", () => {
  it("the public page container is the column's width (w-full min-w-0), never shrink-to-fit", () => {
    const { container } = render(
      <MemoryRouter><PublicHeaderPage title="t" hideHeader bottomPaddingClassName="pb-1"><p>x</p></PublicHeaderPage></MemoryRouter>,
    );
    const box = container.querySelector("[data-public-container]")!;
    expect(box).not.toBeNull();
    const cls = box.className.split(/\s+/);
    expect(cls).toContain("w-full");
    expect(cls).toContain("min-w-0");
    expect(cls).toContain("mx-auto");
  });

  // Owner 2026-11-22: the chip row is gone; on a phone the head row is one line (arrow + "Gift guides", the heart and the
  // three-line menu), so it must not set the page's min-content either: the title shrinks and wraps, the icons are 44px.
  it("the phone head row adds no intrinsic width: the title shrinks (min-width 0) and may wrap; no chip row is left", () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg-head-title .text-page-title{margin:0;min-width:0;overflow-wrap:anywhere}");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-head-title\{display:flex;[^}]*min-width:0/);
    const phone = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.indexOf(".gg-head-phone{display:none}"));
    expect(phone).toMatch(/@media \(max-width:767px\)\{\n\.gg-headrow\{flex-wrap:nowrap;gap:4px\}\n\.gg-head-title\{flex:1 1 auto\}/);
    expect(GIFT_GUIDES_CSS).not.toContain(".gg-pnav");
  });
});
