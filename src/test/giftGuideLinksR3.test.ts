/**
 * LINKS AUDIT R3 (design-audit-loop/gg-r3-links, 2026-11-19; lead 11-19): the live gift guides carried 17 dead links,
 * 11 UK/EU links (every Selfridges pin opened selfridges.com/GB, two FWRD pins forced EUR/GBP), 18 wrong-page picks
 * (homepage, collection, password wall, another product), 66 sold-out picks and 32 deals that opened only the store's
 * homepage. scripts/giftGuideRules.mjs keeps them out for good, so a re-import cannot bring them back: BANNED_LINKS (the
 * audited links, read by scripts/gift-guide-picks.mjs on every pick, deal and deal item), nonUsUrl (UK paths, any
 * non-US Selfridges page, forced currency or country) and homepageLink (a pick that opens a site's front page; the
 * Louisiana businesses and the 25 Days sponsors keep their plain homepage links on purpose). This guard reads the rules
 * and every generated chunk (src/content/giftGuidePicks/<slug>.json).
 * @mutate scripts/giftGuideRules.mjs | export const bannedLink = (href) => BANNED_LINKS.get(String(href ?? "")) ?? ""; | export const bannedLink = (href) => "";
 * @mutate scripts/giftGuideRules.mjs | && !selfridgesUs(t)) | && false)
 * @mutate scripts/giftGuideRules.mjs |     \|\| CURRENCY_FORCED.test(t); |     \|\| false;
 * @mutate scripts/giftGuideRules.mjs | export const homepageLink = (href) => { | export const homepageLink = (href) => { return false;
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { BANNED_LINKS, bannedLink, homepageLink, nonUsUrl } from "../../scripts/giftGuideRules.mjs";
import { LOUISIANA_SHOPS, NATIONAL_SPONSOR_SITES, SPONSOR_SITES } from "@/content/giftGuides";

type Pick = { name: string; href: string };
type Deal = { title: string; href: string; items?: { name: string; href: string }[] };
const DIR = "src/content/giftGuidePicks";
const chunk = (slug: string): { picks: Pick[]; deals?: Deal[] } => JSON.parse(readFileSync(`${DIR}/${slug}.json`, "utf8"));
const slugs = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
/** The 25 Days sponsors guide lists each sponsor's giveaway as the sponsor gave it (exempt, like the holistic rules). */
const SPONSORS_GUIDE = "25-days-sponsors";
const HOMEPAGE_OK = new Set<string>([...LOUISIANA_SHOPS, ...SPONSOR_SITES, ...NATIONAL_SPONSOR_SITES]);

describe("gift guides: links audit r3 (dead, UK/EU, wrong page, sold out, homepage deals)", () => {
  it("the blocklist holds every audited link, by reason", () => {
    const by: Record<string, number> = {};
    for (const why of BANNED_LINKS.values()) by[why] = (by[why] ?? 0) + 1;
    // Links audit r4 (11-19) added 4 sold-out Walmart picks, 2 wrong-page pins (FreeSip 24oz, Delícia) and the Funko homepage deal.
    expect(by).toEqual({ dead: 17, "sold out": 71, "non-US": 11, "wrong page": 20, "homepage deal": 33 });
    expect(bannedLink("https://mavely.app.link/0CmO0TyQa8b")).toBe("dead"); // Crate & Barrel Kids toys deal (404)
    expect(bannedLink("https://go.shopmy.us/p-104208114")).toBe("sold out"); // Away Carry-On, Clay Pink
    expect(bannedLink("https://go.shopmy.us/p-104220786")).toBe("non-US"); // Polaroid Go on selfridges.com/GB
    expect(bannedLink("https://go.shopmy.us/p-104219076")).toBe("wrong page"); // Calpak password wall
    expect(bannedLink("https://go.shopmy.us/p-107279221")).toBe("homepage deal"); // Macy's Holiday Gifts
    expect(bannedLink("https://www.amazon.com/dp/B0BWNZLQ69?tag=louisianahelpr-20")).toBe("");
  });

  it("the rules: non-US hosts, paths and currencies; homepage-only links", () => {
    expect(nonUsUrl("https://www.selfridges.com/GB/en/cat/polaroid-go-instant-camera_R03862485/")).toBe(true);
    expect(nonUsUrl("Selfridges")).toBe(true);
    expect(nonUsUrl("https://www.selfridges.com/US/en/cat/polaroid-go_R1/")).toBe(false);
    expect(nonUsUrl("https://www.fwrd.com/product-fellow-atmos-vacuum-canister-07-l/FLOW-WH10/?d=Womens&currency=GBP&tCountryCode=GB")).toBe(true);
    expect(nonUsUrl("https://www.fwrd.com/product-carhartt-wip-detroit-jacket-in-black/CHWF-MO6/?d=Mens&source=google&tCurrency=EUR")).toBe(true);
    expect(nonUsUrl("https://www.fwrd.com/product-x/Y/?currency=USD")).toBe(false);
    expect(nonUsUrl("https://www.sephora.co.uk/p/x")).toBe(true);
    expect(nonUsUrl("https://www.example.com/en-gb/p/x")).toBe(true);
    expect(nonUsUrl("https://www.amazon.com/dp/B0BWNZLQ69?tag=louisianahelpr-20")).toBe(false);
    expect(homepageLink("https://click.linksynergy.com/deeplink?id=pqYaS88pNmA&mid=53904&murl=https%3A%2F%2Ftushbaby.com%2F")).toBe(true);
    expect(homepageLink("https://www.awin1.com/cread.php?awinmid=123126&awinaffid=3158016&ued=https%3A%2F%2Fpiccoload.com%2F")).toBe(true);
    expect(homepageLink("https://crew-dog.com/")).toBe(true);
    expect(homepageLink("https://www.vans.com/en-us")).toBe(true);
    expect(homepageLink("https://crew-dog.com/products/lsu-claw-heritage-embroidered-hoodie")).toBe(false);
    expect(homepageLink("https://click.linksynergy.com/deeplink?id=x&mid=1&murl=https%3A%2F%2Fmomcozy.com%2Fproducts%2Fpillow")).toBe(false);
    expect(homepageLink("https://go.shopmy.us/p-104208114")).toBe(false);
  });

  it("no page shows a banned, non-US or homepage-only link (picks, deals, deal items)", () => {
    expect(slugs.length).toBeGreaterThan(45); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20
    let picks = 0;
    let deals = 0;
    for (const slug of slugs) {
      const c = chunk(slug);
      for (const p of c.picks) {
        picks += 1;
        if (slug === SPONSORS_GUIDE) continue;
        expect(bannedLink(p.href), `${slug}: ${p.name} ${p.href}`).toBe("");
        expect(nonUsUrl(p.href), `${slug}: ${p.name} ${p.href}`).toBe(false);
        if (homepageLink(p.href)) expect(HOMEPAGE_OK.has(new URL(p.href).hostname), `${slug}: ${p.name} opens a homepage (${p.href})`).toBe(true);
      }
      for (const d of c.deals ?? []) {
        deals += 1;
        expect(bannedLink(d.href), `${slug}: deal ${d.title}`).toBe("");
        for (const i of d.items ?? []) expect(bannedLink(i.href), `${slug}: deal item ${i.name}`).toBe("");
      }
    }
    expect(picks).toBeGreaterThan(1500); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20 (~1,850)
    expect(deals).toBeGreaterThan(30); // 1120: the deal sections of the kept store pages; train 1120b dropped 42 Walmart house-brand and marketplace rows (33 measured 2026-11-20)
  });

  it("the Selfridges store page is gone with its cover and share image (every pin opened the UK site)", () => {
    expect(slugs).not.toContain("store-selfridges");
    expect(existsSync("public/gift-guides/covers/store-selfridges.webp")).toBe(false);
    expect(existsSync("public/gift-guides/og/store-selfridges.jpg")).toBe(false);
    expect(readFileSync("src/content/giftGuidePicks.ts", "utf8")).not.toContain('"store-selfridges"');
  });
});
