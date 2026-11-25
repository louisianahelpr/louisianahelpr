/**
 * For Him and For Kids are the owner's own Amazon saves (owner 2026-11-21: "i also added the mens stuff to the amazon
 * men list", "i did kids too in amazon list", "add all oft he things to the guides. fix them how you see fit. launch the
 * 3 guides"). Each page is ONE flat list, cheapest first, with at most 2 of a brand and 2 of an item type, every pick an
 * Amazon link with her tag and no price on the site, except the commission switches (11-21, owner: "if the items on the
 * guides can we fund at another place for higher commison just change the link"): the same item at the same price at a
 * better-paying store, a ShopMy link that shows its checked price and a transparent cutout of that store's own photo;
 * and her own ShopMy saves for men and kids (11-21: "i also added some man and kids stuff in shop my"; "the him and kids
 * need gifts on their covers"), shown the same way.
 * @mutate scripts/giftGuideHimKids1121.mjs | pageList[slug] = picks; | void picks;
 * @mutate scripts/giftGuideHimKids1121.mjs |     const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: slug, priceRank }; |     const p = { ...rest, image: r.image, ownerPick: true, from: slug, priceRank };
 * @mutate scripts/giftGuideHimKids1121.mjs |     const shown = isAmazon(r) ? r.sortPrice : price; |     const shown = isAmazon(r) ? r.sortPrice : undefined;
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIM_1121, HIM_POPULAR_1122, KIDS_POPULAR_1122, HIM_KEEPS_1123, KIDS_KEEPS_1123, HIM_LINKS_1123, HIM_WALMART_1123, KIDS_LINKS_1123, HIM_KIDS_PRICE_AT, HIM_KIDS_STORES, HIM_SHOPMY_1121, KIDS_1121, KIDS_PLAY_1122, KIDS_SHOPMY_1121, applyHimKids1121, him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { HIM_ADDS_1124, KIDS_ADDS_1124 } from "../../scripts/giftGuideOwner1124.mjs";
import { kidsThemeMovesLive1124 } from "../../scripts/giftGuideThemes1124.mjs";
import { AMAZON_BRAND_PHOTOS_1122, CUTOUT_BASE, cutoutPhoto } from "../../scripts/giftGuideCutouts1120.mjs";
import { HIM_ADDS_1122, KIDS_ADDS_1122 } from "../../scripts/giftGuideOwnerAdds1122.mjs";
import { recheckedPriceAt } from "../../scripts/giftGuidePriceRecheck.mjs";
import { AMAZON_PRICES_AT_1124, amazonPrice1124 } from "../../scripts/giftGuideAmazonPrices1124.mjs";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";

type Pick = { name: string; brand?: string; href: string; image: string; store: string; type?: string; price?: unknown; priceAt?: unknown; sortPrice?: unknown; rels?: string[] };
/**
 * The commission switches, copied from the Desktop note Commission-switches-1121.md (not from the module): LaCrosse
 * Grange (Amazon B001DPHF4U, 4%) -> Dillard's 8%; Theragun Prime 6th Gen (Amazon B0FKCJNHWB, 1%) -> Exclusive Beauty
 * Club 16%; XTRATUF Ankle Deck Boot (Amazon B08Q1RN656, Duck Camo, 4%) -> xtratuf.com through CJ 15% (owner 2026-11-21
 * ~10 PM, via lead: "xtratuf in the guide"; ~10:15 PM "do a different color for the boot because the cup is the same
 * print": the classic Chocolate/Tan, style 22734, $115 there, code XT25 on the card through Nov 29); Turtlebox Ranger,
 * Tan (Amazon B0F2JHSGCJ, 3%) -> Onward Reserve 15% at $250 (11-21 night, owner-approved). Kids has none.
 */
/**
 * Owner 11-22 PM, "add all items" (Desktop note Louisiana-popular-candidates-1122.md; builder-guide-louisiana): the
 * Louisiana picks for Him and Kids. Non-Amazon rows (link -> store) are the ShopMy links made in her ShopMy that evening
 * (ShopMy-links-created-1122.md), the Toups pins reused from the hidden Louisiana guides, and the kids' XTRATUF boot at
 * xtratuf.com through CJ (15%); the Amazon rows were priced 11-22. Owner 11-22 PM ("Drop both"): the Southern Marsh
 * youth chino (p-107857942, no ShopMy rate) is off.
 */

/**
 * Brand photo cutouts that stand in for Amazon's photo on named Amazon picks (owner 2026-11-22 8:58 PM, "Brand photo
 * cutout"; links audit 1122 night #5: every photo in those Amazon listings has a background). Named here by ASIN, so the
 * exception stays narrow and two-way: the module's list must equal this one, and each id must be on its page.
 */
const BRAND_PHOTO_IDS_1122 = { B0F5N7S36V: "her", B0D9PX9RBD: "him" } as const;
const asinOf = (href: string) => /\/dp\/([A-Z0-9]{10})/.exec(href)?.[1] ?? "";
/** An Amazon pick shows Amazon's own photo, or (named above) its brand's photo as a transparent cutout from a non-Amazon host. */
function expectAmazonPickPhoto(p: { name: string; href: string; image?: string }) {
  const brand = (AMAZON_BRAND_PHOTOS_1122 as Record<string, string>)[asinOf(p.href)];
  if (!brand) {
    expect(p.image, p.name).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\//);
    return;
  }
  expect(new URL(brand).hostname, p.name).not.toMatch(/amazon/);
  expect(p.image, p.name).toBe(cutoutPhoto(brand));
  expect(String(p.image).startsWith(CUTOUT_BASE), p.name).toBe(true);
  const head = readFileSync(`public/gift-guides/cutouts/${String(p.image).slice(CUTOUT_BASE.length)}`).subarray(0, 32);
  expect(head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0, `${p.name} cutout has no alpha`).toBe(true);
}

const LOUISIANA_1122: Record<string, Record<string, string>> = {
  him: { "https://go.shopmy.us/p-109340963": "store-lodge", "https://go.shopmy.us/p-108155418": "store-toups-and-co", "https://go.shopmy.us/p-109342284": "store-mignon-faget" },
  kids: { "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxkab100y": "store-xtratuf", "https://go.shopmy.us/p-109341055": "store-duck-commander", "https://go.shopmy.us/p-109341153": "store-toups-and-co" },
};
const LOUISIANA_1122_ASINS: Record<string, string[]> = {
  him: ["B0000BXHL5", "B000FTUTL6", "B00144CM2U", "B0HG3RLK77", "0935032509", "B09GCYJ8RM", "B07GG7K5SD"],
  kids: ["1455627143", "B08GVN1J37", "B074YZWKMB", "B0792C316R", "B0CCBMLJM5", "1455625639", "0142500704"],
};
const louisianaAmazon = new Set(Object.values(LOUISIANA_1122_ASINS).flat().map((a) => `https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`));
const SWITCHED: Record<string, Record<string, string>> = {
  him: { "https://go.shopmy.us/p-108736038": "store-dillards", "https://go.shopmy.us/p-108734364": "store-exclusive-beauty-club", "https://go.shopmy.us/p-108736312": "store-onward-reserve", 
    // Night links 11-21 (Commission-links-1121-night.md; owner: "switch all 3 to the higher commission"):
    "https://go.shopmy.us/p-108999848": "store-onward-reserve", "https://go.shopmy.us/p-109000336": "store-l-l-bean", "https://go.shopmy.us/p-109001581": "store-yeti", "https://go.shopmy.us/p-109003412": "store-yeti", "https://go.shopmy.us/p-109003630": "store-yeti", "https://go.shopmy.us/p-109003793": "store-yeti", "https://go.shopmy.us/p-109003951": "store-yeti", "https://go.shopmy.us/p-109004058": "store-yeti", "https://go.shopmy.us/p-109004159": "store-yeti", "https://go.shopmy.us/p-109004254": "store-yeti", "https://go.shopmy.us/p-109004991": "store-tractor-supply", "https://go.shopmy.us/p-109005400": "store-tractor-supply",
    "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2F22734": "store-xtratuf",
    // Rate switches 11-21 night (Commission-rates-search-1121-night.md): 3 XTRATUF at xtratuf.com via CJ 15% (XT25), TNF beanie at
    // JD Sports 15%, Burlebo hoodie and cap at burlebo.com 12%.
    "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxmabmob": "store-xtratuf",
    "https://go.shopmy.us/p-109003932": "store-jd-sports", "https://go.shopmy.us/p-109005228": "store-burlebo", "https://go.shopmy.us/p-109005373": "store-burlebo",
    // Launch day 11-22 (Owner-adds-1122.md): her older Lake Pajamas pins, sent for Him.
    "https://go.shopmy.us/p-103892269": "store-lake-pajamas", "https://go.shopmy.us/p-104054474": "store-lake-pajamas",
    // Batch 1 for Him 11-22: her Nov 19 pins (prices as checked 11-20).
    "https://go.shopmy.us/p-107850277": "store-l-l-bean", "https://go.shopmy.us/p-107837448": "store-l-l-bean",
    // The Muck Arctic Pro was The Warming Store p-107881822 (8%) until the 11-24 switch (SWITCHED_1124 below).
    "https://go.shopmy.us/p-107847793": "store-cavenders", "https://go.shopmy.us/p-107895312": "store-tractor-supply", "https://go.shopmy.us/p-109208695": "store-smathers-and-branson",
    "https://go.shopmy.us/p-109208941": "store-marley-lilly",
    "https://go.shopmy.us/p-107895486": "store-tractor-supply",
    // builder-guide-links 11-22.
    "https://go.shopmy.us/p-109199365": "store-saks-fifth-avenue", "https://go.shopmy.us/p-109203985": "store-st-bernard",
    // Batch 3 11-22.
    "https://go.shopmy.us/p-108089555": "store-jomashop", "https://go.shopmy.us/p-108094779": "store-l-l-bean" },
  // Rate switch 11-21 night: Segway Ninebot S2 (Amazon B0CT2WN59R, 3%) -> Tractor Supply 8% at $484.99.
  kids: { "https://go.shopmy.us/p-109001528": "store-tractor-supply",
    // Launch day 11-22 (Owner-adds-1122.md): her two Camp Snap 2 colors, pinned at The Swank Company (p-109142125,
    // p-109142226, $69.99), are on her Camp Snap direct pins instead (owner 11-22: the $59.99 sale and her code LEXILOMBAS7).
    "https://go.shopmy.us/p-107929152": "store-camp-snap", "https://go.shopmy.us/p-104219842": "store-camp-snap",
    // Owner 11-22 PM (builder-guide-emibauble): the Pottery Barn Kids Anywhere Chair (her new pin, 6%) in place of the
    // Melissa & Doug Club Chair; the EADEM New Classics Set moved to Her.
    "https://go.shopmy.us/p-109292071": "store-pottery-barn-kids",
    // Owner via the lead, 11-22: both Yoto 4th Gen bundles (Ms. Rachel, Bluey).
    "https://go.shopmy.us/p-109156467": "store-yoto", "https://go.shopmy.us/p-109156399": "store-yoto",
    "https://go.shopmy.us/p-109208209": "store-crunchlabs", "https://go.shopmy.us/p-103757260": "store-maisonette", "https://go.shopmy.us/p-109208104": "store-target" },
};
/**
 * Her ShopMy saves kept on each page (11-21), copied from the Desktop notes Him-saved-shopmy-1121.md and
 * Kids-saved-shopmy-1121.md (pin -> the store it goes to), not from the module. The rest were left out by her rules:
 * a third of one brand (Smathers & Branson, Melissa & Doug), a third of one item type, LSU (until the owner's 11-21 PM
 * "You can list LSU stuff"), or out of stock on 11-21.
 */
const sm = (pins: string[], store: string) => Object.fromEntries(pins.map((p) => [`https://go.shopmy.us/p-${p}`, store]));
const SAVES: Record<string, Record<string, string>> = {
  him: {
    ...sm(["108628349"], "store-smathers-and-branson"), ...sm(["108628518"], "store-duck-head"),
    ...sm(["108626053", "108626036", "108625988"], "store-grove"), ...sm(["108625882", "108625877"], "store-clinique"),
    // Owner 2026-11-22 ("remove"): the Dr. Squatch Fresh Falls Bar Soap (108626008) is off.
    // Owner 11-21 ("Him = ALL of her men's saves"): every other in-stock, non-LSU Smathers & Branson save, two more Dr. Squatch.
    ...sm(["108628554", "108628535", "108628533", "108628457", "108628432", "108628429", "108628421", "108628411", "108628379", "108628348", "108628058", "108628052", "108628047"], "store-smathers-and-branson"),
    ...sm(["108626037", "108625979"], "store-grove"),
    // Owner 2026-11-21 PM ("You can list LSU stuff"): her in-stock LSU saves (the sunglass strap and luggage tag were sold out).
    ...sm(["108628318", "108628311", "108628309", "108628296", "108628280", "108628276", "108628274", "108628018"], "store-smathers-and-branson"),
    // Owner 2026-11-21 PM ("Find a replacement for the yeti backpack one with a price"): the same Crossroads backpack on her YETI pin.
    ...sm(["107838580"], "store-yeti"),
    // Owner 11-22 him picks (builder-guide-him): Smathers & Branson Tervis, can cooler, card wallet, toiletry bag.
    ...sm(["108101578", "108104267", "108108365", "108101625", "108108555"], "store-smathers-and-branson"),
  },
  kids: {
    ...sm(["108632461", "108632432", "108632392", "108632273", "108632257", "108632317", "108632251", "108632230", "108632184", "108632365", "108632379", "108632481", "108632592"], "store-maisonette"),
    ...sm(["108632104"], "store-grove"), ...sm(["108632077", "108632046"], "store-wayfair"),
    // Owner 11-21 ("same for the kids, add all items i had on the things"): every other kids save still sold.
    ...sm(["108632430", "108632133"], "store-maisonette"),
    // Owner 11-22 PM: the Melissa & Doug Club Chair (108632059, Wayfair) is off for the Pottery Barn Kids chair.
    ...sm(["108632004", "108631991", "108631978"], "store-macys"),
    // Rate switch 11-21 night: the Jumbo Cardboard Blocks moved from Wayfair p-108632086 (11%) to Macy's p-109002741 (16%), $32.99.
    ...sm(["109002741"], "store-macys"),
    // Owner 11-22 play saves (builder-guide-adds-kids).
    ...sm(["109160969", "109160922", "109160891", "109160773", "109160887", "109160813", "109160795", "109160719", "109160708", "109160660"], "store-wayfair"),
    ...sm(["109160077"], "store-macys"),
    // Owner 11-22 kids picks 2 (builder-guide-kids2).
    ...sm(["109218761"], "store-target"), ...sm(["107902887"], "store-burts-bees-baby"),
    ...sm(["108100673"], "store-maisonette"), ...sm(["107895388"], "store-tractor-supply"),
  },
};
/**
 * The owner's 11-23 keeps whose ShopMy links were made later that day (Desktop held-links-1123.json): the Lodge skillet on
 * Him; the Maisonette toys and the Burt's Bees Baby pajamas on Kids.
 */
const LINKS_1123: Record<string, Record<string, string>> = {
  him: { ...sm(["109739556"], "store-lodge"), "https://walmrt.us/4j41V4c": "store-walmart" },
  kids: { ...sm(["109730393", "109730847", "109730984", "109731305", "109731598"], "store-maisonette"), ...sm(["109731941"], "store-burts-bees-baby") },
};
/**
 * The Black Friday steals she ticked for the guides (owner 11-24 ~1:45 AM, ~/.lh-shots/steals-to-guides-1124.md; her
 * Walmart links ~2:35 AM), copied from the links made that night (~/.lh-shots/later-switches-1124/steals-links.json), not
 * from the module (scripts/giftGuideSteals1124.mjs): Him S1 (Macy's) and S33 (Walmart Creator); Kids S19-S27 (Target via
 * ShopMy, S21 the Stanley tumbler), her 4 Walmart links and S28-S30 (Walmart Creator).
 */
const STEALS_1124: Record<string, Record<string, string>> = {
  him: { ...sm(["110122396", "110122844"], "store-macys"), ...sm(["110135239"], "store-crocs"), "https://mavely.app.link/y7KIsnyak8b": "store-kohls", "https://walmrt.us/3XKh0AM": "store-walmart" },
  kids: {
    ...sm(["110125767", "110125685", "110125702", "110125781", "110125801", "110125818", "110125837", "110125353"], "store-target"),
    ...Object.fromEntries(["4CpL44Q", "4fSzHIL", "4jcx3OU", "3V7qKEv", "4zIzr6p", "4AQxuWv", "4CcMa3A", "3VHA424", "4eUyq3F", "4lc3orK", "4zETfHG", "4eVQ07i", "4AXpPpv", "4eWzgNd", "4iW9on6", "48Ej3ZE", "4j1P1VH", "4fPIaMM", "3VHakCW", "4tjUhqV", "4lbUIl6", "4lbUESo", "4A7xCkw", "4AQzIVE", "4AaBwJk", "4tlQ2eK", "4eZnjGG", "4Aa49X8", "4ARwgKs", "3Vg2vDU", "4tfD9Tf", "3Vj4Kqe", "4tl8fZF", "4tgDB3I", "4A0YC4p", "4zGPOjQ", "48I4xQr", "4kzGB9d", "4jBxIKf", "4jaUUPc", "4jb5vcF", "4j9FpqC", "4A1HtrP", "4jamQm7", "3X7CzuU", "4A1xnHu", "4fqQX7K", "4jb5wgJ", "4jhFZmp", "4j8cZ03", "3Vfu4xm", "4ANUqp7", "4ku91Bo", "4texdKc"].map((c) => [`https://walmrt.us/${c}`, "store-walmart"])),
    ...sm(["110699595"], "store-target"),
    ...Object.fromEntries(["https://mavely.app.link/mQ3bdqWDl8b", "https://mavely.app.link/fqxGCAWDl8b", "https://mavely.app.link/1aPI2KWDl8b", "https://mavely.app.link/1i1TtVWDl8b", "https://mavely.app.link/Rut9K5WDl8b", "https://mavely.app.link/1fbvugXDl8b", "https://mavely.app.link/e3OCqrXDl8b", "https://mavely.app.link/VjBJoCXDl8b", "https://mavely.app.link/ZxaYRVXDl8b", "https://mavely.app.link/vgUK49XDl8b", "https://mavely.app.link/LUeIqlYDl8b", "https://mavely.app.link/XeknLvYDl8b", "https://mavely.app.link/5mhK5l0Dl8b", "https://mavely.app.link/7QubVC0Dl8b", "https://mavely.app.link/wZWXGO0Dl8b", "https://mavely.app.link/2hIOUY0Dl8b", "https://mavely.app.link/lAc8De1Dl8b", "https://mavely.app.link/5QNqNo1Dl8b", "https://mavely.app.link/j53Kfz1Dl8b", "https://mavely.app.link/YteYEJ1Dl8b", "https://mavely.app.link/6EGA1T1Dl8b", "https://mavely.app.link/eLRI671Dl8b", "https://mavely.app.link/phkEti2Dl8b"].map((h) => [h, "store-jcpenney"])),
    ...Object.fromEntries(["https://mavely.app.link/7hnOQCcGl8b", "https://mavely.app.link/C7qabzgGl8b", "https://mavely.app.link/kzmOaJgGl8b", "https://mavely.app.link/nz2t3xiGl8b", "https://mavely.app.link/Vd9SWHiGl8b", "https://mavely.app.link/FFeATSiGl8b", "https://mavely.app.link/F0aXA3iGl8b", "https://mavely.app.link/Qw4Y2djGl8b", "https://mavely.app.link/9VRXk5kGl8b", "https://mavely.app.link/G4VkFflGl8b", "https://mavely.app.link/8OJevqlGl8b", "https://mavely.app.link/hRAxiBlGl8b", "https://mavely.app.link/yS22DLlGl8b", "https://mavely.app.link/WHKsiknGl8b", "https://mavely.app.link/fd1RVunGl8b", "https://mavely.app.link/repxKInGl8b", "https://mavely.app.link/Cx8yzTnGl8b", "https://mavely.app.link/wY4lB4nGl8b", "https://mavely.app.link/fnOhMEpGl8b", "https://mavely.app.link/F3147OpGl8b", "https://mavely.app.link/zDsVGZpGl8b", "https://mavely.app.link/ZL7PwlrGl8b", "https://mavely.app.link/YY7h4vrGl8b", "https://mavely.app.link/4u6AoErGl8b", "https://mavely.app.link/kn5OcRrGl8b"].map((h) => [h, "store-jcpenney"])),
    ...Object.fromEntries(["https://go.shopmy.us/p-110718740", "https://go.shopmy.us/p-110718757", "https://go.shopmy.us/p-110718832", "https://go.shopmy.us/p-110718853", "https://go.shopmy.us/p-110718866"].map((h) => [h, "store-kohls"])),
    "https://mavely.app.link/yftqKoJ9j8b": "store-kohls",
    ...sm(["110122442", "110122526", "110122583", "110122602", "110122700", "110122792"], "store-macys"),
    ...sm(["110135306", "110137252"], "store-crocs"),
  },
};
/**
 * The owner's 11-24 changes (scripts/giftGuideOwner1124.mjs; owner ~1:10 AM "[if we have a] higher commission no need to
 * ask", ~2:05 / ~2:15 AM her Macy's screenshots), copied from the links made in her ShopMy and Later that night, not from
 * the module: Him's Columbia hat and fleece (Amazon 4% -> columbia.com through Later 8.4%; the fleece is the 2.0 version
 * columbia.com sells) and the Muck Arctic Pro (The Warming Store 8% -> muckbootcompany.com 16%); Kids' 7 Macy's adds (16%).
 */
const SWITCHED_1124: Record<string, Record<string, string>> = {
  him: { "https://mavely.app.link/rBTVe27Zj8b": "store-columbia", "https://mavely.app.link/LP97ij8Zj8b": "store-columbia", "https://go.shopmy.us/p-110119003": "store-muck-boot", "https://walmrt.us/4zZkihX": "store-walmart", "https://mavely.app.link/MYePdejfk8b": "store-scheels", "https://mavely.app.link/SGyD34lfk8b": "store-scheels", "https://mavely.app.link/3DJNEdpfk8b": "store-scheels", ...STEALS_1124.him },
  kids: { ...sm(["110119731", "110119881", "110119923", "110119952", "110119982", "110120034", "110120060"], "store-macys"), "https://walmrt.us/4jpdmER": "store-walmart", "https://mavely.app.link/iqXO1Sgtl8b": "store-kohls", ...STEALS_1124.kids },
};
// p-109001581 / p-109004991 / p-109004058: the YETI Tundra 45, Hopper Flip 12 and Sidekick Dry to SCHEELS via Later 7% (lead ~4:20 AM, Pace Purple, about 30% off).
const SWITCHED_AWAY_1124 = ["B0FY9LPSCW", "B0076R6MN4", "p-107881822", "B0H51ZX6SB", "p-109001581", "p-109004991", "p-109004058"];
/**
 * Lead 11-24 ~3:55 AM (owner rule "higher commission, no need to ask"): Him's 2 Clinique For Men ShopMy saves (clinique.com
 * 21%) moved to Amazon at the same price, where her accepted Clinique Creator Connections campaign pays 30%. Old -> new.
 * They keep the clinique.com cutout, so they stay with the store-photo picks.
 */
const TO_AMAZON_1124: Record<string, string> = {
  "https://go.shopmy.us/p-108625882": "https://www.amazon.com/dp/B00IPWN1LK?tag=louisianahelpr-20",
  "https://go.shopmy.us/p-108625877": "https://www.amazon.com/dp/B00P4WVQNE?tag=louisianahelpr-20",
};
/** The Kids picks that moved to their themed guide 11-24 (src/test/giftGuideKidsThemeRow1124.test.tsx guards the move). */
const MOVED_TO_THEME = new Set(kidsThemeMovesLive1124().map((m: { href: string }) => m.href));
const notAmazon = (slug: string): Record<string, string> => {
  const all: Record<string, string> = { ...SWITCHED[slug], ...SAVES[slug], ...LOUISIANA_1122[slug], ...LINKS_1123[slug], ...SWITCHED_1124[slug] };
  for (const [from, to] of Object.entries(TO_AMAZON_1124)) if (all[from]) { delete all[from]; all[to] = "store-amazon"; }
  // A ShopMy save switched away 11-24 is no longer on the page under its old link.
  for (const gone of SWITCHED_AWAY_1124) if (gone.startsWith("p-")) delete all[`https://go.shopmy.us/${gone}`];
  // Owner 11-24 ~2:05 PM: a Kids pick on its themed guide's page left Kids (scripts/giftGuideKidsThemeMoves1124.mjs).
  if (slug === "kids") for (const href of MOVED_TO_THEME) delete all[href];
  return all;
};
const popular = new Set([...HIM_POPULAR_1122, ...KIDS_POPULAR_1122].map((r) => r.href));
const keeps = new Set([...HIM_KEEPS_1123, ...KIDS_KEEPS_1123].map((r) => r.href));
/** Links audit 1122 night #4: her saved color had no Buy Box, so the same item in a color Amazon sells stands in (priced 11-22). */
const LINK_FIXES_1122: Record<string, string> = { B08Z42695Q: "B0CSJ4TC52", B0084JUNVU: "B0084JUNXS" };
const linkFix = new Set(Object.values(LINK_FIXES_1122).map((a) => `https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`));
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const most = (xs: string[]) => Math.max(0, ...Object.values(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})));

describe.each([
  ["him", [...HIM_1121, ...HIM_ADDS_1122, ...HIM_POPULAR_1122, ...HIM_KEEPS_1123, ...HIM_LINKS_1123, ...HIM_WALMART_1123, ...HIM_ADDS_1124], him1121Picks() as Pick[]],
  ["kids", [...KIDS_1121, ...KIDS_ADDS_1122, ...KIDS_POPULAR_1122, ...KIDS_KEEPS_1123, ...KIDS_LINKS_1123, ...KIDS_ADDS_1124].filter((r) => !MOVED_TO_THEME.has(r.href)), kids1121Picks() as Pick[]],
])("For %s is the owner's Amazon and ShopMy saves (11-21)", (slug, rows, built) => {
  const page = chunk(slug);

  it("the live page is exactly the module's list, in order", () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(page.length).toBe(rows.length);
    expect(page.map((p) => p.href)).toEqual(built.map((p) => p.href));
    expect(new Set(page.map((p) => p.href)).size).toBe(page.length);
  });

  // Owner 2026-11-21 ~12:05 PM: "each item also needs a price"; she chose "Show Amazon prices anyway" after the pop-up
  // warning that Amazon allows prices only from its PA-API feed (Associates risk). An Amazon pick now shows EXACTLY the
  // price captured from her saved list (its row's sortPrice), dated 11-21; this guard used to assert no Amazon price.
  it("every pick is an Amazon link with her tag, Amazon's own photo and its captured price, except the switches and her ShopMy saves", () => {
    const switched = notAmazon(slug);
    expect(page.filter((p) => switched[p.href]).length).toBe(Object.keys(switched).length);
    const captured = new Map(rows.map((r) => [r.href, r.sortPrice]));
    for (const p of page) {
      expect(p.sortPrice).toBeUndefined();
      if (switched[p.href]) continue;
      expect(p.href).toMatch(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=louisianahelpr-20$/);
      expectAmazonPickPhoto(p);
      expect(p.store).toBe("store-amazon");
      // Kids Black Friday sweep 11-24: a price re-read on Amazon that changed replaces the captured one, dated that day.
      const reread = amazonPrice1124(p.href);
      expect(p.price, p.name).toBe(reread ?? captured.get(p.href));
      expect(p.price, p.name).toBeGreaterThan(0);
      // Captured from her saved lists 11-21; the Battery Daddy she asked for on launch day and the Dad fill-in book (owner
      // 11-22 screenshot list, B0GWXJ3PYM) and the popular adds (builder-guide-popular) and the GE Opal Mini (builder-guide-him, 2026-11-22) were priced 11-22.
      // The owner's 11-23 keeps (scripts/giftGuideOwnerKeeps1123.mjs) were priced 11-23.
      const day = keeps.has(p.href) ? "2026-11-23" : p.href.includes("B089F9YDFC") || p.href.includes("B0GWXJ3PYM") || p.href.includes("B0H51ZX6SB") || popular.has(p.href) || louisianaAmazon.has(p.href) || linkFix.has(p.href) ? "2026-11-22" : "2026-11-21";
      expect(p.priceAt, p.name).toBe(reread !== undefined ? AMAZON_PRICES_AT_1124 : recheckedPriceAt(p.href, p.price, day));
      // The unbuyable links never come back.
      for (const gone of Object.keys(LINK_FIXES_1122)) expect(p.href.includes(gone), `${p.name}: ${gone}`).toBe(false);
    }
  });

  it("a switched pick or ShopMy save shows its checked price and a transparent cutout of the store's photo, never Amazon's", () => {
    const shop = notAmazon(slug);
    // Both the generated page and what the module builds now (so a module change shows before the page is regenerated).
    expect(page.filter((x) => shop[x.href])).toEqual(built.filter((x) => shop[x.href]));
    for (const p of [...page, ...built].filter((x) => shop[x.href])) {
      expect(p.store, p.name).toBe(shop[p.href]);
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.image.startsWith(CUTOUT_BASE), `${p.name}: ${p.image}`).toBe(true);
      const file = `public/gift-guides/cutouts/${p.image.slice(CUTOUT_BASE.length)}`;
      expect(existsSync(file), file).toBe(true);
      const head = readFileSync(file).subarray(0, 32);
      expect(head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0, `${file} has no alpha`).toBe(true);
    }
  });

  it("is cheapest first", () => {
    // Kids BF sweep 11-24: an Amazon price re-read that day ranks at the re-read price.
    const at = (r: { href: string; sortPrice: number }) => amazonPrice1124(r.href) ?? r.sortPrice;
    const sorted = [...rows].sort((a, b) => at(a) - at(b));
    // Owner 2026-11-22 ("put the ducks designs together ..."): only ties may move, a same-brand same-design row next to
    // its group (src/test/giftGuideSameDesignTogether1122.test.ts); the prices in order and the rows are exactly these.
    const price = new Map(rows.map((r) => [r.href, at(r)]));
    expect(page.map((p) => price.get(p.href))).toEqual(sorted.map((r) => at(r)));
    expect([...page.map((p) => p.href)].sort()).toEqual([...(sorted as unknown as Pick[]).map((r) => r.href)].sort());
  });

  // Owner 2026-11-21: "Him = ALL of her men's saves" and "same for the kids": brand and type caps off for her own picks
  // (each page held at most 2 of a brand and 2 of a type until then), so a brand she saved many of shows many times.
  it("holds every save of a brand she saved many of (the 2-per-brand cap is off for her own picks)", () => {
    expect(most(page.map((p) => p.brand ?? "").filter(Boolean))).toBeGreaterThan(2);
  });

  it("shows as one flat owner list (no chips, no codes box)", () => {
    expect(isOwnerList(slug)).toBe(true);
  });
});

describe("her ShopMy saves for Him and Kids (11-21)", () => {
  it("every kept save is on its page with the price checked 11-21, and its store has a shown name", () => {
    for (const [slug, rows] of [["him", HIM_SHOPMY_1121], ["kids", [...KIDS_SHOPMY_1121, ...KIDS_PLAY_1122]]] as const) {
      expect(new Set(rows.map((r) => r.href)), slug).toEqual(new Set(Object.keys(SAVES[slug])));
      const page = chunk(slug);
      for (const r of rows) {
        if (TO_AMAZON_1124[r.href]) {
          expect(page.some((x) => x.href === r.href), r.name).toBe(false);
          expect(page.find((x) => x.href === TO_AMAZON_1124[r.href]), r.name).toMatchObject({ name: r.name, price: r.price, store: "store-amazon", commission: 30 });
          continue;
        }
        // A save that moved to its themed guide 11-24 (the seven Melissa & Doug picks) is off Kids; its theme page shows it
        // (src/test/giftGuideKidsThemeRow1124.test.tsx).
        if (slug === "kids" && MOVED_TO_THEME.has(r.href)) {
          expect(page.some((x) => x.href === r.href), r.name).toBe(false);
          continue;
        }
        const p = page.find((x) => x.href === r.href);
        expect(p, r.name).toBeDefined();
        expect(p?.price, r.name).toBe(r.price);
        // A daily re-check at this exact price moves the day forward (scripts/giftGuidePriceRecheck.mjs); nothing else does.
        expect(p?.priceAt, r.name).toBe(recheckedPriceAt(r.href, r.price, slug === "kids" && KIDS_PLAY_1122.some((x) => x.href === r.href) ? "2026-11-22" : HIM_KIDS_PRICE_AT));
        expect(HIM_KIDS_STORES[r.store], r.store).toBeTruthy();
        expect(r.brand.toLowerCase(), r.name).not.toMatch(/vineyard vines|lilly pulitzer/);
      }
    }
    expect(HIM_SHOPMY_1121.length).toBe(36);
    expect(KIDS_SHOPMY_1121.length).toBe(22); // 23 until the owner swapped the Melissa & Doug Club Chair for the Pottery Barn Kids chair (11-22 PM)
  });
});

describe("For Him holds every one of her men's saves (owner 11-21)", () => {
  it("its brand-photo picks (named by ASIN) show the brand's cutout, never Amazon's photo", () => {
    const named = Object.entries(BRAND_PHOTO_IDS_1122).filter(([, slug]) => slug === "him").map(([asin]) => asin);
    expect(named.length).toBeGreaterThan(0);
    for (const asin of named) {
      const rows = chunk("him").filter((p) => asinOf(p.href) === asin);
      expect(rows.length, asin).toBe(1);
      expectAmazonPickPhoto(rows[0]);
      expect(rows[0].image, asin).not.toMatch(/media-amazon/);
    }
  });

  it("91 of the 122 Amazon rows in Him-saved-amazon-1121.md are on the page, with the 31 left out named", () => {
    // Owner 2026-11-22: B09R5TGLFR Chemical Guys Car Cleaning Kit ($31.90) is off too; the Wontolf kit is the only car wash kit.
    // Owner 2026-11-22 ("remove"): B0CQ4QM7Q2 Men's Fuzzy Cloud Socks are off. Owner 2026-11-22 ("only keep the one with
    // the higher commission"): B0732FCCL4 Armor All Ultimate Car Cleaning Kit (3% x $38.91) is off; the Wontolf kit (3% x $40.79) stays.
    // Left out, 2026-11-21: B001DPHF4U LaCrosse Grange, B0FKCJNHWB Theragun Prime and B08Q1RN656 XTRATUF Ankle Deck Boot, B0F2JHSGCJ Turtlebox Ranger and the 14 night links 11-21
    // (Turtlebox Gen 3, Roadie 32, 9 YETI at YETI US, 3 Wetlands Camo YETI at Tractor Supply)
    // (on the page at their better-paying
    // stores, above), B0002A7GMS / B07M9LRQ4J / B0FDXLSNN1 (second listings of the same items), B09ZYT939N YETI
    // Crossroads Backpack (Amazon showed no price), and the 6 rate switches 11-21 night (3 XTRATUF, TNF beanie, Burlebo hoodie + cap).
    // Plus the Battery Daddy (B089F9YDFC), which the owner asked for on 11-22, and B0GWXJ3PYM, the Dad fill-in book (owner
    // via the lead 11-22, her screenshot list), and Him batch 2's GE Opal Mini: none is from her saved list.
    const amazon = chunk("him").filter((p) => p.store === "store-amazon").map((p) => /\/dp\/([A-Z0-9]{10})/.exec(p.href)![1]).filter((a) => a !== "B089F9YDFC" && a !== "B0GWXJ3PYM" && a !== "B0H51ZX6SB" && a !== "B00IPWN1LK" && a !== "B00P4WVQNE" && !LOUISIANA_1122_ASINS.him.includes(a));
    for (const gone of SWITCHED_AWAY_1124) expect(chunk("him").some((p) => p.href.includes(gone)), gone).toBe(false);
    // The 2 Clinique For Men picks that moved from ShopMy to Amazon 11-24 (TO_AMAZON_1124) are not from her saved Amazon list.
    expect(amazon.length).toBe(118); // 120 until the Columbia hat and fleece moved to columbia.com 11-24 (SWITCHED_1124). 120 = 97 + the 14 Amazon keeps of 11-23 and the 9 of her second keeps (scripts/giftGuideOwnerKeeps1123.mjs). 97 = 91, minus the 2 dupe removals (GoBox Collection, RAK tool), plus 3 owner-approved adds (Banded handwarmer, Klola mat, and the MVP PRO men's 2-pack B0D9PX9RBD: the brown listing was women's), plus the 5 popular adds of 11-22 (AirPods, AirTags, Bose, Garmin, Gozney)
    expect(chunk("him").filter((p) => p.href.includes("B089F9YDFC")).length).toBe(1);
    expect(chunk("him").filter((p) => p.href.includes("B0GWXJ3PYM")).length).toBe(1);
    for (const asin of ["B001DPHF4U", "B0FKCJNHWB", "B08Q1RN656", "B0F2JHSGCJ", "B0F22HTHMJ", "B0D1RJZCWZ", "B0H7CRMDKS", "B0DVM13SRM", "B0DVM24NF8", "B0B64CJZQQ", "B0D9QXT97F", "B0DHHK1YP7", "B0D9QX9F67", "B0H7CNPH2S", "B0H7DRWL2T", "B0FDYG11V3", "B0FDYD1C2N", "B0FDY7G84C", "B0002A7GMS", "B07M9LRQ4J", "B0FDXLSNN1", "B09ZYT939N", "B0998FYXLS", "B082JHQP7N", "B0GV4BKM4W", "B0DQF73JH4", "B0FT97QYYZ", "B08P2C446P", "B0CQ4QM7Q2", "B0732FCCL4", "B09R5TGLFR"]) expect(amazon, asin).not.toContain(asin);
    for (const asin of ["B0F2K9B696", "B0F53HMTX5", "B0FR98X1DZ", "B0D31TCLN2", "B0FKN7JH1D"]) expect(amazon, asin).toContain(asin);
  });
});

describe("For Kids holds every one of her kids' Amazon saves (owner 11-21)", () => {
  it("54 of the 58 Amazon rows in Kids-saved-amazon-1121.md are on the page (Segway S2 is at Tractor Supply; 11-22 the Switch with Joy-Con, the C2 Lite and C2 Pro, the Amazon S2 and the mini CreateOn tiles went as duplicates, and Paint by Sticker came off; the Quest 3S, iPad and JLab kids headphones were added)", () => {
    const amazon = chunk("kids").filter((p) => p.store === "store-amazon");
    expect(amazon.length).toBe(81); // 82 until the Colgate Minecraft toothbrush moved to Minecraft (owner 11-24 ~10:45 PM). 83 until the Cloud Pink Toniebox starter set moved to Kohl's (Amazon page dead; owner 11-24 ~10:10 PM). 85 until the Bluey figure 4-pack and the Spider-Man fishing kit moved to their themed guides (on Walmart there) 11-24. 86 until the My Mario playset moved to Walmart 11-24 (2026-11-24). 86 = 70 + the 16 Amazon keeps of 11-23 (scripts/giftGuideOwnerKeeps1123.mjs). 70 = 54 after the duplicate removals and Paint by Sticker + the 9 popular adds of 11-22 + the 7 Louisiana books, plush and team gear (owner 11-22 PM)
    // Owner 2026-11-22 8:58 PM ("take it off"): Paint by Sticker Kids: Christmas had no Buy Box and no other listing.
    expect(amazon.some((p) => p.href.includes("152350675X"))).toBe(false);
    for (const asin of ["B0F3GWXLTS", "B0D6RMZ3D1", "B0DDLZV8YM"]) expect(amazon.some((p) => p.href.includes(asin)), asin).toBe(true);
    expect(amazon.some((p) => p.href.includes("B0CT2WN59R"))).toBe(false);
  });
});

describe("the generator sets Him and Kids last", () => {
  it("applyHimKids1121 replaces both pages and names any store a switched pick goes to", () => {
    const pages: Record<string, unknown[]> = { him: [{ name: "old" }], kids: [], her: [{ name: "keep" }] };
    const stores: Record<string, { name: string; hosts: string[] }> = { "store-dillards": { name: "Dillard's", hosts: ["www.dillards.com"] } };
    const out = applyHimKids1121(pages, stores);
    expect(out.him).toEqual({ before: 1, after: HIM_1121.length + HIM_ADDS_1122.length + HIM_POPULAR_1122.length + HIM_KEEPS_1123.length + HIM_LINKS_1123.length + HIM_WALMART_1123.length + HIM_ADDS_1124.length });
    expect(pages.kids.length).toBe(KIDS_1121.length + KIDS_ADDS_1122.length + KIDS_POPULAR_1122.length + KIDS_KEEPS_1123.length + KIDS_LINKS_1123.length + KIDS_ADDS_1124.length - MOVED_TO_THEME.size);
    expect(pages.her).toEqual([{ name: "keep" }]);
    expect(stores["store-dillards"]).toEqual({ name: "Dillard's", hosts: ["go.shopmy.us", "www.dillards.com"] });
    expect(stores["store-exclusive-beauty-club"]).toEqual({ name: "Exclusive Beauty Club", hosts: ["go.shopmy.us"] });
  });

  it("runs after the final sweep and before the pages are written", () => {
    const src = readFileSync("scripts/gift-guide-picks.mjs", "utf8");
    const sweep = src.indexOf("console.log(`gift-guide-picks: final sweep");
    const apply = src.lastIndexOf("applyHimKids1121(pageList, storeList)");
    const write = src.indexOf("writeFileSync(new URL(`${slug}.json`, chunkDir)");
    expect(sweep).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(sweep);
    expect(write).toBeGreaterThan(apply);
  });

  it("men's picks keep relationship tags so /dad and /husband still build", () => {
    const him = chunk("him");
    for (const rel of ["dad", "husband", "boyfriend", "brother"]) expect(him.filter((p) => p.rels?.includes(rel)).length).toBeGreaterThan(10);
  });
});

/**
 * A code rides WITH its item (owner 2026-11-21 ~10 PM, via lead: "you can put the code with the item but no we dont need
 * a long list of codes on each guide only if we have a code should you put it with the items"): the XTRATUF Ankle Deck
 * Boots at xtratuf.com (the Chocolate/Tan Ankle Deck Boot, and since the 11-21 night rate switches the Mossy Oak Bottomland,
 * Wheelhouse and Fleece Lined boots) carry XT25 with its last day (the card hides the chip after Nov 29); no other Him
 * pick carries a code, and on Kids only the two Camp Snap 2 rows (11-22) carry her Camp Snap code LEXILOMBAS7.
 * @mutate scripts/giftGuideHimKids1121.mjs | sortPrice: 115, price: 115, commission: 15, type: "boots", code: "XT25", codeEnds: "2026-11-29" } | sortPrice: 115, price: 115, commission: 15, type: "boots" }
 */
describe("the XTRATUF code chip on For Him (owner 11-21)", () => {
  it("every xtratuf.com boot carries XT25, ending Nov 29, on the page and in the module, and nothing else does but the Muck Arctic Pro's TAKE25", () => {
    type Coded = Pick & { code?: string; codeEnds?: string };
    for (const list of [chunk("him") as Coded[], him1121Picks() as Coded[]]) {
      const coded = list.filter((p) => p.code);
      expect(coded.map((p) => [p.name, p.store, p.code, p.codeEnds, p.price]).sort()).toEqual([
        ["XTRATUF Ankle Deck Boot", "store-xtratuf", "XT25", "2026-11-29", 115],
        ["XTRATUF Mossy Oak Bottomland Ankle Deck Boot", "store-xtratuf", "XT25", "2026-11-29", 125],
        // 11-24: the Arctic Pro moved to muckbootcompany.com (scripts/giftGuideOwner1124.mjs), where Muck Boot's TAKE25 works.
        ["Muck Arctic Pro Boot", "store-muck-boot", "TAKE25", "2026-11-28", 195],
      ].sort());
      expect(list.filter((p) => p.store === "store-xtratuf").length).toBe(coded.filter((p) => p.store === "store-xtratuf").length);
      for (const p of coded.filter((x) => x.store === "store-xtratuf")) {
        expect(new URL(p.href).hostname).toBe("www.anrdoezrs.net");
        expect(decodeURIComponent(p.href)).toMatch(/^https:\/\/www\.anrdoezrs\.net\/click-101930553-15735628\?url=https:\/\/xtratuf\.com\/products\/(22734|xmabmob)$/);
      }
    }
    // Kids: the two Camp Snap 2 colors (11-22, campsnapphoto.com), with her Camp Snap code (no end date), and since the
    // owner's Louisiana adds (11-22 PM) the Big Kids Ankle Deck Boot at xtratuf.com ($44.99, cheaper so first) with XT25.
    expect((chunk("kids") as Coded[]).filter((p) => p.code).map((p) => [p.store, p.code, p.codeEnds])).toEqual([["store-xtratuf", "XT25", "2026-11-29"], ["store-camp-snap", "LEXILOMBAS7", undefined], ["store-camp-snap", "LEXILOMBAS7", undefined]]);
  });
});
