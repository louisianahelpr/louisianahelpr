/**
 * PRICES THAT CHANGED, 11-26 (guides audit 1126, ~/.lh-shots/guides-audit-1126/her.md, him.md, kids.md). The audit read
 * each of these on the product's own plain page on 2026-11-26 (amazon.com/dp/<ASIN>, smathersandbranson.com product JSON,
 * maisonette.com Shopify product JSON; never one of our affiliate links) and the price had moved since the guide's
 * priceAt (Black Friday week). link -> the price read. The Her, Him and Kids builders (scripts/giftGuideHer1121.mjs
 * her1121Picks, scripts/giftGuideHimKids1121.mjs build) apply it before the cheapest-first rank, so the pick lands in the
 * price section its new price reads ("~$11" leaves Stocking stuffers under $10), and date it PRICES_AT_1126.
 * An Amazon link is matched by ASIN (amazon.com/dp/<ASIN>), any other by the exact link.
 * Guard: src/test/giftGuidePrices1126.test.ts.
 */

export const PRICES_AT_1126 = "2026-11-26";

/** @type {Record<string, number>} ASIN or exact link -> the price read 11-26. */
export const PRICES_1126 = {
  // For Her
  B0HJ9ZJ8KM: 10.99, // Maybelline Mascara Holiday Gift Set (was 6.99)
  B0BGS3L9XS: 38.99, // ReachMe Sherpa Zip Up Hoodie Jacket, Lavender (was 28)
  B0C246HFWN: 8.96, // Loritta Long Plaid Winter Scarf (was 13.99)
  B0F5K3B4Q7: 22.46, // She's Birdie Personal Safety Alarm (was 29.94)
  B0D19JDZJS: 21, // Too Faced Born This Way Natural Nudes Mini Palette (was 30)
  B0H42QZ8BW: 27, // Sol de Janeiro Cheirosa Sol & Go Mini Perfume Mist (was 36)
  B0F41DGFXT: 31.87, // Matador Global Travel Adapter (was 42.49)
  B0FFMJMB6K: 26.39, // JEIBKOUY Oversized Camo Hoodie (was 32.99)
  B0G4M22BQL: 26.39, // Oversized Mockneck Striped Sweatshirt, Pink (was 32.99)
  B0CPB1MWMP: 39.99, // HEYDUDE Austin Lift Platform Mule (was 44.99)
  B0030F32L6: 6.16, // Pilot G2 Gel Pens, 4 Pack (was 7.99)
  B0HKQYLRBB: 19.99, // Personalized Striped Monogram Makeup Pouch (was 22.99)
  // For Him
  B0070XAL0E: 8.5, // Jack Black Intense Therapy Lip Balm SPF 25 (was 10)
  B08L12KVMB: 9.99, // Gun Cleaning Patches and Supplies (was 9.45)
  B06VX42986: 26.95, // Palmetto Wood Shop Engraved Pocket Knife (was 23.47)
  B002ZK45IQ: 5.59, // Gerber Shard 7-in-1 Keychain Tool (was 7.99)
  B003IWI66W: 13.99, // Bear Paws Original Meat Claws (was 9.99)
  B089F9YDFC: 15.99, // Ontel Battery Daddy Organizer (was 19.99)
  B086KY66PH: 17.98, // Hanes Men's Undershirt Pack (was 20.05)
  B0CHVWCSQ8: 45.99, // Klola Large Magnetic Gun Cleaning Mat (was 39.99)
  B0HCVK9JTC: 32.94, // HOOEY Outfitters Mallard Cap (was 37.6)
  B0FQFB8FMG: 149, // Apple AirPods Pro 3 (was 169.99)
  "0935032509": 18.6, // Talk About Good II (was 19.95)
  // Smathers & Branson Mallard Tervis Tumbler: smathersandbranson.com/products/mallard-needlepoint-tervis-tumbler.js, one variant $49.50 (was 54)
  "https://go.shopmy.us/p-108101578": 49.5,
  // For Kids
  B0GHBKG64Q: 49.99, // Primal Hatch Megalodon Hatching Egg (was 35)
  B074YZWKMB: 50.95, // Little King LSU Tigers 2-Piece Cheer Dress (was 48.99)
  B0GT16T874: 11.98, // Taba Squishies Fidget Toys, 3 Pack (was 14.98)
  B08199W8C1: 16.14, // Piggy Bank ATM for Kids (was 17.76)
  // OOLY Hair Doodlers Hair Crayons, Set of 6: maisonette.com/products/hair-doodlers-hair-crayons-set-of-6 product JSON $7.46 (was 9.95)
  "https://go.shopmy.us/p-109730393": 7.46,
};

/** The 11-26 price of a link, or undefined when it did not change. */
export function price1126(href) {
  const m = /amazon\.com\/(?:dp|gp\/product)\/([A-Z0-9]{10})/.exec(String(href));
  return (m ? PRICES_1126[m[1]] : undefined) ?? PRICES_1126[String(href)];
}

/** A builder row with its 11-26 price (sortPrice for the rank, price for a non-Amazon card) and day, or the row as it was. */
export function withPrice1126(r) {
  const p = price1126(r.href);
  return p === undefined ? r : { ...r, sortPrice: p, ...(r.price === undefined ? {} : { price: p }), priceAt: PRICES_AT_1126, price1126: true };
}
