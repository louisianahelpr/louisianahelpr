/**
 * The owner's 11-24 guide changes (scripts/giftGuideOwner1124.mjs): her approved higher-commission switches ("[if we have
 * a] higher commission no need to ask", ~1:10 AM, on the Desktop review page reviews/later-switches-1124.html) and her
 * Macy's adds (~2:05 / ~2:15 AM screenshots). The lists below are copied from the links made in her ShopMy and Later that
 * night (~/.lh-shots/later-switches-1124-handoff.md), not from the module, so each check is two-way.
 * @mutate scripts/giftGuideOwner1124.mjs | href: shopmy("p-110117645"), store: "store-stanley", commission: 18, | href: shopmy("p-110117645"), store: "store-stanley", commission: 4.5,
 * @mutate scripts/giftGuideOwner1124.mjs | href: "https://mavely.app.link/LP97ij8Zj8b", store: "store-columbia", commission: 8.4, price: 39, | href: "https://mavely.app.link/LP97ij8Zj8b", store: "store-columbia", commission: 8.4, price: 34.5,
 * @mutate scripts/giftGuideOwner1124.mjs |   return { ...r, ...rest, sortPrice: price, price, priceAt: OWNER_1124_PRICE_AT }; |   return r;
 * @mutate scripts/giftGuideHimKids1121.mjs | .concat(HIM_AMAZON_MORE_1121, HIM_SHOPMY_1121).map(rateSwitch1124); | .concat(HIM_AMAZON_MORE_1121, HIM_SHOPMY_1121);
 * @mutate scripts/giftGuideOwnerAdds1122.mjs | ].map(dated).map(rateSwitch1124); | ].map(dated);
 * @mutate scripts/giftGuideHer1121.mjs | ...HER_LINKS_1123, ...HER_ADDS_1124]; | ...HER_LINKS_1123];
 * @mutate scripts/giftGuideHimKids1121.mjs | ...KIDS_LINKS_1123, ...KIDS_ADDS_1124]) { | ...KIDS_LINKS_1123]) {
 * @mutate scripts/giftGuideCutouts1120.mjs | for (const [from, file] of CUTOUTS_1124) CUTOUTS_1120.set(from, file); | void CUTOUTS_1124;
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { RATE_SWITCHES_1124 } from "../../scripts/giftGuideOwner1124.mjs";
import { RESEARCHED_STORES } from "@/content/giftGuidePicks";
import { tagKey } from "@/content/giftGuideKidsFilter";

type Pick = { name: string; href: string; image?: string; store?: string; price?: number; priceAt?: string; commission?: number | null; code?: string; codeEnds?: string };
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const built: Record<string, Pick[]> = { her: her1121Picks() as Pick[], him: him1121Picks() as Pick[], kids: kids1121Picks() as Pick[] };
const amz = (asin: string) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const sm = (pin: string) => `https://go.shopmy.us/p-${pin}`;

/** [guide, old link, new link, store, commission %, price, name on the card]. */
const SWITCHES: [string, string, string, string, number, number, string][] = [
  ["her", amz("B0GGTPW6Q9"), sm("110118023"), "store-ulta-beauty", 13, 119.99, "Shark ChillPill 3-in-1 Personal Cooling Fan"],
  ["her", sm("107555566"), sm("110117910"), "store-ulta-beauty", 13, 149.99, "Shark Depuffi Hot & Cold Face Sculpting Tool"],
  ["her", amz("B0D858S2H5"), sm("110117645"), "store-stanley", 18, 22.5, "Stanley Adventure To-Go Food Jar, 18 oz, Frost"],
  ["her", amz("B0CMJZVT5P"), sm("110118320"), "store-ulta-beauty", 13, 9, "e.l.f. Glow Reviver Lip Oil"],
  ["her", amz("B0CB23NZGT"), "https://mavely.app.link/TptnXLe0j8b", "store-elf", 10.5, 6, "e.l.f. Lip Exfoliator, Brown Sugar"],
  ["her", amz("B01EXQ582Q"), sm("110117734"), "store-sol-de-janeiro", 16, 18, "Sol de Janeiro Brazilian Bum Bum Cream, 2.5 oz"],
  ["him", amz("B0FY9LPSCW"), "https://mavely.app.link/rBTVe27Zj8b", "store-columbia", 8.4, 22.5, "Columbia Ratchet Strap Snapback Hat"],
  ["him", amz("B0076R6MN4"), "https://mavely.app.link/LP97ij8Zj8b", "store-columbia", 8.4, 39, "Columbia Men's Steens Mountain 2.0 Full Zip Fleece Jacket"],
  ["him", sm("107881822"), sm("110119003"), "store-muck-boot", 16, 195, "Muck Arctic Pro Boot"],
];
/** [guide, ShopMy pin, price, name]: her Macy's adds, all Macy's via ShopMy 16%. */
const MACYS: [string, string, number, string][] = [
  ["her", "110119763", 29.99, "Hotel Collection Luxe Knit Robe, Ivory"],
  ["her", "110119787", 99.99, "Shark Rocket Pet Corded Stick Vacuum, HV301"],
  ["her", "110119843", 21, "Clinique 3-Piece Black Honey Trio Gift Set"],
  ["her", "110119860", 49.99, "UGG Raegan 3-Piece Gift Set, Chestnut"],
  ["kids", "110119731", 24.99, "Monster Jam Air Hockey Tabletop Game"],
  ["kids", "110119881", 32.49, "Sharper Image 1:14 Scale Polaris General Off-Road RC Vehicle"],
  ["kids", "110119923", 11.99, "Discovery Kids Glow Lighted Tracing Tablet"],
  ["kids", "110119952", 24.99, "Play-Doh Sizzlin' Grill Playset"],
  ["kids", "110119982", 43.99, "Melissa & Doug Sort, Stock, Select Beauty Kiosk Play Set"],
  ["kids", "110120034", 22.49, "VTech Learn & Zoom 2-in-1 Three-Wheel Motorbike"],
  ["kids", "110120060", 31.99, "Barbie Holiday Doll"],
];
/**
 * Measured 11-24 and kept where they were (no store paying more for the same item at about the same price): Later's
 * Target rate is by category (Toys 2.8%, Home & Outdoor 4.9%; "up to 7%" is Target's HeyDay brand only) against ShopMy
 * Target's 4%, and bissell.com on ShopMy is 4%; anker.com sells the power bank only in a bundle; the Sol & Go mist set is
 * on neither soldejaneiro.com nor Ulta.
 */
const KEPT: [string, string][] = [
  ["kids", sm("109218761")], ["kids", sm("109208104")], ["her", sm("109151385")],
  ["her", amz("B0C6XK77HJ")], ["him", amz("B0C6XK77HJ")], ["her", amz("B0H42QZ8BW")],
];

/** A transparent WebP cutout that exists in public/gift-guides/cutouts. */
function expectCutout(p: Pick) {
  expect(String(p.image).startsWith(CUTOUT_BASE), `${p.name}: ${p.image}`).toBe(true);
  const file = `public/gift-guides/cutouts/${String(p.image).slice(CUTOUT_BASE.length)}`;
  expect(existsSync(file), file).toBe(true);
  const head = readFileSync(file).subarray(0, 32);
  expect(head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0, `${file} has no alpha`).toBe(true);
}

describe("owner 11-24: higher-commission switches", () => {
  it("each switched pick has its new link, store, rate, price and 11-24 check day, on the page and in the build; the old link is gone", () => {
    expect(SWITCHES.length).toBeGreaterThan(8);
    expect(Object.keys(RATE_SWITCHES_1124).sort()).toEqual(SWITCHES.map((s) => s[1]).sort());
    for (const [guide, from, to, store, commission, price, name] of SWITCHES) {
      for (const list of [chunk(guide), built[guide]]) {
        expect(list.some((p) => p.href === from), `${guide}: ${from} still listed`).toBe(false);
        const rows = list.filter((p) => p.href === to);
        expect(rows.length, `${guide}: ${to}`).toBe(1);
        expect(rows[0], name).toMatchObject({ name, store, commission, price, priceAt: "2026-11-24" });
        // Amazon's photo is allowed only on an Amazon link: every switched pick shows a store photo, cut out.
        expect(String(rows[0].image)).not.toMatch(/amazon/);
        expectCutout(rows[0]);
        expect(RESEARCHED_STORES[store]?.hosts, store).toContain(new URL(to).hostname);
      }
    }
  });

  it("the Muck Arctic Pro carries Muck Boot's TAKE25 code, and the measured no-switch picks keep their links", () => {
    for (const list of [chunk("him"), built.him]) expect(list.find((p) => p.href === sm("110119003")), "Muck").toMatchObject({ code: "TAKE25", codeEnds: "2026-11-28" });
    for (const [guide, href] of KEPT) expect(chunk(guide).filter((p) => p.href === href).length, `${guide}: ${href}`).toBe(1);
    expect(RESEARCHED_STORES["store-elf"]?.name).toBe("e.l.f. Cosmetics");
  });
});

describe("owner 11-24: her Macy's adds", () => {
  it("each is on its guide once, Macy's 16%, at the price read 11-24, with a cutout photo", () => {
    expect(MACYS.length).toBeGreaterThan(10);
    for (const [guide, pin, price, name] of MACYS) {
      for (const list of [chunk(guide), built[guide]]) {
        const rows = list.filter((p) => p.href === sm(pin));
        expect(rows.length, `${guide}: ${name}`).toBe(1);
        expect(rows[0], name).toMatchObject({ name, store: "store-macys", commission: 16, price, priceAt: "2026-11-24" });
        expectCutout(rows[0]);
      }
    }
  });

  it("each Kids add has its maker's age and a girls/boys/everyone tag for the Kids filters", () => {
    const tags = (JSON.parse(readFileSync("src/content/giftGuideKidsTags.json", "utf8")) as { tags: Record<string, { gender?: string; ageMin?: number; ageSource?: string }> }).tags;
    for (const [guide, pin, , name] of MACYS.filter((m) => m[0] === "kids")) {
      const t = tags[tagKey(sm(pin))];
      expect(t, `${guide}: ${name}`).toBeTruthy();
      expect(["girls", "boys", "everyone"]).toContain(t.gender);
      expect(typeof t.ageMin, name).toBe("number");
      expect(t.ageSource, name).toMatch(/^macys\.com product page, read 2026-11-24: /);
    }
  });
});
