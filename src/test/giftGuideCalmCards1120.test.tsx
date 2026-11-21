/**
 * OWNER REQUESTS 11-20 ON THE GIFT GUIDES (from her phone, "frustrated with how busy the guides look"):
 *  1. "Take the circle of shop at, it's too busy looking": every pick card's Shop link (guides, store pages, the quiz,
 *     My Wish List, a shared list, the deal cards) is a plain olive text link, never an outlined pill Button, and keeps
 *     a 44px tap area through its own min-height.
 *  2. "None of the images should have a background either": every product photo box in the gift-guide styles is plain
 *     white (no beige #faf6ee box), the <img> has no border of its own, and it multiplies onto the white so a white
 *     product shot shows no box at all. Amazon photos are never edited (Associates agreement); this is CSS only.
 * Class guard: every CSS string the gift guides inject (inventory below) is read, and every rule styling a photo box or
 * thumbnail is checked, not a hand-picked few.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-photo{border-radius:12px;background:#fff} | .gg-list .gg-photo{border-radius:12px;background:#faf6ee}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | aspect-ratio:1/1;border-radius:10px;background:#fff; | aspect-ratio:1/1;border-radius:10px;background:#faf6ee;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | img.gg-thumb{background:transparent;border:0;mix-blend-mode:multiply} | img.gg-thumb{background:transparent;mix-blend-mode:multiply}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <Heart saved={saved} label={WISH.saveLabel(pick.name)} |       <GiftOut href={pick.href} className="gg-shop-btn">Shop</GiftOut><Heart saved={saved} label={WISH.saveLabel(pick.name)}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |       {heart && ( |       <Out href={item.href} className="gg-shop-btn">Shop</Out>{heart && (
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-item:hover .gg-nm-name,.gg-item:focus-visible .gg-nm-name{text-decoration:underline; | .gg-item:hover .gg-nm-name,.gg-item:focus-visible .gg-nm-name{text-decoration:none;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | padding:0 6px 0 0;border:0;border-radius:0;background:none; | padding:0 6px 0 0;border:1px solid;border-radius:999px;background:none;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | min-height:44px;margin-top:auto;padding:0 4px 0 0;border:0;background:none; | margin-top:auto;padding:0 4px 0 0;border:1px solid;background:none;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";
import { WishRow } from "@/pages/info/giftGuides/GiftGuideMyList";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { blankComments } from "./helpers/blankNonCode";

/** Every gift-guide file that injects CSS (the template strings that style product photos live in these). */
const CSS_FILES = [
  "src/pages/info/giftGuides/giftGuidesStyles.ts",
  "src/pages/info/giftGuides/giftWishStyles.ts",
  "src/pages/info/giftGuides/GiftGuideDeals.tsx",
  "src/pages/info/giftGuides/GiftGuideSponsorRow.tsx",
  "src/pages/info/giftGuides/GiftGuideSmallBiz.tsx",
  "src/pages/info/giftGuides/smallBizCardStyles.ts",
  "src/pages/info/giftGuides/fun/FunPage.tsx",
];
const css = (f: string) => blankComments(readFileSync(f, "utf8"));
/** Every `selector{declarations}` in a file, from its CSS template strings. */
const rules = (src: string) => [...src.matchAll(/([^{}`]+)\{([^{}`]*)\}/g)].map((m) => ({ sel: m[1].trim().split("\n").pop()!.trim(), body: m[2] }));
/** A rule that styles a product photo box or thumbnail (the store-name letter tile is not a photo). */
const isPhotoRule = (sel: string) => /(photo|thumb)\b/.test(sel) && !/gg-letter/.test(sel) && !/logo/.test(sel);

describe("owner 11-20: no beige box or border behind any product photo", () => {
  const photoRules = CSS_FILES.flatMap((f) => rules(css(f)).filter((r) => isPhotoRule(r.sel)).map((r) => ({ f, ...r })));

  it("finds the photo rules (inventory floor)", () => {
    expect(photoRules.length).toBeGreaterThan(10);
  });

  it("every photo box's background is white or transparent", () => {
    const bad = photoRules
      .map((r) => ({ ...r, bg: /(?:^|;)\s*background(?:-color)?:\s*([^;]+)/.exec(r.body)?.[1].trim() }))
      .filter((r) => r.bg !== undefined && !/^(#fff|#ffffff|white|transparent|none)$/i.test(r.bg))
      .map((r) => `${r.f}: ${r.sel} -> ${r.bg}`);
    expect(bad).toEqual([]);
  });

  it("the photo itself has no border and multiplies onto the white box", () => {
    const own = css("src/pages/info/giftGuides/giftGuidesStyles.ts");
    const img = rules(own).find((r) => r.sel === "img.gg-thumb")!;
    expect(img.body).toContain("border:0");
    expect(img.body).toContain("mix-blend-mode:multiply");
    expect(css("src/pages/info/giftGuides/GiftGuideDeals.tsx")).toMatch(/\.gg-deal-photo img\{[^}]*mix-blend-mode:multiply/);
  });
});

describe("owner 11-20: every Shop link is plain text, not a pill", () => {
  const shopRules = CSS_FILES.flatMap((f) => rules(css(f)).filter((r) => /(^|[\s,])\.gg-(deal-)?shop(-btn)?$/.test(r.sel) || /\.gg-deal \.gg-deal-shop$/.test(r.sel)).map((r) => ({ f, ...r })));

  it("each Shop link's base rule has no border, no fill, no pill radius and a 44px tap area", () => {
    const base = shopRules.filter((r) => r.sel === ".gg-shop-btn" || r.sel === ".gg-deal .gg-deal-shop");
    expect(base.map((r) => r.sel).sort()).toEqual([".gg-deal .gg-deal-shop", ".gg-shop-btn"]);
    for (const r of base) {
      expect(r.body, r.sel).toContain("border:0");
      expect(r.body, r.sel).toContain("background:none");
      expect(r.body, r.sel).toContain("min-height:44px");
      expect(r.body, r.sel).not.toContain("999px");
    }
    // No later rule (the tablet and desktop grids, the wish list) puts a border or pill back.
    for (const r of shopRules) expect(r.body, `${r.f}: ${r.sel}`).not.toMatch(/border(-color)?:(?!0)|border-radius:999px|width:100%/);
  });

  it("no Shop link is wrapped in the shared Button (whose outline variant is the pill)", () => {
    for (const f of ["src/pages/info/giftGuides/GiftGuideView.tsx", "src/pages/info/giftGuides/GiftGuideMyList.tsx", "src/pages/info/giftGuides/GiftGuideDeals.tsx"]) {
      expect(css(f), f).not.toMatch(/<Button[^>]*className="[^"]*gg-(deal-)?shop/);
    }
  });

  // Owner 2026-11-21: "remove the shop at button, when they click the title of the image it will go there to the link".
  // Each card is ONE outbound link holding the photo and the name (new tab, sponsored rel, "(opens in a new tab)"), no
  // Shop button; the heart is its own button outside it. The name underlines on hover and focus only.
  it("a guide row and a wish-list row: one link (photo + name), no Shop button, the heart outside it", () => {
    const pick = { name: "Align High-Rise Pant", href: "https://shop.lululemon.com/p/x", store: "store-lululemon", line: "" } as unknown as CatalogPick;
    const guide = render(<MemoryRouter><ol><PickRow pick={pick} /></ol></MemoryRouter>).container;
    const wish = render(
      <MemoryRouter><ol><WishRow item={{ id: "x1", name: "Flow Y Bra", store: "lululemon", href: "https://shop.lululemon.com/p/y", out: "affiliate" }} heart={{ saved: true, onToggle: () => undefined }} /></ol></MemoryRouter>,
    ).container;
    for (const [c, name, href] of [[guide, "Align High-Rise Pant", "https://shop.lululemon.com/p/x"], [wish, "Flow Y Bra", "https://shop.lululemon.com/p/y"]] as const) {
      const links = [...c.querySelectorAll("li a")];
      expect(links.length, name).toBe(1);
      const a = links[0];
      expect(a.getAttribute("href"), name).toBe(href);
      expect(a.getAttribute("target"), name).toBe("_blank");
      expect(a.getAttribute("rel"), name).toBe("sponsored noopener");
      expect(a.querySelector(".gg-nm-name")?.textContent, name).toBe(name);
      expect(a.querySelector(".gg-thumb, .gg-photo"), name).not.toBeNull();
      expect(a.textContent, name).toContain("(opens in a new tab)");
      expect(a.textContent, name).not.toMatch(/\bShop\b|›/);
      expect(c.querySelector(".gg-shop-btn, [data-gift-shop]"), name).toBeNull();
      const heart = c.querySelector("[data-gift-heart]")!;
      expect(a.contains(heart), name).toBe(false);
      expect(heart.className, name).toMatch(/\bw-11\b.*\bh-11\b/);
    }
    const own = css("src/pages/info/giftGuides/giftGuidesStyles.ts");
    expect(own).toContain(".gg-item:hover .gg-nm-name,.gg-item:focus-visible .gg-nm-name{text-decoration:underline;");
    expect(own).not.toMatch(/(^|[}\n])\.gg-nm-name\{[^}]*text-decoration:underline/);
  });
});
