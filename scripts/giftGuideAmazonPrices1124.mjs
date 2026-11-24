/**
 * AMAZON PRICES RE-READ 11-24 (kids Black Friday sweep, owner 11-24 ~5 PM: "Did you check all the Black Friday sales
 * from the top major stores to be sure we have all the deals in each kids guide?"). Every Amazon pick on For Kids was
 * re-read on its own amazon.com/dp page on 2026-11-24 (~3:30 PM CT, headless page read of the buy-box price, the
 * evidence is ~/.lh-shots/kids-bf-sweep-1124/amazon-reads.jsonl). Only the ones whose price CHANGED are listed here
 * (ASIN -> the price read); an unchanged one keeps its old row and day. scripts/giftGuideHimKids1121.mjs `build` shows
 * this price in place of the saved-list `sortPrice` and dates it AMAZON_PRICES_AT_1124.
 * Guard: src/test/giftGuideAmazonPrices1124.test.ts.
 */

export const AMAZON_PRICES_AT_1124 = "2026-11-24";

/** @type {Record<string, number>} */
export const AMAZON_PRICES_1124 = {
  "B0CBT2N7N1": 14.28, // UNO Show 'em No Mercy Card Game in Tin (was 10.49, Amazon list $14.28)
  "B09GXDQ122": 11.63, // Would You Rather Book for Kids (was 11.6)
  "B0G441FJ3G": 18.05, // Polly Pocket Dream Treat Unicorn Compact (was 15.11)
  "B0DB9JTTJQ": 21.21, // CreateOn Crayola Holiday Glitter Magnetic Tiles (was 18.99, Amazon list $24.95)
  "B0GGTL1S8X": 19.99, // MAGNA-TILES microMAGS (was 19.55)
  "B0G497FGT6": 20.99, // GUI GUI Mega Slime Haul (was 21, Amazon list $29.99)
  "B0CSP7M219": 21.84, // Hatchimals Alive Rainbow Hatchery (was 21.78, Amazon list $26.99)
  "B0HGX9TVW6": 22.53, // Skillmatics Aqua Puffs Christmas Ornaments (was 23.72, Amazon list $29.97)
  "B00FFJZ010": 24.99, // Stomp Rocket Ultra LED (was 23.74, Amazon list $34.99)
  "B0FX3KW535": 29.97, // Tickle Me Elmo Giggle Max (was 30, Amazon list $39.99)
  "B0CSJQHF6W": 32.95, // Bitzee Disney Digital Pet (was 34.11, Amazon list $37.99)
  "B0G2T2Q1RH": 39.99, // LEGO Gingerbread House (was 39.92)
  "B081RJ8DW1": 86.99, // Gskyer Telescope (was 80.02, Amazon list $129.99)
  "B0GH39S2GJ": 49.99, // PAW Patrol Dino Movie Megasaurus Vehicle (was 83, Amazon list $64.99)
  "B0G3RKYTMS": 169.17, // Bluey Light and Surprise Heeler House (was 170)
  "B0G2T1VN17": 174.98, // LEGO City Lava Land Roller Coaster Park 60501 (was 175)
  "B0G4SCX27Q": 382.49, // Meta Quest 3S VR Headset, 256GB (was 382, Amazon list $449.99)
  "B0DZ77D5HL": 379, // Apple iPad 11-inch (A16, 128GB, Wi-Fi) (was 399, Amazon list $449.0)
};

/** The 11-24 re-read price of an amazon.com/dp/<ASIN> link, or undefined when it did not change. */
export function amazonPrice1124(href) {
  const m = /amazon\.com\/(?:dp|gp\/product)\/([A-Z0-9]{10})/.exec(String(href));
  return m ? AMAZON_PRICES_1124[m[1]] : undefined;
}
