/**
 * FOR HER = THE OWNER'S SAVES (owner 2026-11-21 ~1:10 AM: "i saved alot of things for women in my amazon and in shop
 * my"; ~2:15 AM: "we can have more than 25 items its fine"). For Her holds EXACTLY these 36 picks and nothing else: 11
 * from her Amazon shopping list, 11 more from her Amazon cart and 14 from her ShopMy links (Desktop notes
 * Her-saved-amazon-1121.md, Her-saved-amazon-cart-1121.md and Her-saved-shopmy-1121.md). She picked every one herself,
 * so none is added, dropped or swapped by any rule.
 *
 * scripts/gift-guide-picks.mjs runs applyHer1121 LAST, after the final sweep, so no earlier pass (blocklist, price cap,
 * brand cap, type cap, beauty cap, sponsor rule, men's style, standard plan) can drop or reorder these. That is the
 * owner-kept allowance, and it is narrow on purpose: it touches only the "her" page and only these rows. She kept,
 * by name (11-21): all 9 items over $100, all three face tools (ZDEER gua sha, Shark Depuffi, CurrentBody mask) and the
 * sold-out Stanley cooler (she is looking for it on Amazon). The HEYDUDE Austin Lift is banned from men's guides only.
 *
 * Page rules (owner): ONE flat list, cheapest first (no sections, no relationship chips, no codes or deals box; see
 * OWNER_LIST_GUIDES in src/content/giftGuidePeople.mjs). An Amazon pick never carries a price (Associates rule), and
 * its photo is Amazon's own, never edited; `sortPrice` is the price she saw, used only to order the list and never
 * written to the page. A ShopMy pick shows its price checked 11-21 (the page rounds it, "~$30") and its photo as a
 * transparent cutout (scripts/giftGuideCutouts1120.mjs). Each pick keeps its relationship tags (`rels`), so /mom,
 * /wife ... still build from this list.
 * Guard: src/test/giftGuideHer1121.test.ts.
 */
import { PEOPLE_GUIDES } from "../src/content/giftGuidePeople.mjs";
import { relsOf } from "./giftGuidePeople1120.mjs";
import { cutoutPhoto } from "./giftGuideCutouts1120.mjs";
import { rankByPrice } from "./giftGuidePriceRank1121.mjs";

export const HER_GUIDE = "her";
/** The day the ShopMy prices were checked (Louisiana day). */
export const HER_PRICE_AT = "2026-11-21";
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;
const shopmy = (pin) => `https://go.shopmy.us/${pin}`;

/** Stores a ShopMy pin goes to that the store list may not hold yet (key -> shown name). */
export const HER_STORES = {
  "store-jd-sports": "JD Sports", "store-sephora": "Sephora", "store-hatch": "Hatch", "store-macys": "Macy's",
  "store-haven-well-within": "Haven Well Within", "store-camp-snap": "Camp Snap", "store-rei": "REI",
  "store-the-swank-company": "The Swank Company", "store-baublebar": "BaubleBar", "store-currentbody": "CurrentBody",
  "store-anthropologie": "Anthropologie", "store-tatcha": "Tatcha",
};

/**
 * Her saves, cheapest first (sortPrice). One row per pick, so a link swap is a one-line change. `price` only on a ShopMy
 * pick; never on an Amazon one.
 */
export const HER_1121 = [
  { name: "YUDSUD High Waisted Leggings", brand: "YUDSUD", line: "Soft high-waisted leggings she will live in all winter.", href: amz("B0D3L9BYFZ"), image: amzImg("31wNp8LsF5L"), store: "store-amazon", sortPrice: 6.64, commission: 4, type: "pants" },
  { name: "Yoosteel Birthstone Bracelet", brand: "Yoosteel", line: "A dainty gold-plated bracelet with her birthstone.", href: amz("B0FDKC619F"), image: amzImg("51PDHgtzHAL"), store: "store-amazon", sortPrice: 7.99, commission: 4, type: "jewelry" },
  { name: "eos Vanilla Cashmere Holiday Gift Set", brand: "eos", line: "A vanilla cashmere lotion and lip balm set, ready to gift.", href: amz("B0CWRFQCWF"), image: amzImg("71XNXXEbQEL"), store: "store-amazon", sortPrice: 10, commission: 3, type: "gift-set" },
  { name: "Personalized Embroidered Canvas Tote Bag", brand: "", line: "A canvas tote embroidered just for her.", href: amz("B0FKN7FGPY"), image: amzImg("41-9rV6lp9L"), store: "store-amazon", sortPrice: 11.99, commission: 4, type: "bag" },
  { name: "Loritta Long Plaid Winter Scarf", brand: "Loritta", line: "A long plaid scarf that doubles as a cozy wrap.", href: amz("B0C246HFWN"), image: amzImg("51J4ztPBNYL"), store: "store-amazon", sortPrice: 13.99, commission: 4, type: "scarf" },
  { name: "Kitsch Satin Pillowcase With Zipper", brand: "Kitsch", line: "A satin pillowcase that is kind to hair and skin.", href: amz("B0CCWSGSCT"), image: amzImg("81zPpWuuXHL"), store: "store-amazon", sortPrice: 15.19, commission: 3, type: "bedding" },
  { name: "Personalized Floral Mama Quarter Zip Sweatshirt", brand: "", line: "A cozy quarter zip with Mama stitched in florals.", href: amz("B0HJVYHH35"), image: amzImg("41LM2AYUzKL"), store: "store-amazon", sortPrice: 18.15, commission: 4, type: "sweatshirt" },
  // OWNER SWAP PENDING (11-21): this pin goes to Sephora UK; replace the href with her Sephora US pin (and keep store-sephora).
  { name: "BIODANCE Hydro Cera-Nol Real Deep Mask, 4 Pack", brand: "BIODANCE", line: "Overnight hydrogel masks she peels off to glowy skin.", href: shopmy("p-108613754"), image: "https://static.shopmy.us/uploads/c5e32645-7fc2-4c8a-af7f-d12b9c83bc61imageye___-_imgi_1_4201001452-847__1.jpeg", store: "store-sephora", sortPrice: 19, price: 19, commission: 16, type: "skincare" },
  { name: "Summer Fridays Tinted Lip Butter Balm", brand: "Summer Fridays", line: "The tinted lip balm everyone keeps in their bag.", href: amz("B0D82LVR3N"), image: amzImg("51s-g+euH5L"), store: "store-amazon", sortPrice: 19.2, commission: 10, type: "lip" },
  { name: "Kitsch XL Microfiber Hair Towel Wrap", brand: "Kitsch", line: "A quick-dry hair towel wrap for after the shower.", href: amz("B0CDF7GJ4Y"), image: amzImg("81h7Kvf9ttL"), store: "store-amazon", sortPrice: 19.24, commission: 3, type: "hair" },
  { name: "Amazon Essentials Women's Flannel Pajamas", brand: "Amazon Essentials", line: "Soft flannel pajamas for cold mornings.", href: amz("B08X8P91FX"), image: amzImg("71vZPpqtf5L"), store: "store-amazon", sortPrice: 20.69, commission: 4, type: "pajamas" },
  { name: "TULA Spresso Energizing Eye Balm", brand: "TULA", line: "A cooling eye balm that wakes up tired eyes.", href: amz("B0C7LTPXBV"), image: amzImg("71N7JF4XK1L"), store: "store-amazon", sortPrice: 22.8, commission: 10, type: "skincare" },
  { name: "nodpod Weighted Sleep Mask", brand: "nodpod", line: "A gently weighted eye mask that helps her drift off.", href: amz("B0B1RWJ4QJ"), image: amzImg("31+H+LGa0OL"), store: "store-amazon", sortPrice: 28.5, commission: null, type: "sleep-mask" },
  { name: "Tyler Candle Company Diva Glamorous Gift Suite", brand: "Tyler Candle Company", line: "The Diva scent in a candle gift set.", href: amz("B0D7TR9PBZ"), image: amzImg("718bvTOBovL"), store: "store-amazon", sortPrice: 28.68, commission: 3, type: "candle" },
  // COMMISSION SWITCH 11-21 (owner: "if the items on the guides can we fund at another place for higher commison just
  // change the link"): was Amazon B08D3FXF64 at 10%; same jar, same $29 at Tatcha (direct) at 20%.
  { name: "TATCHA Kissu Lip Mask", brand: "TATCHA", line: "An overnight lip mask for soft lips.", href: shopmy("p-108732256"), image: "https://cdn.shopify.com/s/files/1/0949/3328/7221/files/TheKissuLipMask-pdp-Aug26-Omi-FullSize-MainImage-1200x1200.jpg", store: "store-tatcha", sortPrice: 29, price: 29, commission: 20, type: "lip" },
  { name: "Owala FreeSip 24 oz Bottle, Open Air", brand: "Owala", line: "The leak-proof bottle she can sip or swig from.", href: shopmy("p-108613192"), image: "https://static.shopmy.us/pins/zoom-108613192-1795240422444-C07940_450", store: "store-jd-sports", sortPrice: 29.99, price: 29.99, commission: 15, type: "drinkware" },
  { name: "Bedsure Bubble Faux Fur Christmas Throw Blanket", brand: "Bedsure", line: "A fluffy faux fur throw for the couch.", href: amz("B0F5N7S36V"), image: amzImg("91HJeXmiufL"), store: "store-amazon", sortPrice: 32.48, commission: 3, type: "throw-blanket" },
  { name: "JEIBKOUY Oversized Camo Hoodie, Maple Leaf", brand: "JEIBKOUY", line: "An oversized camo hoodie with a maple leaf print.", href: amz("B0FFMJMB6K"), image: amzImg("41tsU8jZI3L"), store: "store-amazon", sortPrice: 32.99, commission: 4, type: "sweatshirt" },
  { name: "Anoumcy Leopard Barrel Joggers", brand: "Anoumcy", line: "Leopard barrel-leg joggers that feel like sweats.", href: amz("B0FVFV7V1R"), image: amzImg("51F+lcxZoPL"), store: "store-amazon", sortPrice: 33.14, commission: 4, type: "pants" },
  { name: "Sol de Janeiro Cheirosa Sol & Go Mini Perfume Mist", brand: "Sol de Janeiro", line: "A mini perfume mist in a best-loved scent.", href: amz("B0H42QZ8BW"), image: amzImg("71uJ6m6sS1L"), store: "store-amazon", sortPrice: 36, commission: 10, type: "fragrance" },
  { name: "ZDEER GS5 Heated Gua Sha Tool", brand: "ZDEER", line: "A heated gua sha with red light for a spa night in.", href: amz("B0FPCH9S11"), image: amzImg("31iCM-w+Z6L"), store: "store-amazon", sortPrice: 39.99, commission: 3, type: "beauty-device" },
  { name: "Camp Snap CS-8 Micro Video Camera Keychain, Blind Box", brand: "Camp Snap", line: "A tiny video camera on a keychain, color a surprise.", href: shopmy("p-108611500"), image: "https://static.shopmy.us/pins/zoom-106643598-1794927315931-micro1.jpg", store: "store-camp-snap", sortPrice: 39.99, price: 39.99, commission: 10, type: "accessory" },
  // COMMISSION SWITCH 11-21: was Amazon B0HFYLTJR7 at 10%; same boxed set, same $40 at Anthropologie at 15%.
  { name: "L'OCCITANE Shea Butter Classics Gift Set", brand: "L'OCCITANE", line: "Shea butter hand and body care, ready to give.", href: shopmy("p-108732809"), image: "https://images.urbndata.com/is/image/Anthropologie/114587041_030_b2", store: "store-anthropologie", sortPrice: 40, price: 40, commission: 15, type: "gift-set" },
  { name: "HEYDUDE Austin Lift Platform Mule", brand: "HEYDUDE", line: "Easy slip-on platform mules for everyday errands.", href: amz("B0CPB1MWMP"), image: amzImg("315u2EGcJpL"), store: "store-amazon", sortPrice: 44.99, commission: null, type: "shoes" },
  { name: "Trendy Queen Mock Neck 2 Piece Sweat Set", brand: "Trendy Queen", line: "A matching mock neck sweat set for travel days.", href: amz("B0H2D9Q7CV"), image: amzImg("61-DZ19Gx3L"), store: "store-amazon", sortPrice: 48.99, commission: 4, type: "matching-set" },
  { name: "BaubleBar Fallon 14K Gold Bezel Earrings", brand: "BaubleBar", line: "Gold bezel drop earrings that go with everything.", href: shopmy("p-108607824"), image: "https://static.shopmy.us/uploads/adc16a77-2764-49c6-8995-55c0e42754c9_s-blob-v1-IMAGE-DBeu-uRDNQQ.png", store: "store-baublebar", sortPrice: 64, price: 64, commission: 20, type: "jewelry" },
  { name: "Ember Mug 2, Brown", brand: "Ember", line: "A heated mug that keeps her coffee hot to the last sip.", href: shopmy("p-108613356"), image: "https://static.shopmy.us/pins/zoom-108613356-1795240468332-17103719_fpx.tif", store: "store-macys", sortPrice: 89.99, price: 89.99, commission: 16, type: "mug" },
  { name: "Lola Blankets Original Throw Blanket", brand: "Lola Blankets", line: "The famously soft Lola throw for couch nights.", href: shopmy("p-108604054"), image: "https://static.shopmy.us/uploads/346f926f-f41b-444e-b686-921455d30264_74A53B12-D898-44DD-8ADB-BBB0CD895907.jpg", store: "store-anthropologie", sortPrice: 135, price: 135, commission: 15, type: "throw-blanket" },
  // Sold out at Stanley (11-21); stays in while the owner looks for it on Amazon.
  { name: "Stanley All Day Julienne Midi Cooler", brand: "Stanley", line: "A soft cooler bag for tailgates and beach days.", href: shopmy("p-108610992"), image: "https://www.rei.com/media/40f2076a-b808-4b12-b912-240e6fa0e847", store: "store-rei", sortPrice: 140, price: 140, commission: 8, type: "cooler" },
  // Switched 11-21 from her Sephora UK pin (US shoppers cannot use it) to her existing SharkNinja US pin. Her Ulta pin (13%) would pay more.
  { name: "Shark Depuffi Hot & Cold Face Sculpting Tool", brand: "Shark", line: "A hot and cold face tool that depuffs in minutes.", href: shopmy("p-107555566"), image: "https://asset.sephora.co.uk/img/prod/pid/P1000211062/114692_media_principal_extendedaten_gb_0_extended_06-05-26-09-52-04.jpg", store: "store-sharkninja", sortPrice: 149.99, price: 149.99, commission: 8, type: "beauty-device" },
  { name: "On Cloud 6 Sneakers, Glacier/White", brand: "On", line: "Light, cushioned sneakers for walks and long days.", href: shopmy("p-108613972"), image: "https://static.shopmy.us/pins/zoom-108613972-1795240704146-3MF10070_050", store: "store-jd-sports", sortPrice: 160, price: 160, commission: 15, type: "shoes" },
  // OWNER SWAP PENDING (11-21): The Swank Company is out of Cape Taupe; replace the href with her YETI pin (and the store with store-yeti).
  { name: "YETI Camino 35 Carryall Tote, Cape Taupe", brand: "YETI", line: "A tough carryall tote for the beach, boat or groceries.", href: shopmy("p-108609900"), image: "https://static.shopmy.us/uploads/pretty-prod-1787425474692", store: "store-the-swank-company", sortPrice: 160, price: 160, commission: 15, type: "bag" },
  { name: "Hatch Restore 3, Putty", brand: "Hatch", line: "A sunrise alarm and sound machine for calmer mornings.", href: shopmy("p-108613500"), image: "https://static.shopmy.us/pins/zoom-108613500-1795240519319-R3_Putty.jpg", store: "store-hatch", sortPrice: 169.99, price: 169.99, commission: 15, type: "clock" },
  { name: "UGG Goldenstar Evelina Clog, Beige", brand: "UGG", line: "Fuzzy-lined UGG clogs she can slip on and go.", href: shopmy("p-108604684"), image: "https://static.shopmy.us/pins/zoom-108604684-1795237968140-108971391_025_b", store: "store-anthropologie", sortPrice: 175, price: 175, commission: 15, type: "shoes" },
  { name: "Therabody Theragun Mini", brand: "Therabody", line: "A pocket massage gun for sore shoulders and legs.", href: shopmy("p-108612982"), image: "https://static.shopmy.us/pins/zoom-108612982-1795240352615-253765107_0435.jpg", store: "store-haven-well-within", sortPrice: 219.99, price: 219.99, commission: 16, type: "massager" },
  { name: "CurrentBody LED Red Light Therapy Face Mask", brand: "CurrentBody", line: "An LED red light mask for skin care at home.", href: shopmy("p-108605514"), image: "https://static.shopmy.us/uploads/pretty-prod-1789545457784", store: "store-currentbody", sortPrice: 469.99, price: 469.99, commission: 10, type: "beauty-device" },
];

const isAmazon = (p) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\//.test(p.href);

/** The page rows: cheapest first, Amazon without a price, cutout photos, relationship tags, no section. */
export function her1121Picks(rows = HER_1121) {
  const g = PEOPLE_GUIDES.find((x) => x.slug === HER_GUIDE);
  return rankByPrice(rows).map(({ row: r, priceRank }) => {
    const { sortPrice: _sp, price, ...rest } = r;
    const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: HER_GUIDE, priceRank };
    if (!isAmazon(r)) Object.assign(p, { price, priceAt: HER_PRICE_AT });
    return { ...p, rels: relsOf(g, p) };
  });
}

/** Replaces the For Her page with the owner's saves (and names any store the list lacks). Returns what it did. */
export function applyHer1121(pageList, storeList) {
  const had = new Set((pageList[HER_GUIDE] ?? []).map((p) => p.href));
  const before = had.size;
  pageList[HER_GUIDE] = her1121Picks();
  // On the second call (after the final sweep), any of hers a later pass took off, put back here.
  const putBack = pageList[HER_GUIDE].filter((p) => !had.has(p.href)).map((p) => p.name);
  const addedStores = [];
  for (const p of pageList[HER_GUIDE]) {
    if (p.store === "store-amazon" || storeList[p.store]) continue;
    storeList[p.store] = { name: HER_STORES[p.store] ?? p.store, hosts: [new URL(p.href).hostname] };
    addedStores.push(p.store);
  }
  for (const p of pageList[HER_GUIDE]) {
    const s = storeList[p.store];
    const host = new URL(p.href).hostname;
    if (s && p.store !== "store-amazon" && !s.hosts.includes(host)) s.hosts = [...s.hosts, host].sort();
  }
  return { before, after: pageList[HER_GUIDE].length, addedStores, putBack };
}
