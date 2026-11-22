/**
 * Holiday audit 1121 #1 (High, live on www after #4862): signed in on a phone, every gift guide page was 771px wide
 * inside a 375px screen, so names, the banner, the header tools and every heart were off-screen and a signed-in phone
 * user could not save a gift. Signed in, PublicLayout renders AppShell, whose scroll area is a flex column; the page's
 * `max-w-[78rem] mx-auto` container is a flex item there, and auto margins turn stretch off, so it shrank-to-fit its
 * content's min-content, which the phone chip row (nav.gg-pnav: a row of nowrap chips, 771px) set. Guests were fine
 * (their wrapper is a block). The fix keeps the container the column's width (`w-full min-w-0`), and the chip row
 * contributes no intrinsic width (`contain:inline-size`) and scrolls inside itself.
 *
 * jsdom does no layout, so this guards the two rules (the browser check is in the report: 771 -> 375 measured).
 *
 * @mutate src/components/marketing/PublicHeaderPage.tsx | className={`${PUBLIC_CONTAINER} w-full min-w-0`} | className={PUBLIC_CONTAINER}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-pnav{display:block;contain:inline-size;max-width:calc(100% + 40px); | .gg-pnav{display:block;
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

  it("the phone chip row adds no intrinsic width and scrolls inside itself; it sticks to the top inside AppShell", () => {
    const rule = /@media \(max-width:767px\)\{\n\.gg-pnav\{[^}]*\}/.exec(GIFT_GUIDES_CSS)?.[0] ?? "";
    expect(rule).toContain("contain:inline-size");
    expect(rule).toContain("max-width:calc(100% + 40px)");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-pnav-row\{[^}]*overflow-x:auto/);
    expect(GIFT_GUIDES_CSS).toContain(".app-shell-frame .gg-pnav{top:0}");
  });
});
