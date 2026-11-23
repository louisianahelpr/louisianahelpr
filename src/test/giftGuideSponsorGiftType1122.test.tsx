/**
 * Gift guides consistency audit 1122 (#7, #8, #9, #10), data and image fixes on the 25 Days sponsors guide and the
 * Small Business Saturday cards:
 *   - #9 (owner 2026-11-22, "Show the gift type"): every sponsors-guide row with no price shows ONE short gift-type label
 *     ("Gift card", "Experience", "Session", "Gift set", "Product") in the price slot, in the price's own style
 *     (src/content/giftGuideSponsorGiftTypes.ts); a row with a price keeps its price; no grey gift line; no other guide
 *     shows a label; the map names exactly the rows with no price (both ways).
 *   - #10: a row whose link is our own 25 Days page says so ("On our 25 Days giveaway page"), never "On <sponsor>";
 *     Wanderlust by Abby links her public Facebook page.
 *   - #7: the Small Business Saturday cards that showed a name box (Monarch Books, Hair Fashion and Spa, Tiffany Morton,
 *     Phyllis Guy) and Mystic Forests show the same image file as the sponsors guide.
 *   - #8: the cleaned logos (Birdwell's border, Perfectly Planned's grey well, Bayou Grace's cream box, Tiffany Morton's
 *     black corners) are cutouts: their corners are clear.
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const giftType = guide === SPONSORS_PAGE && !showsPrice(pick) ? pick.giftType : undefined; | const giftType = !showsPrice(pick) ? pick.giftType : undefined;
 * @mutate src/content/giftGuideSponsorGiftTypes.ts |   "The Fois": "Product", // a Fois Christmas sweater or the wooden Fois roux spoon |   "The Fois ": "Product",
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const toOurPage = OUR_25_DAYS_PAGE.test(pick.href); | const toOurPage = false;
 * @mutate src/content/giftGuideSmallBiz.json | "logo":"/gift-guides/sponsors/monarch-books.webp", | "logo":"/gift-guides/small-biz/monarch-books.png",
 */
import { existsSync, readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { guideBySlug, loadGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { SPONSOR_GIFT_TYPES, SPONSOR_GIFT_TYPE_LABELS } from "@/content/giftGuideSponsorGiftTypes";
import GiftGuides from "@/pages/info/GiftGuides";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";

type Row = { name: string; href: string; image?: string | null; price?: number | null };
const CHUNK = JSON.parse(readFileSync("src/content/giftGuidePicks/25-days-sponsors.json", "utf8")) as { picks: Row[] };
const SMALL_BIZ = JSON.parse(readFileSync("src/content/giftGuideSmallBiz.json", "utf8")) as { slug: string; logo?: string }[];
const noPrice = CHUNK.picks.filter((p) => p.price == null).map((p) => p.name);
const OUR_PAGE = "https://www.louisianahelpr.com/25days";

const renderSponsors = () =>
  render(
    <MemoryRouter initialEntries={["/gift-guides/25-days-sponsors"]}>
      <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
    </MemoryRouter>,
  ).container;

describe("25 Days sponsors guide: the gift type in the price slot (owner 11-22)", () => {
  it("names exactly the rows with no price, each with one label from the vocabulary", () => {
    // 69 of 104 rows had no price, measured 2026-11-22 (consistency audit #9).
    expect(noPrice.length).toBeGreaterThan(60);
    expect(Object.keys(SPONSOR_GIFT_TYPES).sort()).toEqual([...noPrice].sort());
    for (const [name, label] of Object.entries(SPONSOR_GIFT_TYPES)) expect(SPONSOR_GIFT_TYPE_LABELS, name).toContain(label);
    // No label is a dollar amount (no value is ever made up).
    expect(Object.values(SPONSOR_GIFT_TYPES).join(" ")).not.toMatch(/\$|\d/);
  });

  it("draws the label where the price sits, in the price's style; priced rows keep their price; no grey gift line", async () => {
    await loadGuidePicks("25-days-sponsors");
    expect(guideBySlug("25-days-sponsors")!.picks.length).toBe(CHUNK.picks.length);
    const c = renderSponsors();
    const types = [...c.querySelectorAll<HTMLElement>("[data-gift-type]")];
    expect(types.length).toBe(noPrice.length);
    for (const t of types) {
      expect(t.classList.contains("gg-price"), t.textContent ?? "").toBe(true);
      expect(t.parentElement?.classList.contains("gg-nm-meta")).toBe(true);
    }
    expect(c.querySelectorAll("[data-gift-price]").length).toBe(CHUNK.picks.length - noPrice.length);
    expect(c.querySelector("[data-gift-sponsor-gift]")).toBeNull();
    // "The Fois" showed nothing at all before (audit #9); it gets its label too.
    const fois = [...c.querySelectorAll<HTMLAnchorElement>("a[data-gift-title-link]")].find((a) => a.querySelector(".gg-nm-name")?.textContent === "The Fois")!;
    expect(fois.querySelector("[data-gift-type]")?.textContent).toBe("Product");
  });

  it("shows no label on any other guide", () => {
    const pick = { name: "Everyday Dose", href: "https://www.example.com/x", store: "sponsor", badges: [], giftType: "Gift card" } as unknown as CatalogPick;
    const c = render(<MemoryRouter><ol><PickRow pick={pick} guide="her" /></ol></MemoryRouter>).container;
    expect(c.querySelector("[data-gift-type]")).toBeNull();
  });
});

describe("25 Days sponsors guide: links say where they go (audit #10)", () => {
  it("a row that opens our 25 Days page says so, never 'On <sponsor>'; Wanderlust by Abby opens her Facebook page", async () => {
    await loadGuidePicks("25-days-sponsors");
    const ours = CHUNK.picks.filter((p) => p.href === OUR_PAGE);
    // Bake & Brush, Breads and Sweets by Babs, Bayou Grace Outfitters, Summar T. Photography (no page found 11-22).
    expect(ours.length).toBeGreaterThan(0);
    expect(CHUNK.picks.find((p) => p.name === "Wanderlust by Abby")?.href).toBe("https://www.facebook.com/wanderlustbyabby");
    const c = renderSponsors();
    for (const p of ours) {
      const a = [...c.querySelectorAll<HTMLAnchorElement>(`a[href="${OUR_PAGE}"]`)].find((x) => x.querySelector(".gg-nm-name")?.textContent === p.name)!;
      expect(a, p.name).toBeTruthy();
      expect(a.textContent, p.name).toContain("On our 25 Days giveaway page");
      expect(a.textContent, p.name).not.toContain(`On ${p.name}`);
    }
  });
});

describe("Sponsor images: one image per business, cutouts only (audit #7, #8)", () => {
  it("the Small Business Saturday cards use the sponsors guide's own logo file", () => {
    const sponsorImage = (name: string) => new URL(CHUNK.picks.find((p) => p.name === name)!.image!).pathname;
    const same: [string, string][] = [
      ["monarch-books", "Monarch Books"],
      ["hair-fashion-and-spa", "Hair Fashion and Spa"],
      ["tiffany-morton-cosmetic-tattooing", "Tiffany Morton Cosmetic Tattooing"],
      ["phyllis-guy-dance-center", "Phyllis Guy Dance Center"],
      ["mystic-forests-nursery", "Mystic Forests Nursery"],
    ];
    for (const [slug, name] of same) {
      const logo = SMALL_BIZ.find((b) => b.slug === slug)?.logo;
      expect(logo, slug).toBe(sponsorImage(name));
      expect(existsSync(`public${logo}`), slug).toBe(true);
    }
  });

  it("the cleaned logos have clear corners (no box or well behind them)", async () => {
    for (const slug of ["birdwells", "perfectly-planned-events", "bayou-grace-outfitters", "tiffany-morton-cosmetic-tattooing"]) {
      const { data, info } = await sharp(`public/gift-guides/sponsors/${slug}.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      const corners = [alphaAt(0, 0), alphaAt(info.width - 1, 0), alphaAt(0, info.height - 1), alphaAt(info.width - 1, info.height - 1)];
      expect(Math.max(...corners), slug).toBeLessThan(16);
      expect(Math.max(info.width, info.height), slug).toBeLessThanOrEqual(160);
    }
  });
});
