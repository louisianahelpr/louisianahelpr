/**
 * The gift-guide import's content rules (design audit round 2, 11-18), read by scripts/gift-guide-picks.mjs and
 * guarded by src/test/giftGuideAuditR2.test.ts.
 */
const compact = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * DESIGN AUDIT R2 (11-18). Names: a web page title ("Home | HamiltonBeach.com", "Monthly Fruit Delivery | Fruit of the
 * Month Club | Harry & David") keeps its first part that is not the store; a name that is only a store or brand
 * (Omaha Steaks, Bass Pro Shops), a sale or promo ("Black Friday Sale", "Cyber Monday Beauty Deals 2025"), a page title
 * dated before 2026 ("… Delivered 2024", while a "2027 Planner" is a product) or a guide name is no product, so the pick is hidden. Nothing is renamed beyond cutting those parts off.
 */
export const PROMO_NAME = /\b(black friday|cyber monday|cyber week|sales?|deals?|coupons?|promo(tion)?s?|clearance|free shipping|valid thru|shop now|shop early|shop online|gift guides?|bogo|doorbusters?|savings?)\b|% off|\bbuy \d+,? get\b|\b\d+ get \d+ free\b/i;
/** A year before the 2026 season (written 2026-11-18) in a page title ("… Delivered 2024 | Harry & David"); a product's model year ("Kindle (2024)") stays. */
export const OLD_YEAR = /\b(19\d\d|20[01]\d|202[0-5])\b/;
export const domainName = (s) => /^[\w-]+(\.[\w-]+)*\.(com|net|org|co|us|shop|store)$/i.test(s);
/**
 * A shop's category or collection page named like a product (owner 11-18 PM, Our Top 10): "Kitchen & Cooking Gifts",
 * "DKNY Women's Clothing & Accessories", "The Holiday Collection", "Serums, Cosmetics & Haircare, & More",
 * "Luxury Japanese Skincare Products", "Educational Toys & Learning Toys from …", "Gifts & Value Sets",
 * "Stand Mixer Accessories", "Wolferman's Bakery: English Muffins, Baked Goods & Breakfast Gifts".
 */
export const CATEGORY_NAME = /^(the )?[a-z' ]*collection$|\b\w+ & [\w' ]*\b(gifts|accessories)$|&\s*more$|\btoys & [\w ]*toys\b|\bskincare products$|^gifts & |^[a-z]+( [a-z]+){0,2} accessories$|^[^:\d]+:[^,\d]+,[^&\d]+&[^\d]*$/i;
export const GENERIC_SEGMENT = /^(home|shop|official site|online store|[\w' ]*gifts?)$/i;
export function productName(raw, names, host = "") {
  const bare = (x) => compact(String(x).replace(/\s+(US|USA|UK)$/i, ""));
  const sameAsStore = (x) => names.some((n) => n && bare(n) && bare(n) === bare(x)) || (compact(x).length > 2 && compact(host).includes(compact(x)));
  const parts = String(raw ?? "").replace(/\s+/g, " ").trim().split(/\s*\|\s*|\s+[–—]\s+/).filter(Boolean);
  // A store's home page title starts with the store ("Old Navy | Affordable Clothing…", "Jared | Your Jewelry Store…").
  if (parts.length > 1 && sameAsStore(parts[0].replace(/[®™]/g, ""))) return null;
  const kept = parts.filter((x) => !sameAsStore(x.replace(/[®™]/g, "")) && !domainName(x) && !GENERIC_SEGMENT.test(x.trim()));
  const first = (kept[0] ?? "").trim().replace(/^buy (the )?/i, "");
  // "Jared | Jared": a page titled twice with one word is a store page.
  if (parts.length > 1 && parts.every((x) => compact(x) === compact(parts[0]))) return null;
  if (!first || PROMO_NAME.test(first) || (parts.length > 1 && OLD_YEAR.test(first)) || /^shop\b/i.test(first)) return null;
  // A category page ("Running Shoes, Clothing, & Accessories", "Luxury Organic Bedding, Sheets & Towels") or an error page.
  if ((parts.length > 1 && /,/.test(first) && /&|\band\b/.test(first)) || /not ?found|page not|\b404\b/i.test(first)) return null;
  // ... or one with no comma whose title pairs two plural kinds ("Skincare Routine Tools & LED Face Masks | Shark Beauty",
  // "Food Processors & Choppers Products | KitchenAid US"; owner 11-18 PM saw the first in Our Top 10).
  if (parts.length > 1 && /\b\w+s & [\w' ]*\w+s$/i.test(first)) return null;
  if (CATEGORY_NAME.test(first)) return null;
  // A web page's own title, not a product (design lead 11-18 PM: "Client Challenge", "Limited Time", a cake named "6").
  if (PAGE_TITLE_NAME.test(first.trim())) return null;
  // A short size or variant after the name stays ("The Quencher H2.0 FlowState Tumbler | 40 OZ" -> "…Tumbler, 40 OZ").
  const variant = kept.slice(1).filter((x) => x.length <= 12 && !PROMO_NAME.test(x) && compact(x) !== compact(first) && !/\b(US|USA|UK)$/.test(x));
  return [first, ...variant].join(", ");
}
/**
 * Thumbnails that show the wrong thing (design audit loop 2026-11-18 PM, ~/.lh-shots/design-audit-loop/gg-wrong-images-1118.json:
 * store logos, banners and favicons standing in for a product, checked by eye on the live pages, 2026-11-18). Matched without the query.
 */
export const WRONG_IMAGES = new Set([
  "https://cdn.prod.website-files.com/615c0fadc8e1d78fcc34e6f0/61957a7123c75c270fea2676_open_graph_image-min.png",
  "https://cdn.shopify.com/s/files/1/0520/7051/4860/files/5e63cf80-efd6-447c-9821-aa9a6e037b55.jpg",
  "https://cdn.shopify.com/s/files/1/0520/7051/4860/files/copper_joe_pink_lifestyle_1.png",
  "https://cdn.shopify.com/s/files/1/0853/0467/2539/files/904643502_10162929993012105_1441846849210934140_n_45dffe6e-d44b-456c-9d35-7d5825726101.jpg",
  "https://cdn.shopify.com/s/files/1/1033/0751/files/LinkSharing-SEO-Thumbnail_1.jpg",
  "https://cdn11.bigcommerce.com/s-4df9uz5/images/stencil/original/carousel/22/shop_all__28122.jpg",
  "https://d3tvemk8zf61cc.cloudfront.net/FB_FBT_logo.jpg",
  "https://images.contentstack.io/v3/assets/blt72739032ac3bdcc6/blta0835708627fd460/602076e937c7bc6afba5213d/Wolfermans-Logo-250x250.jpg",
  "https://images.journeys.com/images/site/1_JourneysUS.png",
  "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/67729fee9a5749b7bc2ab88e0f2c97f4~tplv-fhlh96nyum-crop-webp:800:800.webp",
  "https://res.cloudinary.com/mavely/image/upload/v1654029138/anzdqjqsfz7c7uxx3n05.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1657761519/uouyqlvynadadrvuebhk.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1673364608/Kids_Foot_Locker_logo_90d9ff3bc8.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1688747498/i_Screen_Shoter_Google_Chrome_230707113126_9dc82fd4d6.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1693950711/site_logo_blue_84ee0fe42c.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1694968896/Sonos_logo_c655260285.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1696267560/Tervis_logo_143e880a8f.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1696869768/Champs_logo_1a35ec324d.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1707764960/Black_Rifle_Coffee_Company_logo_f10619ece1.jpg",
  "https://res.cloudinary.com/mavely/image/upload/v1744765053/UA_logo_77dc52e99f.png",
  "https://res.cloudinary.com/mavely/image/upload/v1777561906/Capture_34aaf445c7.png",
  "https://warmies.com/cdn/shop/files/favicon.png",
  "https://www.heydude.com/on/demandware.static/Sites-heydude_us-Site/-/default/dwaa3652e0/images/logo-heydude-og-badge.png",
  "https://www.lecreuset.com/dw/image/v2/BDRT_PRD/on/demandware.static/-/Sites-le-creuset-master/default/dw758a39fe/images/cat_cookware_sets/eleven_set_cast_iron_marseille_100.jpg",
  "https://www.yankeecandle.com/mobify/bundle/21709/static/img/global/brand-logo.png",
]);
/** A logo, banner, sprite or icon file, or a site's share/screenshot image, not a product photo (design lead 11-18 PM). */
export const LOGO_IMAGE = /(^|[/_.-])(logos?|banners?|sprites?|icons?)([/_.0-9-]|$)|LinkSharing|SEO-Thumbnail|open_graph_image|\/Capture_|Screen_Shot/i;
/** A logo product's own photo, not a store logo (Black Rifle's 3 Rounds Logo T-Shirt, photo finder 11-18 PM). */
export const LOGO_PRODUCT = /THREE_ROUNDS_LOGO_[A-Z_]*SHIRT/;
/** Image URLs that are no image ("…/Liquid%20error%20(snippets/social-meta-tags…", design audit r2 #8: T3 Micro). */
export const brokenImage = (u) => /liquid(%20|\s|\+)error/i.test(u) || /[<>{}]/.test(u) || SITE_ICON.test(u) || HOTLINK_BLOCKED.test(u) || NO_SHOW_FORMAT.test(u.split("#")[0])
  || (LOGO_IMAGE.test(u.split("?")[0]) && !LOGO_PRODUCT.test(u)) || WRONG_IMAGES.has(u.split("?")[0]);
/** A site's icon, logo or default share image, not the product (live audit r3 #12: vitamix default-meta-image, kitchenaid bookmark icon). */
export const SITE_ICON = /favicon|apple-touch-icon|bookmark-icon|default-meta-image|meta-image\.|og-badge|\/logo[-_.]/i;
/** Hosts whose product photos do not load on our pages (ORB-blocked or HTTP/2 errors, live audit r3 #12). */
// KitchenAid's image server (403) and Container Store's (503) refuse every request without a browser session
// (store-photos check 11-18 PM, re-tried with a browser user agent and our site as referer): their photos are dropped.
export const HOTLINK_BLOCKED = /^https:\/\/(www\.sephora\.com|www\.rei\.com|www\.kitchenaid\.com\/is\/image|images\.containerstore\.com)\//i;
/** Brands a feed spells in the wrong case (design audit r2 #8). */
export const BRAND_CASE = { rei: "REI", ugg: "UGG", laneige: "LANEIGE", xtratuf: "XTRATUF" };
/**
 * "Shop Louisiana" (the louisianaFit flag) is for Louisiana businesses; Muck Boot and XTRATUF are loved here but are
 * not Louisiana businesses (lead decision 11-18, design audit r2 #18): they keep their place in the guides, no badge.
 */
export const NOT_LOUISIANA_BUSINESS = /^(muck ?boot|xtratuf)/i;
/**
 * What a guide may hold (design audit r2 #5, lead 11-18): the Experiences guides hold experiences (tours, tickets,
 * classes, gift cards for them), Gift Cards only gift cards (no free trial or membership), and no knife sits in a
 * general guide (only the kitchen and chef guides and store pages). A pick that does not fit is left out of that guide.
 */
export const EXPERIENCE = /\b(tours?|tickets?|experiences?|class(es)?|workshops?|lessons?|gift ?cards?|e-?gift|gift certificates?|admissions?|passes|pass|cruises?|getaways?|vouchers?|escape rooms?|spa days?)\b/i;
export const GIFT_CARD = /\b(gift ?cards?|e-?gift ?cards?|gift certificates?|gift codes?)\b/i;
export const NOT_A_GIFT = /\b(free trial|try [\w ]*free|membership)\b/i;
export const EXPERIENCE_GUIDES = ["louisiana-restaurants", "swamp-and-bayou-tours", "spa-days", "date-night", "concerts-and-events", "classes-and-workshops", "family-fun-days"];
export const KNIFE_OK_GUIDES = ["louisiana-kitchen", "home-cook", "cooks-and-kitchen-staff", "chefs"];
/** Names a web page gives itself: bot walls, error pages, sale banners, store titles, a bare number. */
export const PAGE_TITLE_NAME = /^(client challenge|limited time( offer)?|access denied|just a moment\.*|attention required!?|forbidden|sites-[\w-]+|gifts? shop|\d+)$|official store|something went wrong|country selector|page unavailable/i;
/** Picks that landed in the wrong guide (design lead 11-18 PM): a curling iron in Him, a dumbbell stand in Home Cook, a tea club in Dad. */
/** Subscriptions holds gifts, not free trials or planners (owner 11-18 PM: "Try Prime free", "Audible free trial", the 12-Month Academic Planner off it). */
export const WRONG_GUIDE = { him: /curling iron|hair crimper/i, "home-cook": /dumbbell/i, subscriptions: /free trial|\btry\b.*\bfree\b|\bplanner\b/i, dad: /tea club gift subscription/i };
export const FACE_MASK_OFF = ["home-cook", "baker", "dad", "him", "diyer", "electricians", "mechanics", "construction-workers"];
/**
 * PET GUIDES ARE FOR THE PET (owner 11-18 night: "in the pet lover section you have fishing pliers and fish fillet but
 * it's for a pet lover for a fish"). Fish Lover sits in Pets: it holds aquarium and pet-fish gifts only, never angling
 * gear or food; Bird Lover holds pet-bird gifts, never hunting gear.
 */
export const ANGLING = /\b(fishing|angl(er|ers|ing)|pliers|fillet|lures?|rods?|reels?|tackle|waders?|bait|hooks?|lip grip(per)?|fish fry|breading|seasoning|kicker|flies)\b/i;
export const AQUARIUM = /\b(aquariums?|betta|fish ?tanks?|fish ?bowls?|fish food|goldfish|koi|aquascap\w*|aquatic plants?|water test kit)\b/i;
export const PET_ONLY = {
  "fish-lover": (p) => AQUARIUM.test(p.name) && !ANGLING.test(p.name) && !/\b(marine biologist|crunchlabs)\b/i.test(`${p.name} ${p.brand ?? ""}`),
  "bird-lover": (p) => !/\b(hunting|decoys?|duck call|shotgun|blind)\b/i.test(p.name),
};
export const fitsGuide = (slug, p) => {
  if (slug.startsWith("store-")) return true;
  if (PET_ONLY[slug] && !PET_ONLY[slug](p)) return false;
  if (WRONG_GUIDE[slug]?.test(p.name)) return false;
  // A beauty mask is no gift for the kitchen or a trade (its source listed every SharkNinja guide).
  if (/\bface mask\b/i.test(p.name) && FACE_MASK_OFF.includes(slug)) return false;
  if (/\bkni(fe|ves)\b/i.test(p.name) && !KNIFE_OK_GUIDES.includes(slug)) return false;
  if (slug === "gift-cards") return GIFT_CARD.test(p.name) && !NOT_A_GIFT.test(p.name);
  if (EXPERIENCE_GUIDES.includes(slug)) return EXPERIENCE.test(p.name) && !NOT_A_GIFT.test(p.name);
  return true;
};

/**
 * A shop listing's SEO title trimmed to a product name (live audit r3 #3: the 140-character Ninja CREAMi title):
 * "BRAND | Product" -> "Product"; a trailing "Holiday And Christmas Gift…", "Gift for Boys & Girls…" or "Stocking
 * Stuffers…" goes; a name still over NAME_MAX is cut at its last ", " or " - " before NAME_MAX, else at a ":", " with " or " for ".
 */
export const NAME_MAX = 70;
export function tidyName(name) {
  let n = String(name ?? "").replace(/\s+/g, " ").trim().replace(/\s*-:\s*No Added Msg\s*$/i, "").replace(/\s+[-–]\s*$/, "").trim();
  const piped = /^[A-Z0-9 .&'’-]{2,40} \| (.+)$/.exec(n);
  if (piped) n = piped[1].trim();
  n = n.replace(/\s*[-,–]\s*(holiday and christmas gifts?|christmas gifts?|gifts? for (kids|boys|girls|men|women|him|her)|stocking stuffers?)\b.*$/i, "").trim();
  if (n.length <= NAME_MAX) return n;
  // A list break first, then a "for" / "with" / ":" clause.
  for (const sep of [/, | - /g, /: | with | for /gi]) {
    const cuts = [...n.matchAll(sep)].map((m) => m.index).filter((i) => i >= 12 && i <= NAME_MAX);
    if (cuts.length) return n.slice(0, cuts[cuts.length - 1]).trim();
  }
  return n;
}

/**
 * LOUISIANA ONLY IN LOUISIANA (owner rule 11-18 PM, fit audit _fit-audit-1118): a Louisiana-based item (a Louisiana
 * shop's or 25 Days sponsor's link, a Louisiana brand, or a Louisiana-themed name) shows only in the Louisiana section.
 * XTRATUF, Muck Boot and Bayou Classic are national brands. `laHosts` are the Louisiana shop and sponsor hosts.
 */
export const LOUISIANA_BRANDS = ["Dirty Coast", "Fleurty Girl", "Café Du Monde", "Cafe Du Monde", "Tony Chachere's", "Community Coffee", "NOLA Couture",
  "Aunt Sally's", "KREWE", "Leah's Pralines", "Southern Marsh", "Slap Ya Mama", "Zatarain's", "Joe Gambino's Bakery", "Cajun Power", "Savoie's",
  "Zapp's", "Magic Seasoning Blends", "French Market", "French Market Coffee", "TABASCO", "Camellia Brand", "Camellia", "Steen's", "Kary's", "Abita",
  "Crystal", "Blue Plate", "Louisiana Fish Fry", "Bruce's", "French Truck Coffee", "Red Stick Spice Company", "Red Stick Spice", "Panola Pepper Co.",
  "Poche's", "Randazzo King Cake", "Southern Candymakers", "Julie Vos", "Mam Papaul's", "Crew Dog", "Junior League of Baton Rouge",
  "Junior League of Lafayette", "Rebecca Illustrated", "Isaac Toups", "Ella Brennan", "John Folse", "Cajun Grocer", "Cajun Country", "Dupuy's",
  "Rip Van Winkle Gardens", "Justin Wilson", "Melissa M. Martin", "Jean-Paul Bourgeois", "Zydeco Chop Chop", "Paul Prudhomme", "Konriko"];
export const LOUISIANA_THEME = /\b(louisiana|new orleans|nola|cajun|creole|lsu|mardi gras|king cakes?|crawfish|acadiana|baton rouge|lafayette|saints|pelicans|pralines?|beignets?|roux|gumbo|jambalaya|boudin|zydeco|fleur[- ]de[- ]lis|bayou|chicory|tabasco|zatarain'?s)\b/i;
export const NATIONAL_BRANDS = /^(xtratuf|muck boot|bayou classic)/i;
const squashName = (x) => String(x ?? "").normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const LA_BRAND_KEYS = new Set(LOUISIANA_BRANDS.map(squashName));
export const isLouisianaItem = (p, laHosts) => {
  if (NATIONAL_BRANDS.test(p.brand ?? "")) return false;
  let host = "";
  try { host = new URL(p.href).hostname; } catch { /* not a link: decided by brand and name */ }
  return laHosts.has(host) || LA_BRAND_KEYS.has(squashName(p.brand)) || LOUISIANA_THEME.test(p.name ?? "");
};

/** Image formats some browsers cannot show (holistic review 11-18 L5: AVIF Bose, HEIF/HEIC ShopMy): dropped like a broken photo. */
export const NO_SHOW_FORMAT = /\.(avif|heif|heic)(\?|$)|[?&](fmt|format)=avif\b/i;
/**
 * HOLISTIC FIT (design review 11-18 H2/H3, ~/.lh-shots/design-audit-loop/gg-holistic-1118/FINDINGS.md):
 * - NOT_A_GIFT_ITEM: medical and personal-care items are no gift (period products, acne and drying lotions, Aquaphor,
 *   a breast pump, accessible "Enable" shampoo, net bath sponges, incontinence and nipple care). A breast pump and
 *   nipple care stay on New Mom only.
 * - PET_ITEM: pet supplies show only in the Pets guides (and Vets), never in people or budget guides.
 * - WORK_BOOT: no work or chore boots on Mom, Her or Wife.
 * - mensItem: no men's items on the WOMEN_GUIDES.
 * - placeholderName: a name that is a category, not a product ("All Blenders", "Sterling Silver Rings", "Trail
 *   Camera", "Outerwear"): "All <plural>", or no brand with at most three words and no model number.
 * - collectionLink: a link to a collection or shop page, not a product (shopmy.us/collections, /collections/, /shop).
 */
export const NOT_A_GIFT_ITEM = /\b(period (underwear|bikini|panty|panties|pouch|briefs?)|menstrual|tampons?|maxi pads?|panty liners?|acne|pimple|drying lotion|aquaphor|breast ?pump|nipple|lanolin|enable shampoo|accessible shampoo|net (bath )?sponges?|bath net|incontinence|hemorrhoid|diaper rash|stool softener|laxative)\b/i;
export const NEW_MOM_CARE = /\b(breast ?pump|nipple|lanolin)\b/i;
export const PET_ITEM = /\b(catnip|litter ?(box|robot)?|barkbox|meowbox|kitty kick|cat (tree|toys?|bed|harness|brush|scratcher|treats?|window|hammock|fountain|food)|dog (macarons?|treats?|toys?|bed|bowl|harness|leash|collar|brush|food|stocking|paw cleaner|puzzle)|pet (fountain|carrier|bed|hair|camera|treats?|toys?)|chew toys?|dental (dog|chews?))\b|\bfor (dogs|cats)\b/i;
/**
 * Men's items stay off the women's guides, at any position (batch 11-19: Her listed Huk shirts and a men's Sperry boat
 * shoe). A pick is men's when its name says so ("Men's", "Mens", "for Men", "Boys'"), when it is Huk apparel with no
 * women's word (Huk's H1... styles are its men's line), or when it is a Sperry shoe whose photo carries Sperry's men's
 * style code (_mm_ / _ms_; its women's photos carry _wm_).
 */
/**
 * US stores only (batch 11-19, FB comment checks: Her's Rare Beauty blush pin opened spacenk.com/uk and a LANEIGE
 * pin sephora.co.uk). nonUsUrl reads a store URL, domain or store name: a UK, Australian or Canadian site (.co.uk,
 * .com.au, .ca, a /uk/, /en-gb/, /en-au/ or /en-ca/ path, "spacenk.com/uk").
 */
export const nonUsUrl = (s) => {
  const t = String(s ?? "").trim();
  return /(\.co\.uk|\.com\.au|\.ca)(\/|\?|#|$)|\/(uk|gb|en-gb|en-au|en-ca)(\/|$)|\.uk$/i.test(t)
    // Links audit r3 (11-19): every Selfridges pin opened selfridges.com/GB (the UK site); only its /US/ store is US.
    || (/selfridges/i.test(t) && !/selfridges\.com\/US\//.test(t))
    // ... and FWRD pins forced the price into euros or pounds (?currency=GBP, tCurrency=EUR, tCountryCode=GB).
    || CURRENCY_FORCED.test(t);
};
/** A link that forces a non-US currency or country (links audit r3: FWRD ?currency=GBP&tCountryCode=GB, tCurrency=EUR). */
export const CURRENCY_FORCED = /[?&](t?currency|curr)=(?!usd\b)[a-z]{3}\b|[?&]t?countrycode=(?!us\b)[a-z]{2}\b/i;
/** No Instax camera on the men's family guides, at any position (owner 11-19: "Why would a dad want an instax"). */
export const INSTAX_OFF = ["dad", "him", "boyfriend-or-husband", "grandpa", "father-in-law"];
export const instaxItem = (p) => /\binstax\b/i.test(`${p.name ?? ""} ${p.brand ?? ""}`);
export const WOMEN_GUIDES = ["her", "mom", "wife", "girlfriend", "sister", "aunt", "grandma"];
export const mensItem = (p) => {
  const name = String(p.name ?? "");
  if (/\b(men'?s|mens|for men|boys'?)\b/i.test(name)) return true;
  if (/\b(women'?s|womens|ladies)\b/i.test(name)) return false;
  if (/^huk$/i.test(String(p.brand ?? "").trim())) return true;
  return /\bsperry\b/i.test(`${p.brand ?? ""} ${name}`) && /_m[ms]_/i.test(String(p.image ?? ""));
};
export const WORK_BOOT_OFF = ["mom", "her", "wife"];
export const WORK_BOOT = /\b(work boots?|chore (boots?|classic)|steel toe|muckster|wetland boot)\b|^muck boot$/i;
/** Category names the review found standing in for a product (11-18 H3). */
export const CATEGORY_PLACEHOLDER = /^((sterling )?silver|gemstone|gold|diamond|pearl|sterling silver)\s+(rings|earrings|necklaces|bracelets|pendants|charms)$|^(outerwear|trail cameras?|solid original|jewelry|accessories|clothing|shoes)$/i;
export const placeholderName = (p) => /^All\s+(\w+\s){0,2}\w+s$/.test(String(p.name ?? "").trim()) || CATEGORY_PLACEHOLDER.test(String(p.name ?? "").trim())
  || (!String(p.brand ?? "").trim() && /^[A-Za-z&'’]+(\s[A-Za-z&'’]+){0,2}$/.test(String(p.name ?? "").trim()) && !/gift|card|code|subscription|membership/i.test(p.name));
export const collectionLink = (href) => {
  try {
    const u = new URL(href);
    return /\/collections\//i.test(u.pathname) || /\/shop\/?$/i.test(u.pathname);
  } catch { return true; }
};

/**
 * ITEMS THAT BELONG (owner 11-19: "some of them really don't belong at all"; fit beats count, she would rather a guide
 * have 18 great items than 25 with filler, 2026-11-19). Fit audit round 2 (_fit-audit-r2-A/B-1118.json) found the same misfits
 * pasted across many guides; these rules keep them out for good, on top of the audits' per-item lists.
 * - FILLER_BLOCK: the generic filler block (Kindle, AirPods, Apple Watch, CREAMi, UGG, Theragun) stays out of the
 *   career, hobby and color guides and Purple & Gold, except where FILLER_OK names it as the guide's own gift (a Kindle
 *   for the Book Lover, AirPods for the Runner) and, in a color guide, a pick whose name says that color.
 * - INSULATED: an insulated tumbler, bottle, travel mug or lunch box (Stanley, Owala and the like) shows in those guides
 *   only in nurse, teacher and shift-worker guides (tumblerGuide; the outdoor hobbies keep a camp bottle), at most
 *   TUMBLER_MAX per guide.
 * - NOWHERE: Bartesian capsules, bundles and advent sets (they need the machine; the machine itself may stay) and Cooking Light (stopped publishing in 2018), in no guide.
 * - PLACEHOLDER_PRODUCT: a store's error or category page standing in for a product ("Generic Error", "Gift Ideas").
 * - E_GIFT: an eGift card only in Gift Cards and the experience guides, never in a product spot.
 * - ANGLING stays out of Boater and Kayaker (fishing gear belongs in Fishermen); a toy grill out of Girls and Niece.
 */
export const FILLER_BLOCK = /\b(kindle|airpods|apple watch|creami|ugg|theragun)\b/i;
export const INSULATED = /\b(tumblers?|quencher|freesip|iceflow|smoothsip|rambler|water bottles?|vacuum bottles?|insulated (bottles?|mugs?|cups?)|lunch ?(box|boxes|bags?)|travel mugs?|camp mugs?|legendary bottle|stay-hot)\b/i;
export const TUMBLER_MAX = 3;
const NURSE_OR_HEALTH = /nurse|^(rns|lpns|cnas|crnas|doctors|surgeons|healthcare|healthcare-workers|medical-assistants|physician-assistants|pharmacists|pharmacy-techs|respiratory-therapists|radiology-techs|lab-techs-phlebotomists|caregivers|nursing-home-staff|med-students|nursing-students|paramedics-and-emts|hospital-front-desk)$/;
const TEACHER = /teacher|^(educators|paraprofessionals|principals-and-school-staff|professors|coaches)$/;
const SHIFT = /^(first-responders|police-officers|firefighters|sheriffs-deputies|911-dispatchers|military|army|navy|air-force|marines|national-guard|coast-guard|veterans|oilfield-and-trades|offshore-workers|oilfield-workers|refinery-and-plant-workers|pipeline-workers|welders|pipefitters|linemen|electricians|plumbers|hvac-techs|mechanics|heavy-equipment-operators|crane-operators|construction-workers|truck-drivers|bus-drivers|delivery-drivers|boat-captains-and-deckhands|commercial-fishermen-and-shrimpers|machinists|farmers)$/;
const OUTDOOR_HOBBY = /^(camper|mountain-lover|hunters|fishermen|boater|outdoorsman)$/;
export const tumblerGuide = (slug) => NURSE_OR_HEALTH.test(slug) || TEACHER.test(slug) || SHIFT.test(slug) || OUTDOOR_HOBBY.test(slug);
export const FILLER_OK = {
  "book-lover": /kindle/i, homebody: /kindle|ugg/i, traveler: /kindle|airpods/i, "music-lover": /airpods/i,
  runner: /airpods|apple watch|theragun/i, "gym-lover": /airpods|apple watch|theragun/i, "self-care-lover": /theragun/i,
  "physical-therapists": /theragun/i, "occupational-therapists": /theragun/i, entertainer: /creami/i, "wine-lover": /wine tumbler/i,
};
export const GUIDE_COLOR = {
  "purple-lover": /purple|lavender|lilac|violet|plum/i, "green-lover": /green|sage|olive|mint|emerald|forest/i, "red-lover": /\bred\b|cherry|crimson|scarlet|burgundy/i,
  "yellow-lover": /yellow|lemon|sunflower|mustard|golden/i, "pink-lover": /pink|rose|blush|hibiscus|magenta/i, "blue-lover": /blue|navy|denim|cobalt|teal/i,
  "black-lover": /black|onyx|\bjet\b|very very dark|midnight/i, "neutral-lover": /white|cream|beige|ivory|\btan\b|taupe|\boat|sand|clay|neutral|natural|grey|gray|stone/i,
  "purple-and-gold-lover": /\blsu\b|tigers|purple|gold/i,
};
export const NOWHERE = /\bbartesian\b.*\b(capsules?|pods?|advent|bundles?|sampler|refresher|variety pack)\b|\b(capsules?|pods?|advent|bundles?|sampler|refresher|variety pack)\b.*\bbartesian\b|\bcooking light\b/i;
export const PLACEHOLDER_PRODUCT = /^(generic error|gift ideas|error|page not found)$/i;
export const E_GIFT = /\be-?gift ?cards?\b|\begift\b/i;
export const TOY_GRILL = /\b(toy|play|gourmet) grill\b|\bgrill (play ?set|toy)\b/i;
/** Guides the filler and tumbler rules read: career, hobby and color guides, and Purple & Gold. */
export const fillerGuide = (slug, group) => ["By career", "Hobbies", "Colors"].includes(group) || slug === "purple-and-gold-lover";
/**
 * Why a pick does not belong on this page ("" when it does). `group` is the guide's index group; `researched` is true
 * for a guide's own researched fill row (career/hobby/LSU fills), which the filler and tumbler-place rules do not read
 * (the research picked it for that guide; the cap still counts it); `seen.tumblers` is the caller's running count.
 */
export const belongsWhy = (slug, group, p, seen = { tumblers: 0 }, researched = false) => {
  const name = String(p.name ?? "");
  const text = `${name} ${p.brand ?? ""}`;
  if (NOWHERE.test(text)) return "bartesian or cooking light";
  if (PLACEHOLDER_PRODUCT.test(name.trim())) return "placeholder";
  if (E_GIFT.test(name) && slug !== "gift-cards" && !EXPERIENCE_GUIDES.includes(slug)) return "egift card";
  if ((slug === "boater" || slug === "kayaker") && ANGLING.test(name)) return "fishing gear";
  if ((slug.startsWith("girls") || slug === "niece") && TOY_GRILL.test(name)) return "toy grill";
  if (slug.startsWith("store-") || !fillerGuide(slug, group)) return "";
  const color = Boolean(GUIDE_COLOR[slug]?.test(name));
  if (INSULATED.test(name) && !FILLER_OK[slug]?.test(name)) {
    if (!researched && !color && !tumblerGuide(slug)) return "tumbler outside nurse/teacher/shift guides";
    if (seen.tumblers >= TUMBLER_MAX) return "tumbler cap";
    seen.tumblers += 1;
    return "";
  }
  if (!researched && FILLER_BLOCK.test(text) && !FILLER_OK[slug]?.test(text) && !color) return "filler block";
  return "";
};
/**
 * Gift Wrap & Cards holds wrap, cards, gift bags, tags, ribbon and tissue only (owner 11-19), never a gift card.
 * Mail Carrier & Delivery Drivers holds gifts of MAIL_CARRIER_MAX dollars or less (USPS gift rule): a pick with no
 * known price stays out.
 */
export const WRAP_ITEM = /\b(wrap(ping)?|gift wrap|cards?|greeting|notecards?|gift bags?|bags?|tags?|ribbons?|bows?|tissue|gift box(es)?|twine|washi|stickers?|envelopes?)\b/i;
export const wrapItem = (p) => WRAP_ITEM.test(p.name ?? "") && !GIFT_CARD.test(p.name ?? "");
export const MAIL_CARRIER = "mail-carrier-and-delivery-drivers";
export const MAIL_CARRIER_MAX = 20;
/**
 * Louisiana words on a national item's line (audit A line fixes; owner rule: Louisiana items only in the Louisiana
 * section): the item stays, its line is rewritten. LINE_FIXES are the rewrites; a line that still names Louisiana after
 * them is dropped (the row shows no line).
 */
export const LINE_FIXES = [
  [/every South Louisiana man wears from the boat launch to the crawfish boil/i, "that goes from the boat launch to the backyard"],
  [/bright Louisiana days/i, "bright, sunny days"], [/The gumbo pot they'll pass down\./i, "The Dutch oven they'll pass down."],
  [/so the kids can match Daddy at the crawfish boil/i, "for puddles, boat days and muddy yards"], [/For BYOB crawfish boils\./i, "For BYOB dinners and picnics."],
  [/cold duck blinds and football games/i, "cold mornings and football games"], [/cold, wet duck blinds/i, "cold, wet mornings in the field"],
  [/for red beans Mondays/i, "for slow Sunday suppers"], [/for bourr[ée] night/i, "for card night"], [/the deer stand or duck blind/i, "the deer stand or the field"],
  [/ or a muddy Mardi Gras parade/i, " or a muddy festival"], [/Louisiana included/i, "all 50 included"], [/soggy Louisiana ground/i, "soggy ground"],
  [/ready for gumbo night/i, "ready for soup night"], [/tailgates, crawfish boils and ball games/i, "tailgates, backyard parties and ball games"],
  [/brunch or Mardi Gras season/i, "brunch or a night out"], [/tames Louisiana humidity frizz/i, "tames humid-day frizz"],
  [/sized right for a Louisiana winter/i, "sized right for a mild winter"], [/and Mardi Gras parade spots/i, "and parade spots"],
  [/Louisiana downpours/i, "sudden downpours"], [/galas and Mardi Gras balls/i, "galas and holiday parties"], [/^For gumbo and red beans\.$/i, "For soups, stews and beans."],
  [/for gumbo and red beans/i, "for soups, stews and chili"], [/Louisiana water hazards/i, "water hazards"], [/Cajun-injected turkey and pork/i, "juicy injected turkey and pork"],
  [/shrimp, crab and crawfish boils/i, "shrimp and crab boils"], [/a fun pick for a Louisiana baby/i, "a fun pick for a little angler"],
  [/at parades and the zoo/i, "at the fair and the zoo"], [/for gumbo and jambalaya/i, "for soups and stews"], [/Louisiana pop-up showers/i, "pop-up showers"],
  [/bayou and offshore trips/i, "inshore and offshore trips"], [/first pot of gumbo/i, "first pot of soup"], [/even beignet dough/i, "even biscuit dough"],
  [/to pair with the crawfish/i, "for the seafood lover"], [/for duck blinds, deer camp and muddy boat launches/i, "for deer camp and muddy boat launches"],
  [/muddy yards, porches and crawfish boils/i, "muddy yards, porches and cookouts"],
];
export const LA_LINE = new RegExp(`${LOUISIANA_THEME.source}|\\b(bourr[ée]|duck blinds?|red beans)\\b`, "i");
export const neutralLine = (line) => {
  let out = String(line ?? "");
  for (const [re, to] of LINE_FIXES) out = out.replace(re, to);
  return LA_LINE.test(out) ? "" : out;
};

/**
 * LINKS AUDIT R3 (design-audit-loop/gg-r3-links, 2026-11-19 4:13 AM; lead 11-19): every link below was checked live and
 * is dead (404/410), sold out (Shopify product JSON available=false on every variant, or schema.org OutOfStock), on a
 * UK/EU store, on the wrong page (a homepage, a collection, a password wall or another product), or a deal that opens
 * only the store's homepage. A pick or deal on one of these links never shows again, whatever file brings it back
 * (bannedLink, read by scripts/gift-guide-picks.mjs on every pick, deal and deal item). Where our data has the same
 * product on another good link, the page shows that one (BANNED_TWIN in the import); otherwise the pick is removed
 * (owner: fit beats count). Keyed by the exact link the page carries (a ShopMy or Mavely short link hides the store URL).
 */
export const BANNED_LINKS = new Map([
  // dead (17)
  ["https://click.linksynergy.com/deeplink?id=pqYaS88pNmA&mid=53160&murl=https%3A%2F%2Fmomcozy.com%2Fproducts%2Fmomcozy-5-5-full-hd-video-baby-monitor-bm03", "dead"], // Momcozy 5.5-inch Full HD Video Baby Monitor (BM03)
  ["https://go.shopmy.us/p-104237971", "dead"], // Make Clay Charms (Klutz)
  ["https://go.shopmy.us/p-104189704", "dead"], // The Book Of Paper Airplanes Craft Kit (Klutz)
  ["https://go.shopmy.us/p-103894821", "dead"], // A Kick Scooter (Razor)
  ["https://mavely.app.link/fPZoPPZqb8b", "dead"], // Stanley The Quencher® ProTour Flip Straw Tumbler, 40 OZ
  ["https://go.shopmy.us/p-104192042", "dead"], // Butterfly Backpack (Skip Hop)
  ["https://mavely.app.link/0CmO0TyQa8b", "dead"], // DEAL: Up To 30% Off Toys
  ["https://go.shopmy.us/p-104126169", "dead"], // Classic Fleece Heated Blanket (Premier Comfort)
  ["https://go.shopmy.us/p-104125980", "dead"], // Charley Harper - Monteverde Jigsaw Puzzle- 1000 Pieces (Pomegranate Co
  ["https://go.shopmy.us/p-107554032", "dead"], // Shark SpeedStyle Hair Dryer for Curly & Coily Hair (SharkNinja)
  ["https://go.shopmy.us/p-104189003", "dead"], // Plush Floral Bugs Assortment, 5" (Squishmallows)
  ["https://go.shopmy.us/p-104237165", "dead"], // Easel Paper Roll Bundle (Melissa And Doug)
  ["https://go.shopmy.us/p-104188321", "dead"], // Powera Wired Controller For Nintendo Switch (Bolt Axtion)
  ["https://go.shopmy.us/p-104190488", "dead"], // Poke-A-Dot (Melissa And Doug)
  ["https://go.shopmy.us/p-107556399", "dead"], // Charter Club Cashmere-Lined Leather Tech Gloves (Macy's)
  ["https://go.shopmy.us/p-107556990", "dead"], // Club Room Men's Pajama Set (Macy's)
  ["https://go.shopmy.us/p-107552032", "dead"], // Crocs Classic Clog (Macy's)
  // sold out (66)
  ["https://nolacouture.com/products/crawfish-boil-tie", "sold out"], // Gulf Blue Crawfish Boil Tie (NOLA Couture)
  ["https://go.shopmy.us/p-104208114", "sold out"], // The Carry-On Suitcase (Away)
  ["https://mavely.app.link/eqokbAlUa8b", "sold out"], // A.T.A. Bear Mug (Black Rifle Coffee Company)
  ["https://www.anrdoezrs.net/click-101930553-15736401?url=https%3A%2F%2Fwww.durangoboots.com%2Fproducts%2Fdbt0241c", "sold out"], // Lil' Rebel Pro Little Kids' Western Boot (Durango Boots)
  ["https://www.awin1.com/cread.php?awinmid=78080&awinaffid=3158016&ued=https%3A%2F%2Fimarku.net%2Fproducts%2F5qt-blue-enameled-pot-cast-iron-dutch-oven-with-lid", "sold out"], // 5-Qt Enameled Cast Iron Dutch Oven (Imarku)
  ["https://mavely.app.link/efXtXkiOa8b", "sold out"], // Stay-Hot Stacking Cups Gift Set, 10 OZ (Stanley 1913)
  ["https://go.shopmy.us/p-103878354", "sold out"], // Mini Pedestal Candles (Voluspa)
  ["https://www.awin1.com/cread.php?awinmid=122866&awinaffid=3158016&ued=https%3A%2F%2Ftruebeautylashes.com%2Fproducts%2F2-in-1-magnetic-liquid-eyeliner", "sold out"], // 2-in-1 Magnetic Liquid Eyeliner (True Beauty Lashes)
  ["https://mavely.app.link/xAY4WqlUa8b", "sold out"], // 3 Rounds Logo T-Shirt (Black Rifle Coffee Company)
  ["https://go.shopmy.us/p-104229420", "sold out"], // Yeti Rambler 20 Tahoe Blue (St. Bernard)
  ["https://go.shopmy.us/p-104229995", "sold out"], // Men's Dark Navy Cashmere Sweater (Shop The Sample)
  ["https://go.shopmy.us/p-104212907", "sold out"], // Fourth Wing Book Tin (Maisonette)
  ["https://go.shopmy.us/p-103885063", "sold out"], // Daytrip Lunch Bag (Yeti)
  ["https://go.shopmy.us/p-103881623", "sold out"], // Go 4 Bluetooth Wireless Speaker (Jbl)
  ["https://go.shopmy.us/p-104058983", "sold out"], // Safari 25-Piece Set (Magna-Tiles)
  ["https://go.shopmy.us/p-104192136", "sold out"], // Build N Tumble Table (Mega Bloks)
  ["https://go.shopmy.us/p-104124299", "sold out"], // Men's Ryan Leather Wallet (Fossil)
  ["https://go.shopmy.us/p-104123289", "sold out"], // Go Instant Camera Everything Box Bundle With Go Film And Keepsake Kit 
  ["https://go.shopmy.us/p-103902705", "sold out"], // Signature Round Dutch Oven (Le Creuset)
  ["https://go.shopmy.us/p-103881198", "sold out"], // Rambler 14 oz Mug (YETI)
  ["https://mavely.app.link/y9cag3oUa8b", "sold out"], // Kittypin Lanes (meowbox)
  ["https://mavely.app.link/3ftmukkUa8b", "sold out"], // Party Animals Wrapping Paper (Paper Source)
  ["https://go.shopmy.us/p-104061840", "sold out"], // Sophie Conran Galvanized Steel Watering Can (Burgon & Ball)
  ["https://go.shopmy.us/p-107586050", "sold out"], // Wooden Take-Along Sorting Barn (Melissa & Doug)
  ["https://go.shopmy.us/p-104191593", "sold out"], // USA Map Sound Puzzle (Melissa & Doug)
  ["https://go.shopmy.us/p-104191548", "sold out"], // Fisher-Price Little People Ultimate Music Parade Ride-On (Paw Patrol)
  ["https://go.shopmy.us/p-104054483", "sold out"], // Roses Candle - Limited Edition (Diptyque)
  ["https://go.shopmy.us/p-107586297", "sold out"], // Quencher H2.0 FlowState Tumbler, 20 oz (Stanley)
  ["https://go.shopmy.us/p-104125781", "sold out"], // Scuffette II Suede Mule (UGG)
  ["https://go.shopmy.us/p-103878068", "sold out"], // CozyChic 2 Pair Sock Set (Barefoot Dreams)
  ["https://go.shopmy.us/p-104126286", "sold out"], // Candle Snuffer Silver (Diptyque)
  ["https://go.shopmy.us/p-104125842", "sold out"], // Echo Show 5 (3rd Generation) 5.5 Inch Smart Display With Alexa (Amazon
  ["https://go.shopmy.us/p-103882489", "sold out"], // Standard Mouth 24oz Water Bottle (Hydro Flask)
  ["https://go.shopmy.us/p-103899960", "sold out"], // Daytrip Lunch Box (St. Bernard)
  ["https://go.shopmy.us/p-103882647", "sold out"], // Now+ Instant Camera Generation 2 (white) (Polaroid)
  ["https://go.shopmy.us/p-104205992", "sold out"], // Now+ Instant Camera Gen 2 (Polaroid)
  ["https://go.shopmy.us/p-104187149", "sold out"], // Instax Mini Mermaid Tail Film (Fujifilm)
  ["https://go.shopmy.us/p-104218482", "sold out"], // Garden Watering Can (Ten Little)
  ["https://go.shopmy.us/p-104218583", "sold out"], // Seed Starter Kit - Eco Friendly Paper Pulp Plant Pots, Plant Trays (Wi
  ["https://go.shopmy.us/p-104202022", "sold out"], // Resurrection Aromatique Hand Wash (Aesop)
  ["https://go.shopmy.us/p-107574727", "sold out"], // T3 Fit Compact Hair Dryer (Dermstore)
  ["https://go.shopmy.us/p-107577057", "sold out"], // Olaplex No.7 Bonding Hair Oil (Dermstore)
  ["https://go.shopmy.us/p-107565938", "sold out"], // Lilly Pulitzer 2026-2027 17-Month Large Agenda (Lillypulitzer)
  ["https://go.shopmy.us/p-104226913", "sold out"], // Tervis Fishing Cast One More Made In Usa Double Walled Insulated Tumbl
  ["https://go.shopmy.us/p-104189508", "sold out"], // 18 Inch Doll Accessories (The Queen'S Treasures)
  ["https://go.shopmy.us/p-104217357", "sold out"], // 23.8 In. Full HD Led Gaming Lcd Monitor (Asus)
  ["https://go.shopmy.us/p-103894465", "sold out"], // Remote Control Rc Robot Toy Walking Talking Dancing Ai Robots For Kids
  ["https://go.shopmy.us/p-104113024", "sold out"], // Mug 2 (Ember)
  ["https://go.shopmy.us/p-103894278", "sold out"], // Remote Control Monster Truck 1:16 Scale (Trademark Global)
  ["https://go.shopmy.us/p-104217817", "sold out"], // F2 Standard Right Handed Pruning Shears (Felco)
  ["https://go.shopmy.us/p-104190620", "sold out"], // Paper Making Craft Kit (National Geographic)
  ["https://go.shopmy.us/p-104192234", "sold out"], // Fisher-Price Laugh & Learn 3-In-N-The-Go Camper (Fisher Price)
  ["https://go.shopmy.us/p-103878587", "sold out"], // FreeSip Water Bottle (Owala)
  ["https://go.shopmy.us/p-104190400", "sold out"], // Toniebox With Playtime Puppy (Tonies)
  ["https://go.shopmy.us/p-104237882", "sold out"], // Puffy Sticker Bundle (Melissa And Doug)
  ["https://go.shopmy.us/p-107555891", "sold out"], // UGG Tasman II Slippers (Macy's)
  ["https://go.shopmy.us/p-107556560", "sold out"], // Yankee Candle Christmas Cookie Large Two-Wick Tumbler Candle (Macy's)
  ["https://go.shopmy.us/p-107556965", "sold out"], // Fossil Women's Watch Ring, Rose Gold-Tone (Macy's)
  ["https://go.shopmy.us/p-104053506", "sold out"], // Safari 25 Piece Set (Magna-Tiles)
  ["https://go.shopmy.us/p-104223928", "sold out"], // Cat Mom Sweatshirt Greeting Card (Maisonette)
  ["https://go.shopmy.us/p-104225249", "sold out"], // Duck Decoys Key Fob (Smathers & Branson)
  ["https://go.shopmy.us/p-107574300", "sold out"], // Parachute Cloud Cotton Robe (Parachutehome)
  ["https://go.shopmy.us/p-104226040", "sold out"], // Smathers + Branson Fishing Flies Pattern Needlepoint Valet Tray (St. B
  ["https://go.shopmy.us/p-103900423", "sold out"], // Yeti Rambler. Bottle (St. Bernard)
  ["https://go.shopmy.us/p-103905369", "sold out"], // Women's Phd Outdoor Light Pattern Hiking Mid Crew Socks (St. Bernard)
  ["https://go.shopmy.us/p-104200528", "sold out"], // Baltic Amber Candle (Voluspa)
  // non-US (11)
  ["https://go.shopmy.us/p-104220786", "non-US"], // Go Instant Camera (Polaroid)
  ["https://go.shopmy.us/p-104229712", "non-US"], // Birdling Blue Jay Soft Toy (Jellycat)
  ["https://go.shopmy.us/p-104223987", "non-US"], // Amuseable Clementine Plush Toy (Jellycat)
  ["https://go.shopmy.us/p-104121346", "non-US"], // Detroit Jacket (Carhartt Wip)
  ["https://go.shopmy.us/p-104326686", "non-US"], // Sleeping Plush Charmander (Pokémon)
  ["https://go.shopmy.us/p-104112810", "non-US"], // Always Pan (Our Place)
  ["https://go.shopmy.us/p-104325960", "non-US"], // Atmos Vacuum Canister 1.2 L (Fellow)
  ["https://go.shopmy.us/p-104226614", "non-US"], // SoundLink Micro Bluetooth Speaker (Bose)
  ["https://go.shopmy.us/p-104217209", "non-US"], // Dragon-Print Enhanced Switch Controller (Powera)
  ["https://go.shopmy.us/p-104210103", "non-US"], // Switch Oled Console (Nintendo)
  ["https://go.shopmy.us/p-104113249", "non-US"], // Nespresso Vertuo Next Coffee Maker and Espresso Machine
  // wrong page (18)
  ["https://crew-dog.com/", "wrong page"], // Embroidered LSU Crewneck (Crew Dog)
  ["https://click.linksynergy.com/deeplink?id=pqYaS88pNmA&mid=53904&murl=https%3A%2F%2Ftushbaby.com%2F", "wrong page"], // Convertible Carrier (Tushbaby)
  ["https://www.awin1.com/cread.php?awinmid=123126&awinaffid=3158016&ued=https%3A%2F%2Fpiccoload.com%2F", "wrong page"], // Personalized Photo Coloring Book (Piccoload)
  ["https://go.shopmy.us/p-104219112", "wrong page"], // Manta Sleep Mask
  ["https://mavely.app.link/ikiEQfvUa8b", "wrong page"], // Candle Gift Sets, Mini Boxes (Yankee Candle)
  ["https://go.shopmy.us/p-103892650", "wrong page"], // Classic Vacuum Bottle (Stanley)
  ["https://mavely.app.link/kPgEICkUa8b", "wrong page"], // Warmies®, the Original Heatable Weighted Stuffed Animal
  ["https://mavely.app.link/fc0r8T7Qa8b", "wrong page"], // Rosé All Day Petal Glow (Physicians Formula)
  ["https://go.shopmy.us/p-104214954", "wrong page"], // Golf and Tackle Bucket Hat (Malbon Golf)
  ["https://go.shopmy.us/p-104123396", "wrong page"], // Renown Hoodie (Alo Yoga)
  ["https://go.shopmy.us/p-107565455", "wrong page"], // SKIMS Cozy Knit Robe
  ["https://go.shopmy.us/p-107565589", "wrong page"], // SKIMS Soft Lounge Lace Pants
  ["https://go.shopmy.us/p-107566323", "wrong page"], // vineyard vines Sophie Harbor Dress (Vineyard Vines)
  ["https://go.shopmy.us/p-104219076", "wrong page"], // Calpak x Miffy Packing Cubes 5-Piece Set
  ["https://go.shopmy.us/p-104207522", "wrong page"], // Clear Coated Cosmetic Train Case (Mark & Graham)
  ["https://go.shopmy.us/p-104217417", "wrong page"], // Twitch Studded Hoodie (Complex)
  ["https://go.shopmy.us/p-107585054", "wrong page"], // Rest Sound Machine and Night Light, Putty (Hatch)
  ["https://go.shopmy.us/p-107580751", "wrong page"], // Owala FreeSip Stainless Steel Water Bottle, 24oz, Very Very Black
  // homepage deal (32)
  ["https://mavely.app.link/Itbid0NQa8b", "homepage deal"], // DEAL: Big Holiday Sale | 25% OFF SITEWIDE: Whether youre looking for 
  ["https://mavely.app.link/DnUuUHvQa8b", "homepage deal"], // DEAL: Cozy Shop 60% off - Select Outwear, Sweaters, Cold Weather Acces
  ["https://mavely.app.link/aiNFK7pQa8b", "homepage deal"], // DEAL: Cyber Sale: 30% off Sitewide and 50% off Gift Sets
  ["https://mavely.app.link/iD33bE7Qa8b", "homepage deal"], // DEAL: Up to 60% off Select Styles and Colors + Doorbusters
  ["https://mavely.app.link/sbTfAtwQa8b", "homepage deal"], // DEAL: Black Friday Sale - 40% off Sitewide
  ["https://mavely.app.link/5stVldXQa8b", "homepage deal"], // DEAL: Black Friday Early Access - Up to 40% off When Logged in
  ["https://mavely.app.link/fDlJ4BGQa8b", "homepage deal"], // DEAL: Buy One, Get One 50% off
  ["https://mavely.app.link/oOKl8SGQa8b", "homepage deal"], // DEAL: Black Friday Sale: Up to 30% off Select Guitars
  ["https://mavely.app.link/p9QLlepQa8b", "homepage deal"], // DEAL: 50% off Clearance
  ["https://mavely.app.link/SZU4yLqQa8b", "homepage deal"], // DEAL: Early Black Friday Sale
  ["https://mavely.app.link/YNJKmwpQa8b", "homepage deal"], // DEAL: Buy One, Get One 50% off GNC Multivitamins, Vitapaks, and Fish O
  ["https://mavely.app.link/f8fufbrQa8b", "homepage deal"], // DEAL: Early Black Friday: 30% off Sitewide
  ["https://mavely.app.link/6GrzbhFQa8b", "homepage deal"], // DEAL: Early Black Friday: 50% off All PJs + 40% off Everything Else
  ["https://mavely.app.link/BrdKUKDQa8b", "homepage deal"], // DEAL: Up to 65% off Black Friday Deals
  ["https://mavely.app.link/APXFQ3nQa8b", "homepage deal"], // DEAL: Extra 30% off Sale
  ["https://mavely.app.link/moXrCEqQa8b", "homepage deal"], // DEAL: New arrivals just landed!
  ["https://mavely.app.link/9ZWm82JQa8b", "homepage deal"], // DEAL: Lancôme’s Black Friday Early Access is 30% off sitewide.
  ["https://mavely.app.link/1ClZ0uYQa8b", "homepage deal"], // DEAL: Extra 50% off Clearance
  ["https://mavely.app.link/8XtUaQ7Qa8b", "homepage deal"], // DEAL: 30% off Select items
  ["https://mavely.app.link/8ElgTmFQa8b", "homepage deal"], // DEAL: Black Friday Preview: 40% off or More
  ["https://mavely.app.link/u1HobgsQa8b", "homepage deal"], // DEAL: Mega Deals - Score Epic Deals on Holiday Must-haves for Merry Ma
  ["https://mavely.app.link/h0S13msQa8b", "homepage deal"], // DEAL: 20% off Sitewide for Black Friday
  ["https://mavely.app.link/LwjP37nQa8b", "homepage deal"], // DEAL: Black Friday Sale - Take 40% off Caviar
  ["https://mavely.app.link/ByW6S2vQa8b", "homepage deal"], // DEAL: Get Gifting with Our Hottest Holiday Deals
  ["https://mavely.app.link/Ohbs2wCQa8b", "homepage deal"], // DEAL: Black Friday / Cyber Monday - 25% off Sitewide
  ["https://mavely.app.link/jG4oNVnQa8b", "homepage deal"], // DEAL: The Holiday Event - Up to 40% off Everything
  ["https://mavely.app.link/RvjS0xqQa8b", "homepage deal"], // DEAL: Shop Cyber Promo - Take 25% off Sitewide, Plus Create Your Own S
  ["https://mavely.app.link/ncLMv8YQa8b", "homepage deal"], // DEAL: Black Friday Sale: Up to 40% off Comforters, Pillows, & More + U
  ["https://mavely.app.link/3LtypipQa8b", "homepage deal"], // DEAL: Save 50% on Jackets & Outerwear
  ["https://mavely.app.link/EehdqHlQa8b", "homepage deal"], // DEAL: Find Holiday Gifts for Less with 40% off Select Markdown Styles
  ["https://mavely.app.link/oKSAUGrQa8b", "homepage deal"], // DEAL: Buy One, Get One 50% off Sitewide + Extra 30% off Sale
  ["https://go.shopmy.us/p-107279221", "homepage deal"], // DEAL: Holiday Gifts
]);
/** Why a link is banned ("dead", "sold out", "non-US", "wrong page", "homepage deal"), or "". */
export const bannedLink = (href) => BANNED_LINKS.get(String(href ?? "")) ?? "";
/** Affiliate deeplinks that carry the store URL in a query parameter (Rakuten murl, Awin ued, CJ url, Impact u, ShareASale urllink). */
const DEEPLINK_PARAMS = ["murl", "ued", "url", "u", "urllink", "destination"];
/** The store URL a link opens: the deeplink's own target when it carries one, else the link itself. */
export const storeUrlOf = (href) => {
  try {
    const u = new URL(String(href));
    for (const k of DEEPLINK_PARAMS) {
      const v = u.searchParams.get(k);
      if (v && /^https?:\/\//i.test(v)) return new URL(v);
    }
    return u;
  } catch { return null; }
};
/**
 * No homepage-only links on picks (links audit r3: Tushbaby's Convertible Carrier, Piccoload's coloring book and Crew
 * Dog's crewneck opened the store's front page): a pick whose store URL is the site root (or only a locale, "/en-us/")
 * names a store, not an item. A ShopMy or Mavely short link hides its store URL (BANNED_LINKS covers those). The
 * Louisiana businesses and the 25 Days sponsors keep their plain homepage links on purpose (the caller exempts them).
 */
export const homepageLink = (href) => {
  const u = storeUrlOf(href);
  if (!u) return false;
  return /^\/((en|us|en-us|en_us|us\/en|en\/us)\/?)?$/i.test(u.pathname) && !/[?&](variant|sku|pid|product|id)=/i.test(u.search);
};
