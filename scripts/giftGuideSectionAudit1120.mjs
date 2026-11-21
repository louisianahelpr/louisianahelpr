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
  "store-apple": [[/^Apple Watch SE 3 GPS \+ Cellular 40mm/i, "second SE 3 listing"]],
  "store-nike": [[/^Nike Everyday Plus Cushioned Crew Socks/i, "second sock pack"]],
  "store-old-navy": [[/^Old Navy SoSoft Crew-Neck Cardigan/i, "second cardigan"]],
  "work-life": [[/^UGEARS Bike DIY Kit/i, "model kit in Office & Professional"], [/^CanaKit Raspberry Pi 5 Starter Kit/i, "hobby computer in Office & Professional"]],
  "gifts-by-budget": [[/^HEYDUDE Wally Slipper/i, "$59.99 in Under $50"], [/Kate Spade Ch[eé]rie Eau de Parfum/i, "$95 and up in Under $50"]],
};
/** The card named a product the link and photo do not show: [old name test, real name, real brand?]. */
export const RENAMED_1120 = [
  [/^Le Creuset Signature Dutch Oven, Nectar$/i, "Le Creuset Heritage Butter Dish, Nectar"],
  [/^Columbia Men's Fleece$/i, "The North Face Men's Glacier Fleece Jacket", "The North Face"],
  [/^RENPHO Shiatsu Neck Massager$/i, "RENPHO Heated Neck & Shoulder Wrap"],
  [/^Futura Laboratories X Crocs Classic Clog$/i, "Crocs Classic Lined Clog, Emerald"],
  [/^Kitsch Sage Green Pillow Cases Queen Set/i, "Bedsure Bamboo Cooling Pillowcases, Sage Green (Queen, Set of 2)", "Bedsure"],
  [/^Ninja Fireside360™ Outdoor Heater & Propane Fire Pit - Samsclub\.com$/i, "Ninja Fireside360 Outdoor Heater & Propane Fire Pit", "Ninja"],
];

/** The pick as the audit leaves it: undefined when it goes, a renamed copy, or the pick itself. */
export function auditFix1120(slug, p) {
  const name = String(p?.name ?? "");
  if (GONE_1120.some(([re]) => re.test(name))) return undefined;
  if ((GONE_IN_GUIDE_1120[slug] ?? []).some(([re]) => re.test(name))) return undefined;
  const r = RENAMED_1120.find(([re]) => re.test(name));
  return r ? { ...p, name: r[1], ...(r[2] ? { brand: r[2] } : {}) } : p;
}
