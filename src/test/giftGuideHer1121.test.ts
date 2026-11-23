/**
 * For Her is EXACTLY the owner's 54 saves (owner 2026-11-21: from her Amazon list, her Amazon cart and her ShopMy links;
 * owner 2026-11-22 removed the Floral Mama quarter zip, B0HJVYHH35; scripts/giftGuideHer1121.mjs). The generated page (src/content/giftGuidePicks/her.json) holds those links and no
 * other, in one flat list (no section), cheapest first; an Amazon pick never carries a price and keeps Amazon's own
 * photo; every ShopMy pick shows its checked price and a transparent cutout. The page shows no relationship chips and
 * no deals-and-codes box on For Her, and /mom, /wife ... still build from the same list.
 *
 * @mutate scripts/giftGuideHer1121.mjs |   return rankByPrice(rows).map(({ row: r, priceRank }) => { |   return rows.map((r) => ({ row: r, priceRank: null })).map(({ row: r, priceRank }) => {
 * @mutate scripts/giftGuideHer1121.mjs |     const shown = isAmazon(r) ? r.sortPrice : price; |     const shown = isAmazon(r) ? r.sortPrice + 1 : price;
 * @mutate scripts/giftGuideHer1121.mjs |     const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: HER_GUIDE, priceRank }; |     const p = { ...rest, image: r.image, ownerPick: true, from: HER_GUIDE, priceRank };
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {!isOwnerList(guide.slug) && <PeopleChips guide={guide} />} |       <PeopleChips guide={guide} />
 * @mutate src/content/giftGuidePeople.mjs | export const OWNER_LIST_GUIDES = ["her", "him", "kids"]; | export const OWNER_LIST_GUIDES = [];
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HER_ROWS, her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { PEOPLE_GUIDES, isOwnerList } from "@/content/giftGuidePeople.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
type Pick = { name: string; href: string; image?: string; store?: string; price?: number; priceAt?: string; section?: string; sectionId?: string; rels?: string[]; band?: number };
const page = (JSON.parse(readFileSync(join(ROOT, "src", "content", "giftGuidePicks", "her.json"), "utf8")).picks ?? []) as Pick[];

/** The owner's saves, copied from her Desktop notes (Her-saved-amazon-1121.md, Her-saved-shopmy-1121.md), not from the module. */
const AMAZON_ASINS = ["B0D3L9BYFZ", "B0CPB1MWMP", "B0FVFV7V1R", "B0FFMJMB6K", "B0FDKC619F", "B0C246HFWN", "B0FPCH9S11", "B0FKN7FGPY", "B0B1RWJ4QJ"];
/** Her Amazon cart saves (Her-saved-amazon-cart-1121.md; owner 2026-11-21: "we can have more than 25 items its fine"). Owner 11-22
 * ("Lake + Eberjey"): the Amazon Essentials flannel pajamas (B08X8P91FX) came off, so Her keeps two pajama sets. */
const CART_ASINS = ["B0CWRFQCWF", "B0CCWSGSCT", "B0D82LVR3N", "B0CDF7GJ4Y", "B0C7LTPXBV", "B0D7TR9PBZ", "B0F5N7S36V", "B0H42QZ8BW", "B0H2D9Q7CV",
  // Owner 11-21 ("women too"): the rest of her cart and saved-for-later, but the duplicate ZDEER listing and Mighty Patch.
  "B0HJ9ZJ8KM", "B091NJQ29P", "B0CMJZVT5P", "B0G6CR9TGW", "B0FSJQ3KJT", "B0F19YY96Z", "B0GT3W5DQL", "B0DT1CZ58V"];
// p-108755104 is her iHerb pin for the BIODANCE masks (11-21), replacing her Sephora UK pin p-108613754 that US shoppers cannot use.
const SHOPMY_PINS = ["p-108613972", "p-108755104","p-108613500", "p-108613356", "p-108613192", "p-108831058", "p-108607824", "p-107555566", "p-108605514", "p-108604684", "p-108604054"];
/**
 * Commission switches 11-21 (owner: "if the items on the guides can we fund at another place for higher commison just
 * change the link"; Desktop note Commission-switches-1121.md): the same item at the same price, moved from Amazon to a
 * better-paying store. TATCHA Kissu (Amazon B08D3FXF64, 10%) -> Tatcha 20%; L'OCCITANE Shea Butter Classics (Amazon
 * B0HFYLTJR7, 10%) -> Anthropologie 15%. 11-21 night (Commission-audit-1121-night.md): her Theragun Mini pin p-108612982
 * went to Haven Well Within, which has no Theragun ($0), so it uses her Ulta link p-107903671 (13%) instead.
 */
// Night links 11-21 (Commission-links-1121-night.md): YETI Camino Cape Taupe -> REI p-109006074 (Swank was out of the
// color); Crocs Dylan Sepia (Amazon B0CVLJ85KP, 4%) -> crocs.com p-108985937, 10%, $35.
// Rate switches 11-21 night (Commission-rates-search-1121-night.md), same item and price: Salt & Stone Saffron & Cedar
// (Amazon B0H2G28G12, 10%) -> Cos Bar p-109002459, 20%, $45; L'OCCITANE Softening Almond Trio (Amazon B0HFXZ9F46, 10%) ->
// Ulta p-109002206, 13%, $59.
const SWITCHED_PINS = ["p-108732256", "p-108732809", "p-107903671", "p-109006074", "p-108985937", "p-109002459", "p-109002206"];
// Launch day 11-22 (Desktop note Owner-adds-1122.md): the picks she sent as ShopMy links. Owner 11-22 PM ("Choose one"
// Camp Snap): the Camp Snap 2 Chestnut stays; the CS-Pro (p-107929179), the CS-8 camcorder (p-109141448) and the CS-8
// Micro keychain (p-108611500) are off.
const ADDS_1122_PINS = ["p-109140863", "p-109143437", "p-109143698", "p-109144140", "p-109144450", "p-109145379", "p-109145823",
  // Batch 2.
  "p-109147879", "p-109152557", "p-109153848", "p-109153960", "p-109153910", "p-109153811", "p-109151082", "p-109154746",
  // Batch 2b: The Sleepy Tie, Foton candle, and her Lake Hydrangea set (in place of her Lake pin that is gone from Lake's site).
  "p-109150422", "p-109158379", "p-103889077",
  // Batch 2c: Good Molecules patches, BISSELL Little Green Mini, Drowsy mask, Diptyque Baies, Madewell nightgown, Oura Ring 5.
  "p-109147619", "p-109151385", "p-109149968", "p-109152299", "p-109155568", "p-109155784",
  // builder-guide-links 11-22: Esker Bubble Soak.
  "p-109207730",
  // Owner 11-22 PM (builder-guide-emibauble): the BaubleBar brush and the EADEM New Classics Set moved from Kids (the red
  // Emi Jay clip p-109290718 was skipped: her Doe clip is already here).
  "p-109289957", "p-109155269"];
// Launch day 11-22, from her screenshots (no ShopMy pin for these): CFUNIQ toiletry bag, Astercook knives and pans,
// CASABREWS espresso machine, BISSELL FurGuard vacuum, eto decanter, Ozlo Sleepbuds 2.
const POPULAR_1122_ASINS = ["B0GGTPW6Q9", "B0HJ9ZXCSD", "B0DWHDM15Q", "B0F41DGFXT", "B0BGQT41ZZ"];
// Owner 11-22 PM: the Gaoye tortoise blue light glasses (B07XL9MFZQ) in place of the Stoggles safety glasses.
const ADDS_1122_ASINS = ["B0HKS18NW2", "B0C1YBPJ43", "B0F2937DQQ", "B09X3WGJ3R", "B0DQLLPYGM", "B0GP2R8TBS", "B0GZSMBDYZ", "B07XL9MFZQ"];
// owner 11-22 screenshot list (builder-guide-adds-2): the creators' gift lists she sent ("Add these for her if we don't
// have them yet"), each the same product as her picture (Desktop note Owner-adds-1122-screens.md), priced 2026-11-22.
// Owner 2026-11-22 ("Keep only Oura"): B0H1N3TWP1, the Ultrahuman Ring PRO, came off again. Owner 11-22 PM: the Mrs.
// Meyer's spray (B000S5VEA2), Downy beads (B0FGDQ5BT9), JAANUU underscrub (B0F831FK2R), Stoggles (B0B22SZ3W8) and the
// Comrad socks (p-103899561) came off.
const SCREENS_1122_ASINS = ["B0030F32L6", "B0DKG9CMH8", "B0GSMJTZJJ", "B0D3V61JC8", "B0CSV71DJV", "B0D2LV7DHF", "B00PCQW4P6", "B0CFPJYX7P",
  "B0DN245D58", "B0HN76TWQ2", "B0C6XK77HJ", "B0D858S2H5", "B0BLWTQ7JC", "B0H69TGK2F", "B07CDF1RVV", "B0G618GK4S", "B09WG9R7MY"];
const SCREENS_1122_PINS = ["p-104053242", "p-103903056", "p-103891549", "p-107936463", "p-103882819", "p-107936513", "p-107936484", "p-107887741",
  // Links made in her ShopMy 11-22 (owner: "You can create the links"; Desktop note ShopMy-links-created-1122.md).
  "p-109201389", "p-109202100", "p-109201186", "p-109200757", "p-109201629", "p-109200363", "p-109205545", "p-109205223",
  // Her Anthropologie Capri Blue Volcano Capiz Jar pin (11-19).
  "p-104056613"];
// XTRATUF's women's Camp Fleece boot at xtratuf.com through her CJ link (15%, as the Him XTRATUF boots).
const SCREENS_1122_CJ = ["https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxwadbc10"];
// Owner 11-22 PR picks (builder-guide-her3b).
const PR_PINS = ["p-107965795", "p-103880845", "p-104580620", "p-103889854", "p-103784739", "p-103878765", "p-103883109", "p-103877715"];
// builder-guide-her4 block 2 (11-22): from her screenshots, Amazon with her tag.
const HER4_1122_ASINS = ["B0H2FQ5FV1", "B0FXYGCYK6", "B0F5K3B4Q7", "B0CHMS3PVZ", "B0D7GQVNNN", "B0D1X4PNFD", "B0F7M3HPBD", "B0H3YXW87L", "B0H9L8Z1DY", "B0F79VTVFQ", "B0D92375JB", "B0G4M22BQL", "B0BGS3L9XS", "B0DXWP12C8", "B0HKYH5TF2", "B0H2CSG4SZ", "B0FXBBD5GS", "B0G3948RG8", "B0HKQYLRBB"];
// Owner 11-22 PM, "add all items" (Desktop note Louisiana-popular-candidates-1122.md, builder-guide-louisiana): the For Her
// Louisiana picks. Links made in her ShopMy that evening (ShopMy-links-created-1122.md) or reused from the hidden
// Louisiana guides (Katie Kime tray, Haydel's, Toups tallow, Match South); her Macy's Community Coffee pin opens a
// "page not found" now, so the 24-count box sold by Amazon.com stands in. Owner 11-22 PM ("Drop both"): the Desden LSU
// coin pouch (p-109343748, no ShopMy rate) is off.
const LOUISIANA_1122_ASINS = ["0935032029", "B07QDPPH7Z", "B0886YWV65", "B0915PDW38", "B002CMXGRI"];
const LOUISIANA_1122_PINS = ["p-109341967", "p-109342469", "p-109342173", "p-108006579", "p-108155517", "p-108155377", "p-107207657", "p-109340844"];
const SAVED = new Set([...[...LOUISIANA_1122_ASINS, ...HER4_1122_ASINS, ...AMAZON_ASINS, ...CART_ASINS, ...ADDS_1122_ASINS, ...SCREENS_1122_ASINS, ...POPULAR_1122_ASINS].map((a) => `https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`), ...[...SHOPMY_PINS, ...SWITCHED_PINS, ...ADDS_1122_PINS, ...SCREENS_1122_PINS, ...PR_PINS, ...LOUISIANA_1122_PINS].map((p) => `https://go.shopmy.us/${p}`), ...SCREENS_1122_CJ]);
const SCREENS_1122 = new Set(SCREENS_1122_ASINS.map((a) => `https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`));
const isAmazon = (p: Pick) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\//.test(p.href);

describe("For Her = the owner's saves (11-21)", () => {
  it("the page holds exactly her 159 links, once each, and nothing else", () => {
    expect(SAVED.size).toBe(159);
    expect(page.length).toBe(159);
    expect(new Set(page.map((p) => p.href))).toEqual(SAVED);
    // Owner 11-22, "Keep only Oura": the Ultrahuman ring is not on the page.
    expect(page.some((p) => p.href.includes("B0H1N3TWP1"))).toBe(false);
  });

  it("the generated page is exactly what the module builds (re-run scripts/gift-guide-picks.mjs after a change)", () => {
    expect(page).toEqual(her1121Picks());
  });

  it("is one flat list, cheapest first by the price she saw", () => {
    for (const p of page) {
      expect(p.section, p.name).toBeUndefined();
      expect(p.sectionId, p.name).toBeUndefined();
      // No budget band either: the budget chips stay off this list.
      expect(p.band, p.name).toBeUndefined();
    }
    const seen = new Map(HER_ROWS.map((r) => [r.href, r.sortPrice]));
    const prices = page.map((p) => seen.get(p.href) as number);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    // The cheapest is the eye gel ($4.77; the Mrs. Meyer's spray came off, owner 11-22 PM), then the YUDSUD leggings ($6.64).
    expect(page[0].name).toMatch(/eye gel/i);
    expect(page[1].name).toMatch(/^YUDSUD/);
    expect(page[page.length - 1].name).toMatch(/currentbody/i);
    // The module sorts by itself: fed in reverse, it still lists cheapest first.
    const again = her1121Picks([...HER_ROWS].reverse()).map((p) => seen.get(p.href) as number);
    expect(again).toEqual([...again].sort((a, b) => a - b));
  });

  // Owner 2026-11-21 ~12:05 PM: "each item also needs a price". Warned in a pop-up that Amazon allows prices only from
  // its PA-API feed and that showing them risks the Associates account, she chose "Show Amazon prices anyway". So an
  // Amazon pick now carries EXACTLY the price captured from her saved list (its sortPrice, Desktop notes 11-21), dated
  // 11-21; before, this guard asserted the opposite (no Amazon price). Two-way: every pick priced, none invented.
  it("an Amazon pick carries the price captured from her saved list and keeps Amazon's own photo; a ShopMy pick shows its checked price and a cutout", () => {
    const amazon = page.filter(isAmazon);
    const shopmy = page.filter((p) => !isAmazon(p));
    expect(amazon.length).toBe(80);
    expect(shopmy.length).toBe(79);
    const captured = new Map(HER_ROWS.map((r) => [r.href, r.sortPrice]));
    for (const p of amazon) {
      expect(p.price, p.name).toBe(captured.get(p.href));
      expect(p.price, p.name).toBeGreaterThan(0);
      // Her saved-list picks were captured 11-21; the Amazon picks from her launch-day screenshots, 11-22.
      expect(p.priceAt, p.name).toBe([...ADDS_1122_ASINS, ...POPULAR_1122_ASINS, ...HER4_1122_ASINS, ...LOUISIANA_1122_ASINS].some((a) => p.href.includes(a)) || SCREENS_1122.has(p.href) ? "2026-11-22" : "2026-11-21");
      expect(p.image, p.name).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\//);
    }
    for (const p of shopmy) {
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.image?.startsWith(CUTOUT_BASE), `${p.name}: ${p.image}`).toBe(true);
      const file = join(ROOT, "public", "gift-guides", "cutouts", String(p.image).slice(CUTOUT_BASE.length));
      expect(existsSync(file), file).toBe(true);
      const head = readFileSync(file).subarray(0, 32);
      expect(head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0, `${file} has no alpha`).toBe(true);
    }
  });

  it("no relationship chips or deals box on For Her and its relationship pages; each relationship page still has picks", () => {
    const her = PEOPLE_GUIDES.find((g) => g.slug === "her");
    expect(isOwnerList("her")).toBe(true);
    expect(isOwnerList("him")).toBe(true);
    expect(isOwnerList("kids")).toBe(true);
    expect(isOwnerList("teens")).toBe(false);
    for (const r of her?.rels ?? []) {
      expect(isOwnerList(r.slug), r.slug).toBe(true);
      expect(page.filter((p) => p.rels?.includes(r.slug)).length, r.slug).toBeGreaterThan(10);
    }
    expect(isOwnerList("dad")).toBe(true);
    const view = blankComments(readFileSync(join(ROOT, "src", "pages", "info", "giftGuides", "GiftGuideView.tsx"), "utf8"));
    expect(view).toContain("{!isOwnerList(guide.slug) && <PeopleChips guide={guide} />}");
    // Owner 11-21 ("Codes and deals shouldn't randomly show in sections"): no guide page carries the deals box at all.
    expect(view).not.toMatch(/<DealsAndCodes/);
  });

  it("the generator sets For Her after the final sweep (so no rule can drop one of hers) and before writing the pages", () => {
    const gen = blankComments(readFileSync(join(ROOT, "scripts", "gift-guide-picks.mjs"), "utf8"));
    const sweep = gen.indexOf("console.log(`gift-guide-picks: final sweep");
    const last = gen.lastIndexOf("applyHer1121(pageList, storeList)");
    const write = gen.indexOf("writeFileSync(new URL(`${slug}.json`, chunkDir)");
    expect(sweep).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(sweep);
    expect(write).toBeGreaterThan(last);
  });
});
