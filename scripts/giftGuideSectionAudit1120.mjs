/**
 * Section audit 11-20 (gg-section-audit-1120, Highs every one verified on the retailer page that day): picks that are
 * sold out, discontinued, a dead link or last year's edition leave the guides, and cards whose name is not the product
 * the link and photo show take the real name. Applied by scripts/gift-guide-picks.mjs in its last pass, so it holds for
 * a pick however it reached a page. Removals never get a filler: a section under 10 merges, it is never padded.
 */
/** Gone everywhere: [name test, why]. */
export const GONE_1120 = [
  [/^Kodak Ektar H35 Half Frame Film Camera/i, "sold out at the linked shop"],
  [/^JBL Go 4 Bluetooth Speaker/i, "all 4 colours sold out at the linked shop"],
  [/^Pokemon Pok[eé]mon TCG: Mega Evolution Phantasm/i, "in store only, cannot ship"],
  [/^Pokemon Pok[eé]mon TCG: Azure Legends Tin/i, "in store only, cannot ship"],
  [/^Pokemon TCG Elite Trainer Box/i, "the link is a different, July 2025 box"],
  [/^LEGO Technic Lamborghini Hurac[aá]n Tecnica/i, "retired by LEGO"],
  [/^Logitech MX Master 3S\b/i, "previous generation (MX Master 4 is out)"],
  [/Rare Beauty Selena's Faves Mini/i, "Holiday 2025 limited edition"],
  [/^Rare Beauty Soft Pinch Cheek & Lip Trio/i, "Holiday 2025 limited edition"],
  [/Privet House Woodland Shield/i, "sold out"],
  [/^Meri Meri Nutcracker Gift Tags/i, "dead link (404)"],
  [/^Sugar Paper Christmas Peel-and-Stick Gift Ta/i, "dead link (404)"],
  [/^Splendid Red Satin Silk PJ Set/i, "sold out in every size"],
  [/^Madhappy Blue Ugg Edition Ultra Mini Boots/i, "limited collab, no price, men's resale page"],
  [/^UnderArmour x BlacktipH Fish Elite Camo Hood/i, "out of stock in both colours"],
  [/^Printfresh Long Cotton Robe/i, "sold out in every size"],
  [/^Coach Signature MagSafe Wallet/i, "dead link (404)"],
  [/^Duck Head 5-Panel Unstructured Rope Hat/i, "sold out"],
  [/^Smathers & Branson Upland Shoot Needlepoint/i, "one size left"],
  [/^Madewell x Manos Del Uruguay Cableknit Pom/i, "discontinued collab, not on madewell.com"],
  [/^AeroGarden Harvest/i, "brand wound down, site redirects"],
  [/^BaubleBar Horseshoe Necklace/i, "not in BaubleBar's live catalog"],
  [/^BaubleBar Disney Stitch Pisa Bracelet/i, "not in BaubleBar's live catalog (404)"],
  [/Stanley Stainless Steel H2\.0 Fl.*Spider Webs/i, "Halloween colourway"],
];
/** Gone from one guide only: the pick is fine elsewhere. */
export const GONE_IN_GUIDE_1120 = {
  heroes: [[/^Durango Workhorse Ventilated Work Boot/i, "3 of 24 sizes in stock; stays in Work life and the Durango page"]],
  her: [[/^Printfresh Eco Satin Rittenhouse Pajama Set/i, "wrong price and a 4th sleepwear item"]],
  // Owner rules the lists still broke: Louisiana brands and items only in Louisiana sections; the Under $50 cap.
  "coffee-lover": [[/^Community Coffee\b/i, "Baton Rouge brand in a national guide"]],
  "home-and-kitchen": [[/^Geometry Greetings From Louisiana Tea Towel/i, "Louisiana item in a non-Louisiana section"]],
  // Wrong fit for the section, or a second copy of one type (audit fix: remove; no filler).
  "car-lover": [[/^Smathers & Branson x Tervis Mallard Need/i, "hunting drinkware, not a car gift"]],
  "life-moments": [[/^Splendid Sugar Cookie Marna Pillowsoft/i, "second Marna set in Baby"], [/^Mind The Skin Signal Pre-Flare Patch/i, "eczema patch as a get-well gift"]],
  "louisiana-food-gifts": [[/^Gambino's Bakery King Cake/i, "Mardi Gras cake in a Christmas sweets list, second king cake"]],
  "outdoors-and-travel": [[/^Huk Airweight Raglan Hoodie, Orange/i, "third Huk top in fishing"]],
  "shop-small-louisiana": [[/^Toups and Co Organics Merry & Bright Set/i, "not a Louisiana maker"], [/^Totally Bamboo Slice of Life Louisiana/i, "not Louisiana-made"], [/^Smathers & Branson LSU Needlepoint/i, "not a Louisiana shop"]],
  "store-dillards": [[/^Ray-Ban Polarized Classic Wayfarer Sunglasses/i, "no checked price, second Ray-Ban on the page"]],
  "store-apple": [[/^Apple Watch SE 3 GPS \+ Cellular 40mm/i, "second SE 3 listing"]],
  "store-nike": [[/^Nike Everyday Plus Cushioned Crew Socks/i, "second sock pack"]],
  "store-old-navy": [[/^Old Navy SoSoft Crew-Neck Cardigan/i, "second cardigan"]],
  "work-life": [[/^UGEARS Bike DIY Kit/i, "model kit in Office & Professional"], [/^CanaKit Raspberry Pi 5 Starter Kit/i, "hobby computer in Office & Professional"]],
  // More than two of one product type in a section or store page: the extras go, the audit's keepers stay.
  "friends-and-coworkers": [[/^Printworks Classic Poker Set/i, "4 games in Secret Santa, and about $80"], [/^Relatable What Do You Meme\? Core Game/i, "4 games in Secret Santa, adult content"]],
  healthcare: [[/^Fabletics (Evolve 3-Pocket Scrub Top|High-Rise Wide Leg Scrub Pant), (Onyx|Green Mystique)/i, "the same scrub set in three sections; Navy stays in Nurses"]],
  "store-bath-and-body-works": [[/^Bath & Body Works (Pink Suede|Snowflakes & Cashmere) 3-Wick Candle/i, "4 three-wick candles"]],
  "store-yeti": [[/^YETI (Hopper Flip 12 Soft Cooler|Tundra 45 Hard Cooler|Roadie 24 Hard Cooler)/i, "5 coolers"]],
  "gifts-by-budget": [[/^HEYDUDE Wally Slipper/i, "$59.99 in Under $50"], [/Kate Spade Ch[eé]rie Eau de Parfum/i, "$95 and up in Under $50"]],
};
/** The card named a product the link and photo do not show: [old name test, real name, real brand?, real line?]. */
export const RENAMED_1120 = [
  [/^Le Creuset Signature Dutch Oven, Nectar$/i, "Le Creuset Heritage Butter Dish, Nectar"],
  [/^Columbia Men's Fleece$/i, "The North Face Men's Glacier Fleece Jacket", "The North Face"],
  [/^RENPHO Shiatsu Neck Massager$/i, "RENPHO Heated Neck & Shoulder Wrap"],
  [/^Futura Laboratories X Crocs Classic Clog$/i, "Crocs Classic Lined Clog, Emerald"],
  [/^Kitsch Sage Green Pillow Cases Queen Set/i, "Bedsure Bamboo Cooling Pillowcases, Sage Green (Queen, Set of 2)", "Bedsure"],
  [/^Ninja Fireside360™ Outdoor Heater & Propane Fire Pit - Samsclub\.com$/i, "Ninja Fireside360 Outdoor Heater & Propane Fire Pit", "Ninja"],
  [/^STANLEY Quencher H2\.0 Flow State Tumbler$/i, "Stanley Quencher H2.0 FlowState Tumbler, 40 oz", "Stanley", "40 oz insulated tumbler."],
  [/^Nano Titanium Vented Straightening Iron - BaBylissPRO$/i, "BaBylissPRO Nano Titanium Vented Straightening Iron", "BaBylissPRO"],
  [/^Coral Coast Fine Fragrance Body Mist - Saltair$/i, "Saltair Coral Coast Fine Fragrance Body Mist", "Saltair"],
];
/** A non-Amazon pick with no price: the audit read it on the maker's own page that day: [name test, price, date, price band]. */
export const PRICED_1120 = [[/^Fire Department Coffee Backdraft Coffee$/i, 15.99, "2026-11-20", 25]];

/**
 * SAME ITEM, RIGHT LINK AND PHOTO (11-20, builder 3): the card stays the same product; its link, photo, name or price
 * moves to the variant the retailer's own page sells today. [name test, the fields to replace, the guides it applies
 * to (every guide when left out)]. Prices were read on the retailer's product page on the date given; Amazon picks
 * carry no price.
 */
const D = "2026-11-20";
const AMZ = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const STANLEY = "https://cdn.shopify.com/s/files/1/0375/3269/6635/files/";
export const RELINKED_1120 = [
  // The Marines cap, not the Army one.
  [/^Rothco Vintage Veteran Low Profile Cap$/i, { href: AMZ("B0883HJPN1"), image: "https://m.media-amazon.com/images/I/811zZtp3ZxL._AC_SL500_.jpg" }, ["heroes"]],
  // The adult A18 watch cap in black (the old link was another listing).
  // Black (B002G9UDYG) is the heroes pick; one place per item and color, so Colors (Yellow, Black & Neutral) shows the adult A18 in Carhartt Brown.
  [/^'?Carhartt'? Acrylic Knit Cuffed Beanie$/i, { name: "Carhartt Knit Cuffed Beanie, Carhartt Brown", href: AMZ("B002G9UDY6"), image: "https://m.media-amazon.com/images/I/91dRLj9dgZL._AC_SL500_.jpg" }],
  // mejuri.com US page: 18k gold vermeil, $171.
  [/^Mejuri Stevie Hoop Earrings$/i, { image: "https://cdn.shopify.com/s/files/1/0631/8568/2616/files/3-THENEWHOOP-TheNewHoopVermeilHoopVermeilCharm-V-AngledFrontView_061_3f4f28ff-b6e1-45ba-9ddc-5ec29192b37a.jpg", price: 171, priceAt: D, band: 500 }],
  // Lilac is no longer sold; Soft Orchid Gloss is the purple one, $22.50 on stanley1913.com.
  [/^Stanley All Day Slim Bottle 20 oz, Lilac$/i, { name: "Stanley All Day Slim Bottle 20 oz, Soft Orchid", image: STANLEY + "Web_PNG_Square-TheAllDaySlimBottle20OZ-SoftOrchidGloss-Front.png", price: 22.5, priceAt: D, band: 25 }],
  // Polished Rose Gold is sold out; Rose Quartz is in stock at $18.75 on the same stanley1913.com page.
  [/^Stanley The Reserve Wine Tumbler, 11 OZ$/i, { image: STANLEY + "Web_PNG_Square-The_Reserve_Wine_Tumbler_11OZ_-_Rose_Quartz_-_Front.png", price: 18.75, priceAt: D, band: 25 }],
  // ulta.com product page price.
  [/^(Nano Titanium Vented Straightening Iron - BaBylissPRO|BaBylissPRO Nano Titanium Vented Straightening Iron)$/i, { price: 125.99, priceAt: D, band: 500 }],
  // Best Buy sells the standard Elite Trainer Box, not the Pokémon Center edition.
  [/^Pokemon TCG: Mega Evolution—Chaos Rising Pokémon Center Elite Trainer Box$/i, { name: "Pokémon TCG: Mega Evolution Chaos Rising Elite Trainer Box" }, ["store-best-buy"]],
];

/** The pick as the audit leaves it: undefined when it goes, a renamed copy, or the pick itself. */
export function auditFix1120(slug, p) {
  const name = String(p?.name ?? "");
  if (GONE_1120.some(([re]) => re.test(name))) return undefined;
  if ((GONE_IN_GUIDE_1120[slug] ?? []).some(([re]) => re.test(name))) return undefined;
  const pr = PRICED_1120.find(([re]) => re.test(name));
  if (pr && typeof p.price !== "number") p = { ...p, price: pr[1], priceAt: pr[2], band: pr[3] };
  const l = RELINKED_1120.find(([re, , only]) => re.test(name) && (!only || only.includes(slug)));
  if (l) p = { ...p, ...l[1] };
  const r = RENAMED_1120.find(([re]) => re.test(name));
  return r ? { ...p, name: r[1], ...(r[2] ? { brand: r[2] } : {}), ...(r[3] ? { line: r[3] } : {}) } : p;
}
