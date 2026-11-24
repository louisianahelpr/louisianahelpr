/**
 * OWNER 11-24 TRIM (Tue Nov 24, 2026, late morning CT, relayed by the lead): the picks she approved taking off For Her, For Him and For Kids, from
 * the trim review (~/.lh-shots/guide-trim-1124/labels.json, IDs from the 2:52 AM snapshot of origin/main 99a40e40c2) and
 * its store re-check (Desktop "Louisiana Helpr Tracker/reviews/trim-ratecheck-1124.md", no other store pays
 * meaningfully more for these at a similar price, or the reason was not money). Guard: src/test/giftGuideTrim1124.test.ts.
 *
 * Kept (not on this list): Her R13 YETI Daytrip (already on SCHEELS's sale via Later), Him R20 Carhartt Paxton and Him R30
 * LaCrosse Burly (both kept with a store switch, scripts/giftGuideOwner1124.mjs).
 *
 * Keyed by the pick's link on the page at trim time. Three had moved store since the snapshot, so they are matched by name
 * and listed under the new link: Her R1 e.l.f. Lip Exfoliator (Amazon B0CB23NZGT -> elfcosmetics.com via Later), Her R2
 * e.l.f. Glow Reviver Lip Oil (Amazon B0CMJZVT5P -> Ulta via ShopMy) and Him R32 GE Profile Opal Mini (Amazon B0H51ZX6SB ->
 * Walmart Creator). The source rows stay where they are (their history is in them); the builders drop these links.
 * Counts after the trim (2026-11-24): Her 198 -> 181, Him 210 -> 205, Kids 173 -> 167.
 */

const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const shopmy = (pin) => `https://go.shopmy.us/${pin}`;

/** [trim ID, guide, link on the page, name] for each pick she took off. */
export const TRIM_1124_ROWS = [
  ["Her R1", "her", "https://mavely.app.link/TptnXLe0j8b", "e.l.f. Lip Exfoliator, Brown Sugar"],
  ["Her R2", "her", shopmy("p-110118320"), "e.l.f. Glow Reviver Lip Oil"],
  ["Her R3", "her", amz("B00GSH0KR2"), "Kiehl's Lip Balm #1, 0.5 oz"],
  ["Her R4", "her", amz("B0C7LTPXBV"), "TULA Spresso Energizing Eye Balm"],
  ["Her R6", "her", amz("B0HKS18NW2"), "CFUNIQ Personalized Hanging Toiletry Bag"],
  ["Her R10", "her", shopmy("p-109200757"), "Crown Affair The Silk Pillowcase"],
  ["Her R11", "her", amz("B0CDF7GJ4Y"), "Kitsch XL Microfiber Hair Towel Wrap"],
  ["Her R12", "her", amz("B0HKYH5TF2"), "HydroJug Sport 32 oz Water Bottle, Mocha Tortoise"],
  ["Her R17", "her", amz("B0DWHDM15Q"), "The Ridge 20W Magnetic Power Bank"],
  ["Her R19", "her", amz("0935032029"), "Talk About Good! Cookbook"],
  ["Her R20", "her", amz("B0GP2R8TBS"), "eto Wine Decanter and Preserver, Stainless"],
  ["Her R21", "her", amz("B09X55PDB7"), "Capri Blue Volcano Car Diffuser + Refills"],
  ["Her R22", "her", amz("B0G3948RG8"), "Personalized Lizard Leather Initial Card Holder"],
  ["Her R23", "her", amz("B0F41DGFXT"), "Matador Global Travel Adapter"],
  ["Her R24", "her", amz("B0H2CSG4SZ"), "Striped Paper Gift Bags with Ribbon Handles"],
  ["Her R25", "her", amz("B0FXBBD5GS"), "Personalized Monogram Scallop Gift Tags"],
  ["Her R26", "her", amz("B0DN245D58"), "Scrub Mommy Dual-Sided Sponges, 5 Count"],
  ["Him R25", "him", amz("B0CNCYJHG5"), "KastKing SteelStream Fishing Tool Kit"],
  ["Him R29", "him", amz("B0HDDLPQV5"), "Duke Cannon Lump of Coal Big Brick of Soap, 10 oz"],
  ["Him R31", "him", amz("B0G4XRP464"), "Amazon Fire TV Stick 4K (newest model)"],
  ["Him R32", "him", "https://walmrt.us/4zZkihX", "GE Profile Opal Mini Nugget Ice Maker"],
  ["Him R33", "him", amz("B0F53HMTX5"), "HOTO Car Vacuum"],
  ["Kids R1", "kids", amz("B0H9ZZGK8W"), "Crunchy Butter Squishy Toy"],
  ["Kids R2", "kids", amz("B0HGX9TVW6"), "Skillmatics Aqua Puffs Christmas Ornaments"],
  ["Kids R3", "kids", amz("B0DCVF7YNW"), "Kinglucky Mini Karaoke Machine for Kids"],
  ["Kids R4", "kids", amz("B0D6RMZ3D1"), "YEEHAO Kids Digital Camera"],
  ["Kids R7", "kids", amz("B0F1N2MPND"), "Kids Hammock Chair with Cup Holder"],
  ["Kids R9", "kids", shopmy("p-109731941"), "Burt's Bees Baby Nostalgic Christmas Two-Piece Pajamas"],
];

const TRIMMED = Object.fromEntries(["her", "him", "kids"].map((g) => [g, new Set(TRIM_1124_ROWS.filter((r) => r[1] === g).map((r) => r[2]))]));

/** A guide's builder rows without the picks she took off 11-24. */
export const trim1124 = (guide, rows) => rows.filter((r) => !TRIMMED[guide].has(r.href));
