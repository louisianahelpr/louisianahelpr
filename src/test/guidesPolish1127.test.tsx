/**
 * Polish audit 1127 (owner-requested phone polish audit, ~/.lh-shots/polish-audit-1127/FINDINGS.md), gift guides MEDIUM
 * and LOW items:
 *   #92  Sam's Club guide top: one 14px cream line "Sam's Club members only ($60/yr, Plus $120) · Sale Nov 26–29 · Join ›"
 *        with "Join" a text link (was a 280px card with a second olive pill on the first screen).
 *   #96  Black Friday page's Sam's Club link: one 56px row, 15px/600 ink, 16px under the cover; no thumbnail, body or pill.
 *   #142 Small Business Saturday cards: no bold "Gift idea:" label and no business name repeated in the gift line;
 *        "Pickup in town" for a local shop (was "Local").
 *   #149 Share menu: the phone's own share sheet ("More ways to share") is last.
 *   #151 No 1px grey rule under the cover.
 * (#144, Popular searches with no separator: src/test/guideSearchLinksWrap1124.test.ts.)
 *
 * @mutate src/pages/info/giftGuides/SamsClubParts.tsx | <span aria-hidden="true">›</span> | <i aria-hidden="true">See the deals ›</i>
 * @mutate src/pages/info/giftGuides/SamsClubParts.tsx | justify-content:space-between;gap:12px;min-height:56px;margin:16px 0; | justify-content:space-between;gap:12px;min-height:56px;margin:4px 0;
 * @mutate src/pages/info/giftGuides/SamsClubParts.tsx | <p className="gg-sams-tip" data-gift-sams-join=""> | <p className="gg-sams-tip gg-pill" data-gift-sams-join="">
 * @mutate src/content/giftGuideSmallBiz.mjs | const strip = n === nameWords.length \|\| n >= 2 | const strip = false && n >= 2
 * @mutate src/content/giftGuideSmallBiz.mjs | local: "Pickup in town", | local: "Local",
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-words{text-align:center;padding:10px 16px 14px;margin-bottom:6px} | .gg-words{text-align:center;padding:10px 16px 14px;border-bottom:1px solid var(--gg-line);margin-bottom:6px}
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SMALL_BIZ from "@/content/giftGuideSmallBiz.json";
import { SMALL_BIZ_WORDS, giftLine, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { SAMS_BF_SLUG, SAMS_BF_WORDS, SAMS_MEMBERSHIP } from "@/content/samsClubBlackFriday1125";
import { SamsBlackFridayFeature, SamsJoinCard } from "@/pages/info/giftGuides/SamsClubParts";

const src = (p: string) => readFileSync(p, "utf8");
afterEach(() => cleanup());

describe("#92/#96 Sam's Club: one line at the guide's top, one row on the Black Friday page", () => {
  it("the guide's members note is one line with the prices, the sale's days and a Join text link", () => {
    const { container } = render(<MemoryRouter><SamsJoinCard /></MemoryRouter>);
    const tip = container.querySelector("p.gg-sams-tip[data-gift-sams-join]")!;
    expect(tip).not.toBeNull();
    expect(tip.textContent).toContain(`$${SAMS_MEMBERSHIP.clubPerYear}/yr`);
    expect(tip.textContent).toContain(`$${SAMS_MEMBERSHIP.plusPerYear}`);
    expect(tip.textContent).toContain("Nov 26–29");
    const join = tip.querySelector<HTMLAnchorElement>("a[data-gift-sams-join-link]")!;
    expect(join.getAttribute("href")).toBe(SAMS_MEMBERSHIP.href);
    expect(join.textContent).toMatch(/^Join ›/);
    // No heading, kicker or second pill button.
    expect(container.querySelector("h2, small")).toBeNull();
    expect(src("src/pages/info/giftGuides/SamsClubParts.tsx")).not.toMatch(/\.gg-sams-tip a\{[^}]*border-radius:999px/);
  });

  it("the Black Friday page's link is one 56px row: the title and a chevron, no photo, body line or pill", () => {
    const { container } = render(<MemoryRouter><SamsBlackFridayFeature /></MemoryRouter>);
    const row = container.querySelector<HTMLAnchorElement>(`a[data-gift-sams-feature][href="/gift-guides/${SAMS_BF_SLUG}"]`);
    if (!row) return expect.fail("no Sam's Club row (the guide is not live?)");
    expect(row.querySelector("img, i, b")).toBeNull();
    expect(row.children.length).toBe(2);
    expect(row.textContent).toBe(`${SAMS_BF_WORDS.featureTitle}›`);
    expect(src("src/pages/info/giftGuides/SamsClubParts.tsx")).toContain(".gg-sams-feature{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;margin:16px 0;");
  });
});

describe("#142 Small Business Saturday card text", () => {
  it("the gift line drops the business's name and the bold label", () => {
    expect(giftLine("Ripley's Crawfish", "Ripley's Crawfish gift certificate")).toBe("Gift certificate");
    expect(giftLine("The Crab Man Plus", "Crab Man seasoning + tumbler")).toBe("Seasoning + tumbler");
    expect(giftLine("Dupuy's Seafood & Steak", "Dupuy's gift certificate (buy at the restaurant)")).toBe("Gift certificate (buy at the restaurant)");
    expect(giftLine("Breads and Sweets by Babs", "Breads and Sweets by Babs e-gift certificate")).toBe("E-gift certificate");
    // One shared ordinary word is not the name.
    expect(giftLine("Candle Bloom Confections", "Candle flower bouquet")).toBe("Candle flower bouquet");
    expect(giftLine("Basic Bee", "Bitty Bit of Honey Gift Set")).toBe("Bitty Bit of Honey Gift Set");
    const rows = SMALL_BIZ as SmallBiz[];
    const withGift = rows.filter((b) => b.gift);
    expect(withGift.length).toBeGreaterThan(20);
    for (const b of withGift) expect(giftLine(b.name, b.gift).toLowerCase().startsWith(b.name.toLowerCase()), b.name).toBe(false);
    const card = src("src/pages/info/giftGuides/GiftGuideSmallBiz.tsx");
    expect(card).toContain('<p className="gg-sb-text" data-gift-sb-gift="">{giftLine(b.name, b.gift)}</p>');
    expect(card).not.toContain("giftLabel");
  });

  it("a local shop says Pickup in town", () => {
    expect(SMALL_BIZ_WORDS.local).toBe("Pickup in town");
    expect(SMALL_BIZ_WORDS.ships).toBe("Ships");
  });
});

describe("#149 share menu order and #151 no rule under the cover", () => {
  it("the share sheet item comes after Facebook and Pinterest", () => {
    const share = src("src/pages/info/giftGuides/GiftGuideShare.tsx");
    const at = (s: string) => share.indexOf(s);
    expect(at("data-gift-pin=")).toBeGreaterThan(0);
    expect(at("data-gift-share-native=")).toBeGreaterThan(at("data-gift-pin="));
    expect(at("data-gift-pin=")).toBeGreaterThan(at("data-gift-text="));
  });

  it("the cover has no bottom border and keeps its gap", () => {
    const css = src("src/pages/info/giftGuides/giftGuidesStyles.ts");
    expect(css).toContain(".gg-words{text-align:center;padding:10px 16px 14px;margin-bottom:6px}");
    expect(css).not.toMatch(/\.gg-words\{[^}]*border-bottom/);
  });
});
