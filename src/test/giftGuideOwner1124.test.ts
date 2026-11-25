/**
 * The owner's 11-24 guide changes (scripts/giftGuideOwner1124.mjs): her approved higher-commission switches ("[if we have
 * a] higher commission no need to ask", ~1:10 AM, on the Desktop review page reviews/later-switches-1124.html) and her
 * Macy's adds (~2:05 / ~2:15 AM screenshots). The lists below are copied from the links made in her ShopMy and Later that
 * night (~/.lh-shots/later-switches-1124-handoff.md), not from the module, so each check is two-way.
 * @mutate scripts/giftGuideOwner1124.mjs | href: shopmy("p-110117645"), store: "store-stanley", commission: 18, | href: shopmy("p-110117645"), store: "store-stanley", commission: 4.5,
 * @mutate scripts/giftGuideOwner1124.mjs | href: "https://mavely.app.link/LP97ij8Zj8b", store: "store-columbia", commission: 8.4, price: 39, | href: "https://mavely.app.link/LP97ij8Zj8b", store: "store-columbia", commission: 8.4, price: 34.5,
 * @mutate scripts/giftGuideOwner1124.mjs |   return { ...r, ...rest, sortPrice: price, price, priceAt: OWNER_1124_PRICE_AT }; |   return r;
 * @mutate scripts/giftGuideHimKids1121.mjs | .concat(HIM_AMAZON_MORE_1121, HIM_SHOPMY_1121).map(rateSwitch1124); | .concat(HIM_AMAZON_MORE_1121, HIM_SHOPMY_1121);
 * @mutate scripts/giftGuideOwnerAdds1122.mjs | ].map(dated).map(rateSwitch1124); // Muck Arctic Pro | ].map(dated); // Muck Arctic Pro
 * @mutate scripts/giftGuideOwnerAdds1122.mjs | ].map(dated).map(rateSwitch1124); // BISSELL | ].map(dated); // BISSELL
 * @mutate scripts/giftGuideHer1121.mjs | ...HER_LINKS_1123, ...HER_ADDS_1124, ...HER_AMAZON_BEAUTY_1124]; | ...HER_LINKS_1123, ...HER_AMAZON_BEAUTY_1124];
 * @mutate scripts/giftGuideHimKids1121.mjs | ...KIDS_LINKS_1123, ...KIDS_ADDS_1124]) { | ...KIDS_LINKS_1123]) {
 * @mutate scripts/giftGuideCutouts1120.mjs | for (const [from, file] of CUTOUTS_1124) CUTOUTS_1120.set(from, file); | void CUTOUTS_1124;
 * @mutate scripts/giftGuideHimKids1121.mjs | ...HIM_WALMART_1123, ...HIM_ADDS_1124]) { | ...HIM_WALMART_1123]) {
 * @mutate scripts/giftGuideOwner1124.mjs | export const HIM_ADDS_1124 = HIM_STEALS_1124_ROWS.map(steal); | export const HIM_ADDS_1124 = [];
 * @mutate scripts/giftGuideOwner1124.mjs | ...KIDS_MACYS_1124_ROWS.map(macys), ...KIDS_STEALS_1124_ROWS.map(steal)]; | ...KIDS_MACYS_1124_ROWS.map(macys)];
 * @mutate scripts/giftGuideOwner1124.mjs | ...HER_MACYS_1124_ROWS.map(macys), ...HER_STEALS_1124_ROWS.map(steal)]; | ...HER_MACYS_1124_ROWS.map(macys)];
 * @mutate scripts/giftGuideOwner1124.mjs |   ...STEALS_CUTOUTS_1124, |   // no steals cutouts
 * @mutate scripts/giftGuideSteals1124.mjs | ["https://go.shopmy.us/p-110125353", 24.99, | ["https://go.shopmy.us/p-110125353", 49.99,
 * @mutate scripts/giftGuideHimKids1121.mjs | .map(rateSwitch1124); // My Mario playset | ; // My Mario playset
 * @mutate scripts/giftGuideOwner1124.mjs | href: "https://walmrt.us/4zZkihX", store: "store-walmart", commission: 9, price: 179, | href: "https://walmrt.us/4zZkihX", store: "store-walmart", commission: 3, price: 299,
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { RATE_SWITCHES_1124 } from "../../scripts/giftGuideOwner1124.mjs";
import { HER_STEALS_1124_ROWS, HIM_STEALS_1124_ROWS, KIDS_STEALS_1124_ROWS } from "../../scripts/giftGuideSteals1124.mjs";
import { RESEARCHED_STORES } from "@/content/giftGuidePicks";
import { tagKey } from "@/content/giftGuideKidsFilter";
import { kidsThemeMovesLive1124 } from "../../scripts/giftGuideThemes1124.mjs";
/** Kids picks that moved to their themed guide 11-24 (scripts/giftGuideKidsThemeMoves1124.mjs; that move's own guard is
 *  src/test/giftGuideKidsThemeRow1124.test.tsx): off Kids by design, so not expected here. */
const MOVED_TO_THEME = new Set(kidsThemeMovesLive1124().map((m: { href: string }) => m.href));

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
  // Later signed in again ~3:35 AM: bissell.com via Later 14% (links made ~3:30 AM).
  ["her", sm("109151385"), "https://mavely.app.link/SSVg1LN9j8b", "store-bissell", 14, 79.99, "BISSELL Little Green Mini Portable Carpet Cleaner"],
  ["her", amz("B0DQLLPYGM"), "https://mavely.app.link/68WdqBM9j8b", "store-bissell", 14, 189.99, "BISSELL PowerClean FurGuard Cordless Stick Vacuum"],
  // Walmart cheaper or level and paying more (Walmart Creator links made ~3:28 AM).
  ["him", amz("B0H51ZX6SB"), "https://walmrt.us/4zZkihX", "store-walmart", 9, 179, "GE Profile Opal Mini Nugget Ice Maker"],
  ["kids", amz("B0G4SR68GB"), "https://walmrt.us/4jpdmER", "store-walmart", 6, 44.97, "Fisher-Price Little People My Mario Adventure Playset"],
  // Owner 11-24 ~10:10 PM: her Cloud Pink Toniebox's Amazon page is dead; Cloud Pink is sold nowhere we earn, she chose Kohl's
  // (Sunset Red, store pickup only; Later link made in her dashboard ~10:12 PM).
  ["kids", amz("B0FJ2ZHPDY"), "https://mavely.app.link/iqXO1Sgtl8b", "store-kohls", 10.5, 99.99, "tonies Playtime Puppy Toniebox 2 Starter Set, Sunset Red"],
  // Lead ~3:55 AM: her Clinique campaign on Amazon Creator Connections pays 30% against ShopMy 21%, same price.
  ["him", sm("108625882"), amz("B00IPWN1LK"), "store-amazon", 30, 29.4, "Clinique For Men Oil-Free Moisturizer"],
  ["him", sm("108625877"), amz("B00P4WVQNE"), "store-amazon", 30, 23.1, "Clinique For Men Post-Shave Soother"],
  // Lead ~4:20 AM: SCHEELS's Black Friday YETI sale via Later 7% (Pace Purple / Ridgeline, about 30% cheaper; links made ~4:48-4:51 AM).
  ["her", amz("B0F79VTVFQ"), "https://mavely.app.link/bZ5RqVnfk8b", "store-scheels", 7, 59.5, "YETI Daytrip 6L Lunch Bag, Pace Purple"],
  ["him", sm("109001581"), "https://mavely.app.link/MYePdejfk8b", "store-scheels", 7, 227.5, "YETI Tundra 45 Hard Cooler"],
  ["him", sm("109004991"), "https://mavely.app.link/SGyD34lfk8b", "store-scheels", 7, 175, "YETI Hopper Flip 12 Soft Cooler"],
  ["him", sm("109004058"), "https://mavely.app.link/3DJNEdpfk8b", "store-scheels", 7, 38.5, "YETI Sidekick Dry 3L Gear Case, Pace Purple"],
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
 * [guide, link, store, commission %, price, name]: the Black Friday steals she ticked for the guides (owner 11-24 ~1:45 AM,
 * ~/.lh-shots/steals-to-guides-1124.md) and her Walmart links (~2:35 AM), copied from the links made that night
 * (~/.lh-shots/later-switches-1124/steals-links.json; the Walmart Creator links in steals-b-walmart-links.json), not from
 * the module.
 */
const wm = (code: string) => `https://walmrt.us/${code}`;
const STEALS: [string, string, string, number, number, string][] = [
  ["her", sm("110125767"), "store-target", 4, 20, "Stanley Quencher H2.0 FlowState Tumbler, 30 oz"],
  ["her", sm("110122551"), "store-macys", 16, 10, "Clinique 2-Piece Merry Minis Gift Set"],
  ["her", wm("49fAVtS"), "store-walmart", 15, 24.99, "Big Chill Women's Quilted Puffer Coat with Faux Fur Hood"],
  ["him", sm("110122396"), "store-macys", 16, 9.99, "The Cellar Morgan Ceramic Plaid Mugs, Set of 2"],
  ["him", wm("3XKh0AM"), "store-walmart", 15, 10, "The Grinch Men's 12 Days of Socks"],
  ["kids", sm("110125767"), "store-target", 4, 20, "Stanley Quencher H2.0 FlowState Tumbler, 30 oz"],
  ["kids", sm("110125685"), "store-target", 4, 8.99, "LEGO Sunflowers"],
  ["kids", sm("110125702"), "store-target", 4, 14.99, "Monster Jam Smash and Bash Toy Vehicle Playset"],
  ["kids", sm("110125781"), "store-target", 4, 10, "Hot Wheels Monster Trucks Mutant Chaos Truck, Car and Slime"],
  ["kids", sm("110125801"), "store-target", 4, 19.49, "Hot Wheels Monster Trucks Mutant Chaos Loop Challenge Playset"],
  ["kids", sm("110125818"), "store-target", 4, 19.99, "Frigidaire 6-Can Mini Fridge, Black"],
  ["kids", sm("110125837"), "store-target", 4, 24.99, "LEGO Minecraft Woodland Mansion Fighting Ring"],
  ["kids", sm("110125353"), "store-target", 4, 24.99, "Monster Jam Grave Digger Remote Control Truck"],
  ["kids", wm("4CpL44Q"), "store-walmart", 6, 13.97, "Christmas Dumpling Advent Calendar"],
  ["kids", wm("4fSzHIL"), "store-walmart", 6, 12.61, "Cute Farm Animal Dumpling Advent Calendar"],
  ["kids", wm("4jcx3OU"), "store-walmart", 6, 16.89, "UUGEE Advent Calendar, 24 Pull-Back Cars"],
  ["kids", wm("3V7qKEv"), "store-walmart", 6, 15, "Monster Jam 1:64 Truck 4-Pack with 3 Mini Jams"],
  ["kids", wm("4zIzr6p"), "store-walmart", 6, 21.56, "The Elf on the Shelf Advent Calendar Story and Activity Collection"],
  ["kids", wm("4AQxuWv"), "store-walmart", 15, 8, "KPop Demon Hunters Girls Slippers"],
  ["kids", wm("4CcMa3A"), "store-walmart", 15, 5, "Monster Jam Grave Digger Toddler Slippers"],
  ["kids", wm("3VHA424"), "store-walmart", 15, 5.84, "Bluey Toddler Pajama Set"],
  // Owner JCPenney "kids toys" screenshots (11-25 ~12:35 AM): her Later links.
  ["kids", "https://mavely.app.link/mQ3bdqWDl8b", "store-jcpenney", 10.5, 69.99, "Costway 6V Kids Electric Quad ATV Ride-On"],
  ["kids", "https://mavely.app.link/fqxGCAWDl8b", "store-jcpenney", 10.5, 99.99, "Costway Kids Pedal Go Kart"],
  ["kids", "https://mavely.app.link/1aPI2KWDl8b", "store-jcpenney", 10.5, 14.99, "Learning Resources A to Z Mini Foods"],
  ["kids", "https://mavely.app.link/1i1TtVWDl8b", "store-jcpenney", 10.5, 14.99, "Snowball Headband Hoop Game, Set of 2"],
  ["kids", "https://mavely.app.link/Rut9K5WDl8b", "store-jcpenney", 10.5, 8.99, "QUOKKA 60-Piece Kids Jigsaw Puzzle"],
  ["kids", "https://mavely.app.link/1fbvugXDl8b", "store-jcpenney", 10.5, 24.99, "Discovery Mindblown Bionic Hand DIY Hydraulic Kit"],
  ["kids", "https://mavely.app.link/e3OCqrXDl8b", "store-jcpenney", 10.5, 14.99, "Discovery Kids Spy Goggles"],
  ["kids", "https://mavely.app.link/VjBJoCXDl8b", "store-jcpenney", 10.5, 17.49, "Disney Mickey Mouse Clubhouse Grill Set"],
  ["kids", "https://mavely.app.link/ZxaYRVXDl8b", "store-jcpenney", 10.5, 34.99, "Discovery Kids 11-Piece Light Designer Drawing Kit"],
  ["kids", "https://mavely.app.link/vgUK49XDl8b", "store-jcpenney", 10.5, 50.99, "4-in-1 Kids Art Easel with Bookshelf"],
  ["kids", "https://mavely.app.link/LUeIqlYDl8b", "store-jcpenney", 10.5, 16.8, "Disney Minnie Mouse 9-Piece Shopping Playset"],
  ["kids", "https://mavely.app.link/XeknLvYDl8b", "store-jcpenney", 10.5, 11.69, "QUOKKA Toddler Scavenger Hunt Cards"],
  ["kids", "https://mavely.app.link/5mhK5l0Dl8b", "store-jcpenney", 10.5, 19.99, "Discovery Kids 24-Piece Magnetic Tiles"],
  ["kids", "https://mavely.app.link/7QubVC0Dl8b", "store-jcpenney", 10.5, 17.5, "Disney Talking Minnie Mouse Clubhouse Plush"],
  ["kids", "https://mavely.app.link/wZWXGO0Dl8b", "store-jcpenney", 10.5, 19.87, "Sperric Splash and Catch Magnetic Fishing Bath Toy"],
  ["kids", "https://mavely.app.link/2hIOUY0Dl8b", "store-jcpenney", 10.5, 19.99, "Retro Arcade Desktop Pool Table Game"],
  ["kids", "https://mavely.app.link/lAc8De1Dl8b", "store-jcpenney", 10.5, 14.99, "Learning Resources Lock and Key Clubhouse"],
  ["kids", "https://mavely.app.link/5QNqNo1Dl8b", "store-jcpenney", 10.5, 19.99, "Retro Arcade Duck Shooting Gallery Game"],
  ["kids", "https://mavely.app.link/j53Kfz1Dl8b", "store-jcpenney", 10.5, 31.99, "Kiddieland Noah's Ark Play Set"],
  ["kids", "https://mavely.app.link/YteYEJ1Dl8b", "store-jcpenney", 10.5, 29.99, "Discovery Mindblown Planetarium Projector"],
  ["kids", "https://mavely.app.link/6EGA1T1Dl8b", "store-jcpenney", 10.5, 19.99, "Sharper Image Flip Stunt Rally RC Car"],
  ["kids", "https://mavely.app.link/eLRI671Dl8b", "store-jcpenney", 10.5, 20.69, "QUOKKA Kids Sewing Craft Kit"],
  ["kids", "https://mavely.app.link/phkEti2Dl8b", "store-jcpenney", 10.5, 19.99, "Discovery Kids Bright Doodles LCD Art Tablet"],
  // Owner round-3 screenshot picks (11-24 ~11:08-11:15 PM, via the lead): her PAW Patrol Lookout Tower (Target, her ShopMy link) and the
  // non-theme prints of the multi-print Walmart listings she sent, plus her non-Bluey Walmart items.
  ["kids", "https://go.shopmy.us/p-110699595", "store-target", 4, 59.99, "PAW Patrol My Size Lookout Tower Vehicle Playset"],
  ["kids", wm("4eUyq3F"), "store-walmart", 15, 5.4, "SpongeBob Toddler Pajama Set (12M-5T)"],
  ["kids", wm("4lc3orK"), "store-walmart", 15, 5.4, "Disney Princess Toddler Pajama Set, Pink (12M-5T)"],
  ["kids", wm("4zETfHG"), "store-walmart", 15, 5.4, "Grinch Toddler Pajama Set, Red (12M-5T)"],
  ["kids", wm("4eVQ07i"), "store-walmart", 15, 7.19, "Toy Story Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("4AXpPpv"), "store-walmart", 15, 7.19, "PAW Patrol Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("4eWzgNd"), "store-walmart", 15, 15.99, "Barbie Toddler Coat-Top Pajama Set (2T-5T)"],
  ["kids", wm("4iW9on6"), "store-walmart", 15, 7.19, "Hello Kitty Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("48Ej3ZE"), "store-walmart", 15, 7.19, "Strawberry Shortcake Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("4j1P1VH"), "store-walmart", 15, 7.19, "Mickey Mouse Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("4fPIaMM"), "store-walmart", 15, 12.98, "Minnie Mouse Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("3VHakCW"), "store-walmart", 15, 7.19, "Tonka Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("4tjUhqV"), "store-walmart", 15, 12.98, "Disney Princess Toddler Coat-Top Pajama Set (12M-5T)"],
  ["kids", wm("4lbUIl6"), "store-walmart", 15, 12.98, "Barbie Toddler Coat-Top Pajama Set, Pink (12M-5T)"],
  ["kids", wm("4lbUESo"), "store-walmart", 15, 7, "Disney Princess Kids Pajama Set (4-16)"],
  ["kids", wm("4A7xCkw"), "store-walmart", 15, 7, "Super Mario Kids Pajama Set, Purple (4-16)"],
  ["kids", wm("4AQzIVE"), "store-walmart", 15, 7, "Super Mario Kids Pajama Set, Blue (4-16)"],
  ["kids", wm("4AaBwJk"), "store-walmart", 15, 7, "Hello Kitty Kids Pajama Set, Purple (4-16)"],
  ["kids", wm("4tlQ2eK"), "store-walmart", 15, 7, "Hello Kitty Kids Pajama Set, Red (4-16)"],
  ["kids", wm("4eZnjGG"), "store-walmart", 15, 7, "Frozen Kids Pajama Set (4-16)"],
  ["kids", wm("4Aa49X8"), "store-walmart", 15, 7, "Lilo & Stitch Kids Pajama Set, Blue (4-16)"],
  ["kids", wm("4ARwgKs"), "store-walmart", 15, 7, "Lilo & Stitch Kids Pajama Set, Pink (4-16)"],
  ["kids", wm("3Vg2vDU"), "store-walmart", 15, 7, "Jurassic World Kids Pajama Set (4-16)"],
  ["kids", wm("4tfD9Tf"), "store-walmart", 15, 7, "Sonic Kids Pajama Set (4-16)"],
  ["kids", wm("3Vj4Kqe"), "store-walmart", 15, 7, "Teenage Mutant Ninja Turtles Kids Pajama Set (4-16)"],
  ["kids", wm("4tl8fZF"), "store-walmart", 15, 7, "Barbie Kids Pajama Set (4-16)"],
  ["kids", wm("4tgDB3I"), "store-walmart", 15, 7, "Toy Story Kids Pajama Set (4-16)"],
  ["kids", wm("4A0YC4p"), "store-walmart", 15, 7, "Grinch Kids Pajama Set, Pink (4-16)"],
  ["kids", wm("4zGPOjQ"), "store-walmart", 15, 5.4, "Care Bears Toddler One-Piece Sleeper (2T-5T)"],
  ["kids", wm("48I4xQr"), "store-walmart", 15, 5.4, "Minnie Mouse Toddler One-Piece Sleeper (2T-5T)"],
  ["kids", wm("4kzGB9d"), "store-walmart", 15, 5.4, "Disney Princess Toddler One-Piece Sleeper (2T-5T)"],
  ["kids", wm("4jBxIKf"), "store-walmart", 15, 6.3, "Grinch Toddler Fleece Robe (12M-5T)"],
  ["kids", wm("4jaUUPc"), "store-walmart", 15, 6.3, "Strawberry Shortcake Toddler Fleece Robe (12M-5T)"],
  ["kids", wm("4jb5vcF"), "store-walmart", 15, 6.3, "Minnie Mouse Toddler Fleece Robe (12M-5T)"],
  ["kids", wm("4j9FpqC"), "store-walmart", 15, 10, "Minnie Mouse Toddler Patriotic Tee (12M-5T)"],
  ["kids", wm("4A1HtrP"), "store-walmart", 15, 14, "Toy Story Toddler Patriotic Tee (12M-5T)"],
  ["kids", wm("4jamQm7"), "store-walmart", 15, 11.97, "Stitch Toddler Patriotic Tee (12M-5T)"],
  ["kids", wm("3X7CzuU"), "store-walmart", 15, 14, "Mickey Mouse Toddler Patriotic Tee (12M-5T)"],
  ["kids", wm("4A1xnHu"), "store-walmart", 15, 14.49, "Hello Kitty Toddler Patriotic Tee (12M-5T)"],
  ["kids", wm("4fqQX7K"), "store-walmart", 15, 7, "Hello Kitty Toddler Girls Beanie and Gloves Set"],
  ["kids", wm("4jb5wgJ"), "store-walmart", 15, 7, "Lilo & Stitch Toddler Girls Beanie and Gloves Set"],
  ["kids", wm("4jhFZmp"), "store-walmart", 15, 11.98, "Toy Story Jessie Toddler Girls Beanie and Gloves Set"],
  ["kids", wm("4j8cZ03"), "store-walmart", 15, 11.98, "Toy Story Toddler Girls Beanie and Gloves Set"],
  ["kids", wm("3Vfu4xm"), "store-walmart", 15, 4.5, "PAW Patrol Toddler Pajama Set (12M-5T)"],
  ["kids", wm("4ANUqp7"), "store-walmart", 15, 3.38, "Ms. Rachel Baby Girls Tee and Shorts Set (0-9M)"],
  ["kids", wm("4ku91Bo"), "store-walmart", 6, 11.04, "Disney Eeyore Mini Bean Bag Plush"],
  ["kids", "https://mavely.app.link/yftqKoJ9j8b", "store-kohls", 10.5, 44.99, "Monster Jam Megalodon & El Toro Loco Supercharge Speedway Playset"],
  ["kids", wm("4texdKc"), "store-walmart", 6, 54, "Sony PS5 DualSense Wireless Controller, Midnight Black"],
  ["kids", sm("110122442"), "store-macys", 16, 8, "Gund Kuromi Cupcake Plush"],
  ["kids", sm("110122526"), "store-macys", 16, 5.57, "UNO Artiste Vexx Card Game"],
  ["kids", sm("110122583"), "store-macys", 16, 12.57, "Super Mario Deluxe Bowser Battle Playset"],
  ["kids", sm("110122602"), "store-macys", 16, 13.97, "Starlight Glam Light-Up Vanity Playset"],
  ["kids", sm("110122700"), "store-macys", 16, 16.77, "Journey Girls Glam Runway 4-Sided Fashion Show Playset"],
  ["kids", sm("110122792"), "store-macys", 16, 19.99, "Steve Madden Girls' Lightweight Hooded Packable Jacket"],
  ["him", sm("110122844"), "store-macys", 16, 25, "adidas Men's Essentials Feel Cozy Fleece Hoodie"],
  ["him", sm("110135239"), "store-crocs", 10, 25, "Crocs Classic Cozzzy Slipper"],
  ["him", "https://mavely.app.link/y7KIsnyak8b", "store-kohls", 10.5, 99.99, "Beats Solo 4 On-Ear Wireless Headphones, Matte Black"],
  ["kids", sm("110135306"), "store-crocs", 10, 23, "Crocs Kids' Classic Clog"],
  ["kids", sm("110137252"), "store-crocs", 10, 25, "Crocs Kids' Classic Cozzzy Slipper"],
  ["her", sm("110137387"), "store-lululemon", 12, 9, "lululemon Mini Everywhere Belt Bag Keychain"],
  ["her", sm("110137457"), "store-lululemon", 12, 9, "lululemon Logo Bead Hair Ties, 3 Pack"],
  ["her", sm("110137572"), "store-kate-spade-new-york", 16, 29, "Kate Spade Lucy Wristlet, Black"],
  ["her", "https://mavely.app.link/wb8BXrxck8b", "store-jcpenney", 10.5, 7.99, "North Pole Trading Co. Holiday Velvet Plush Throw, Trees"],
  ["her", "https://mavely.app.link/vRv8iAthk8b", "store-kohls", 10.5, 1.99, "SHINE Women's Holiday Crew Socks, Santa"],
  ["her", "https://mavely.app.link/n2955rKik8b", "store-jcpenney", 10.5, 29.99, "Beautyrest Ultrasoft Plush Heated Throw, Gray Fairisle"],
];
/**
 * Measured 11-24 and kept where they were (no store paying more for the same item at about the same price): Later's
 * Target rate is by category (Toys 2.8%, Home & Outdoor 4.9%; "up to 7%" is Target's HeyDay brand only) against ShopMy
 * Target's 4%; anker.com sells the power bank only in a bundle; the Sol & Go mist set is
 * on neither soldejaneiro.com nor Ulta.
 */
const KEPT: [string, string][] = [
  ["kids", sm("109218761")], ["kids", sm("109208104")],
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
      if (guide === "kids" && MOVED_TO_THEME.has(sm(pin))) continue;
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

describe("owner 11-24: the Black Friday steals she ticked", () => {
  it("each is on its guide once, at the steal price read 11-24, with its link's store and rate and a cutout photo", () => {
    expect(STEALS.length).toBeGreaterThan(12);
    expect(HER_STEALS_1124_ROWS.length + HIM_STEALS_1124_ROWS.length + KIDS_STEALS_1124_ROWS.length).toBe(STEALS.length);
    for (const [guide, href, store, commission, price, name] of STEALS) {
      if (guide === "kids" && MOVED_TO_THEME.has(href)) continue;
      for (const list of [chunk(guide), built[guide]]) {
        const rows = list.filter((p) => p.href === href);
        expect(rows.length, `${guide}: ${name}`).toBe(1);
        expect(rows[0], name).toMatchObject({ name, store, commission, price, priceAt: "2026-11-24" });
        expectCutout(rows[0]);
        expect(RESEARCHED_STORES[store]?.hosts, store).toContain(new URL(href).hostname);
      }
    }
  });

  it("each Kids steal has a girls/boys/everyone tag, and its listing's age wherever the listing gives one", () => {
    const tags = (JSON.parse(readFileSync("src/content/giftGuideKidsTags.json", "utf8")) as { tags: Record<string, { gender?: string; ageMin?: number; ageSource?: string }> }).tags;
    const aged = [sm("110125685"), sm("110125702"), sm("110125781"), sm("110125801"), sm("110125837"), sm("110125353"), wm("4jcx3OU"), wm("3V7qKEv"), wm("4CcMa3A"), wm("3VHA424"), "https://mavely.app.link/yftqKoJ9j8b"];
    for (const [, href, , , , name] of STEALS.filter((m) => m[0] === "kids")) {
      const t = tags[tagKey(href)];
      expect(t, name).toBeTruthy();
      expect(["girls", "boys", "everyone"]).toContain(t.gender);
      if (aged.includes(href)) {
        expect(typeof t.ageMin, name).toBe("number");
        expect(t.ageSource, name).toMatch(/^(target|walmart|macys|kohls)\.com .*read 2026-11-24: /);
      }
    }
    expect(aged.length).toBeGreaterThan(7);
  });
});
