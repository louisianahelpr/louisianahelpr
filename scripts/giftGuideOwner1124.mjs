/**
 * OWNER 11-24 (Tue Nov 24, 2026, ~1:10-2:15 AM CT): higher-commission switches and her Macy's adds, For Her / For Him /
 * For Kids. Guard: src/test/giftGuideOwner1124.test.ts.
 *
 * SWITCHES. She approved all 16 rows (2026-11-24) of the Desktop review page "Louisiana Helpr Tracker/reviews/later-switches-1124.html"
 * and set two standing rules: "[if we have a] higher commission no need to ask", and compare the SAME item across stores
 * on every factor (in stock, the shopper's price, our rate, our $ per sale = price x rate; a store that is clearly pricier
 * loses unless it pays about 2x per sale with a gap under ~15%). Each row below moves one pick to the best-paying link for
 * the same item, with the rate the network showed when the link was made (her ShopMy and Later accounts, 11-24 1:12-1:35
 * AM) and the price read on the store's own page then. Keyed by the pick's OLD link; the builders pass their rows
 * through rateSwitch1124, so the old row stays readable beside its history and this is the one place that says what
 * moved. A switched pick takes the new link, store, commission, price and check day; an ex-Amazon pick also takes the
 * store's own photo (Amazon's photo is allowed only on an Amazon link), cut out (CUTOUTS_1124). Line, type and
 * relationship tags stay; the name changes only where the store sells a newer version under its own name.
 * Measured and NOT switched (the comparison is in the Desktop tracker, commissions.js, what-changed 11-24):
 *   - Step2 Rain Showers water table, Tamagotchi Paradise (Kids) and BISSELL Little Green Mini (Her), all ShopMy Target 4%:
 *     Later's Target rate is by category (Toys 2.8%, Home & Outdoor 4.9%, Health & Beauty 3.5%, base 1.4%; its "up to
 *     7%" is Target's HeyDay brand only), so the toys earn less there, and the vacuum's category is not shown;
 *     bissell.com on ShopMy pays 4% too.
 *   - Anker Nano Power Bank (Her, Him; Amazon 4%): anker.com sells it only in a bundle with a charger.
 *   - Sol de Janeiro Cheirosa Sol & Go mist set (Her; Amazon 10%): not on soldejaneiro.com or Ulta.
 */

/** The Louisiana day these prices were read on the stores' own pages. */
export const OWNER_1124_PRICE_AT = "2026-11-24";

const shopmy = (pin) => `https://go.shopmy.us/${pin}`;
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;

/**
 * old link -> the new link and what changes with it. `was` and `now` are for people (network, rate and price before and
 * after); the builders read only href, store, commission, price, image, name and a code (with its last day).
 * @type {Record<string, { href: string, store: string, commission: number, price: number, image?: string, name?: string, code?: string, codeEnds?: string, was: string, now: string }>}
 */
export const RATE_SWITCHES_1124 = {
  // For Her.
  [amz("B0GGTPW6Q9")]: {
    href: shopmy("p-110118023"), store: "store-ulta-beauty", commission: 13, price: 119.99, image: "https://media.ulta.com/i/ulta/2656433",
    was: "Amazon 3% ($119.99, Carbon)", now: "Ulta via ShopMy 13% ($119.99, Purple; Ulta sells Pink and Purple, no Carbon; Later sharkninja.com Carbon 8.4%)",
  },
  [shopmy("p-107555566")]: {
    href: shopmy("p-110117910"), store: "store-ulta-beauty", commission: 13, price: 149.99,
    was: "sharkninja.com via ShopMy 8% ($149.99, Pink Sparkle)", now: "Ulta via ShopMy 13% ($149.99, Pink; Later sharkninja.com 8.4%)",
  },
  [amz("B0D858S2H5")]: {
    href: shopmy("p-110117645"), store: "store-stanley", commission: 18, price: 22.5, image: "https://cdn.shopify.com/s/files/1/0375/3269/6635/files/Web_PNG_Square-The_Adventure_To-Go_Food_Jar_18OZ_-_Frost_-_Front.png",
    was: "Amazon 4.5% ($22.50)", now: "stanley1913.com via ShopMy 18% ($22.50, Frost 18 oz, in stock; Later 14%)",
  },
  [amz("B0CMJZVT5P")]: {
    href: shopmy("p-110118320"), store: "store-ulta-beauty", commission: 13, price: 9, image: "https://media.ulta.com/i/ulta/2615650",
    was: "Amazon 3% ($9, Honey Talks)", now: "Ulta via ShopMy 13% ($9, Honey Talks; Later elfcosmetics.com 10.5%)",
  },
  [amz("B0CB23NZGT")]: {
    href: "https://mavely.app.link/TptnXLe0j8b", store: "store-elf", commission: 10.5, price: 6, image: "https://cdn.shopify.com/s/files/1/0661/2251/4520/files/83475_OpenA_0553_R.png",
    was: "Amazon 3% ($4.78)", now: "elfcosmetics.com via Later 10.5% ($6, Brown Sugar; not at Ulta). $1.22 more for the shopper, inside the ~$5 band for cheap items; $0.63 a sale vs $0.14",
  },
  [amz("B01EXQ582Q")]: {
    href: shopmy("p-110117734"), store: "store-sol-de-janeiro", commission: 16, price: 18, image: "https://cdn.shopify.com/s/files/1/2826/2250/files/01_SDJ_PPage_DTC_BB_BC_75ML_OVERHEAD_RGB_1452X1452_7c2cc7d8-2ea3-4724-b7b5-f0120fb14919.jpg",
    was: "Amazon 10% ($18)", now: "soldejaneiro.com via ShopMy 16% ($18, 75 ml; Later 10.5%)",
  },
  // For Him.
  [amz("B0FY9LPSCW")]: {
    href: "https://mavely.app.link/rBTVe27Zj8b", store: "store-columbia", commission: 8.4, price: 22.5, image: "https://media.columbia.com/i/columbia/2070981_126_f_tt",
    was: "Amazon 4% ($30, Ancient Fossil/Road Runner)", now: "columbia.com via Later 8.4% ($22.50, Sea Salt/Buffalo; columbia.com does not sell the Road Runner color; ShopMy 8%)",
  },
  [amz("B0076R6MN4")]: {
    href: "https://mavely.app.link/LP97ij8Zj8b", store: "store-columbia", commission: 8.4, price: 39, image: "https://media.columbia.com/i/columbia/1476671_011_f_om",
    name: "Columbia Men's Steens Mountain 2.0 Full Zip Fleece Jacket",
    was: "Amazon 4% (shown $34.50 from 11-21; $37.05 on amazon.com 11-24, Black/Grill)", now: "columbia.com via Later 8.4% ($39, the 2.0 version, Black/Grill; 5% above Amazon's $37.05, $3.28 a sale vs $1.48)",
  },
  [shopmy("p-107881822")]: {
    // Muck Boot's TAKE25 (25% off everything through Nov 28, src/content/giftGuideCodes.json) rides on the card, as it did at
    // The Warming Store's code before.
    href: shopmy("p-110119003"), store: "store-muck-boot", commission: 16, price: 195, code: "TAKE25", codeEnds: "2026-11-28", image: "https://cdn.shopify.com/s/files/1/0918/9123/7146/files/muck_men_arcticpro_acpoct_profile_32393.jpg",
    was: "The Warming Store via ShopMy 8% ($195)", now: "muckbootcompany.com via ShopMy 16% ($195, Mossy Oak Country DNA, 5 of 11 sizes in stock)",
  },
};

/** A builder row after its 11-24 switch (unchanged when its link is not switched). */
export const rateSwitch1124 = (r) => {
  const s = RATE_SWITCHES_1124[r.href];
  if (!s) return r;
  const { was: _was, now: _now, price, ...rest } = s;
  return { ...r, ...rest, sortPrice: price, price, priceAt: OWNER_1124_PRICE_AT };
};

/**
 * HER MACY'S ADDS (owner ~2:05 and ~2:15 AM, screenshots from macys.com: "I want to add this monster truck air table. Robe,
 * shark and Clinique." / "These also."). Each is the exact Macy's product page, read 11-24 ~1:30 AM CT (Black Friday
 * prices; in stock), linked through her ShopMy at Macy's 16% (Later pays 14% there). Rows: [ShopMy pin, price, Macy's
 * photo, name, brand, store, type, commission %, line]. Store check: the robe is a Macy's exclusive; the Shark HV301 is
 * $99.99 here at 16% (Later sharkninja.com pays 8.4%); the Clinique trio is Macy's $21 at 16% (Ulta pays 13%).
 * The UGG set's $49.99 was a Macy's "TODAY ONLY" price (its timer showed 28 minutes left at ~1:31 AM CT); the daily
 * price check re-reads it.
 */
export const HER_MACYS_1124_ROWS = [
  ["110119763", 29.99, "https://slimages.macysassets.com/is/image/MCY/products/5/optimized/28618605_fpx.tif", "Hotel Collection Luxe Knit Robe, Ivory", "Hotel Collection", "store-macys", "robe", 16, "A plush knit robe from Macy's own hotel line."],
  ["110119787", 99.99, "https://slimages.macysassets.com/is/image/MCY/products/2/optimized/1783532_fpx.tif", "Shark Rocket Pet Corded Stick Vacuum, HV301", "Shark", "store-macys", "vacuum", 16, "A light stick vacuum that picks up pet hair fast."],
  // Macy's lists the set as a Pop Lip + Cheek Oil, an Almost Lipstick and a Quickliner for lips, all in Black Honey.
  ["110119843", 21, "https://slimages.macysassets.com/is/image/MCY/products/6/optimized/39005036_fpx.tif", "Clinique 3-Piece Black Honey Trio Gift Set", "Clinique", "store-macys", "makeup", 16, "Clinique's cult Black Honey shade in a lip trio."],
  ["110119860", 49.99, "https://slimages.macysassets.com/is/image/MCY/products/4/optimized/33262664_fpx.tif", "UGG Raegan 3-Piece Gift Set, Chestnut", "UGG", "store-macys", "gift-set", 16, "A cozy UGG throw, eye mask and case for travel."],
];

/** KIDS MACY'S ADDS (same screenshots and checks). Ages and girls/boys/everyone are in src/content/giftGuideKidsTags.json. */
export const KIDS_MACYS_1124_ROWS = [
  ["110119731", 24.99, "https://slimages.macysassets.com/is/image/MCY/products/1/optimized/39965411_fpx.tif", "Monster Jam Air Hockey Tabletop Game", "Forever Clever", "store-macys", "game", 16, "A tabletop air hockey game with Monster Jam trucks."],
  ["110119881", 32.49, "https://slimages.macysassets.com/is/image/MCY/products/5/optimized/36521135_fpx.tif", "Sharper Image 1:14 Scale Polaris General Off-Road RC Vehicle", "Sharper Image", "store-macys", "vehicle-toy", 16, "A camo remote-control side-by-side built for the yard."],
  ["110119923", 11.99, "https://slimages.macysassets.com/is/image/MCY/products/7/optimized/29531977_fpx.tif", "Discovery Kids Glow Lighted Tracing Tablet", "Discovery Kids", "store-macys", "art", 16, "A light-up tracing pad for drawing and coloring."],
  ["110119952", 24.99, "https://slimages.macysassets.com/is/image/MCY/products/9/optimized/33901459_fpx.tif", "Play-Doh Sizzlin' Grill Playset", "Play-Doh", "store-macys", "pretend-play", 16, "A Play-Doh grill on a stand for pretend cookouts."],
  ["110119982", 43.99, "https://slimages.macysassets.com/is/image/MCY/products/0/optimized/34225830_fpx.tif", "Melissa & Doug Sort, Stock, Select Beauty Kiosk Play Set", "Melissa & Doug", "store-macys", "pretend-play", 16, "A wooden beauty shop kiosk with pretend makeup to sort."],
  ["110120034", 22.49, "https://slimages.macysassets.com/is/image/MCY/products/0/optimized/38191070_fpx.tif", "VTech Learn & Zoom 2-in-1 Three-Wheel Motorbike", "VTech", "store-macys", "ride-on", 16, "A toddler ride-on motorbike with lights and songs."],
  // Macy's sells each doll by hair color on one page; the photo shows the four.
  ["110120060", 31.99, "https://slimages.macysassets.com/is/image/MCY/products/8/optimized/40071418_fpx.tif", "Barbie Holiday 2026 Doll", "Barbie", "store-macys", "doll", 16, "The 2026 holiday Barbie in a red gown, in four hair colors."],
];

const macys = ([pin, price, image, name, brand, store, type, commission, line]) =>
  ({ name, brand, line, href: shopmy(`p-${pin}`), image, store, sortPrice: price, price, priceAt: OWNER_1124_PRICE_AT, commission, type });
export const HER_ADDS_1124 = HER_MACYS_1124_ROWS.map(macys);
export const KIDS_ADDS_1124 = KIDS_MACYS_1124_ROWS.map(macys);

/** Store photos for the switches and adds, cut out (Apple Vision) into public/gift-guides/cutouts: photo URL -> file. */
export const CUTOUTS_1124 = [
  ["https://media.ulta.com/i/ulta/2656433", "shark-chillpill-purple-ulta-bd9778.webp"],
  ["https://media.ulta.com/i/ulta/2615650", "elf-glow-reviver-lip-oil-honey-talks-ulta-913bce.webp"],
  ["https://cdn.shopify.com/s/files/1/0375/3269/6635/files/Web_PNG_Square-The_Adventure_To-Go_Food_Jar_18OZ_-_Frost_-_Front.png", "stanley-adventure-to-go-food-jar-18oz-frost-9746c2.webp"],
  ["https://cdn.shopify.com/s/files/1/0661/2251/4520/files/83475_OpenA_0553_R.png", "elf-lip-exfoliator-brown-sugar-ff2811.webp"],
  ["https://cdn.shopify.com/s/files/1/2826/2250/files/01_SDJ_PPage_DTC_BB_BC_75ML_OVERHEAD_RGB_1452X1452_7c2cc7d8-2ea3-4724-b7b5-f0120fb14919.jpg", "sol-de-janeiro-bum-bum-cream-75ml-0e40c3.webp"],
  ["https://media.columbia.com/i/columbia/2070981_126_f_tt", "columbia-ratchet-strap-snapback-sea-salt-cb7f25.webp"],
  ["https://media.columbia.com/i/columbia/1476671_011_f_om", "columbia-steens-mountain-2-fleece-black-grill-0e8492.webp"],
  ["https://cdn.shopify.com/s/files/1/0918/9123/7146/files/muck_men_arcticpro_acpoct_profile_32393.jpg", "muck-arctic-pro-mossy-oak-country-dna-5d1b21.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/5/optimized/28618605_fpx.tif", "hotel-collection-luxe-knit-robe-ivory-macys-b247a6.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/2/optimized/1783532_fpx.tif", "shark-rocket-pet-hv301-macys-9abf2d.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/6/optimized/39005036_fpx.tif", "clinique-black-honey-trio-macys-2ec547.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/4/optimized/33262664_fpx.tif", "ugg-raegan-gift-set-chestnut-macys-14b9f3.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/1/optimized/39965411_fpx.tif", "monster-jam-air-hockey-macys-e5054b.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/5/optimized/36521135_fpx.tif", "sharper-image-polaris-general-rc-macys-a58217.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/7/optimized/29531977_fpx.tif", "discovery-kids-glow-tracing-tablet-macys-ed2fda.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/9/optimized/33901459_fpx.tif", "play-doh-sizzlin-grill-macys-506b95.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/0/optimized/34225830_fpx.tif", "melissa-doug-beauty-kiosk-macys-805953.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/0/optimized/38191070_fpx.tif", "vtech-learn-zoom-motorbike-macys-294df8.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/8/optimized/40071418_fpx.tif", "barbie-holiday-2026-macys-b7519b.webp"],
];

/** Stores the 11-24 rows go to that the store list may not hold yet (key -> shown name). */
export const STORES_1124 = { "store-elf": "e.l.f. Cosmetics", "store-muck-boot": "Muck Boot" };
