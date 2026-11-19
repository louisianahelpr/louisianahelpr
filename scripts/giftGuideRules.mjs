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
  if (decorOff(slug, p) || foodOff(slug, p) || personalGiftOff(slug, p) || magazineOff(slug, p) || sperryOff(slug, p) || lifeIsGoodOff(slug, p) || outdoorDecorOff(slug, p) || resaleOrUkShop(p) || kidsCrocsOff(slug, p) || characterCollab(p) || drugstoreOff(slug, p) || masonOff(slug, p) || redoneOff(slug, p) || lashOff(slug, p) || veraBradleyOff(slug, p) || hikingOff(slug, p) || cheapSockOff(slug, p) || barwareOff(slug, p) || fashionSneakerOff(slug, p) || farmRioOff(slug, p) || legoOff(slug, p) || grandSunglassesOff(slug, p) || frameOff(slug, p) || foodSubOff(slug, p) || iceCreamOff(slug, p) || crockPotOff(slug, p) || blankOrPastelOff(slug, p) || photoProductOff(slug, p) || puzzleOff(slug, p) || groceryCandyOff(slug, p) || jdDrinkwareOff(slug, p)) return false;
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
  "Rip Van Winkle Gardens", "Justin Wilson", "Melissa M. Martin", "Jean-Paul Bourgeois", "Zydeco Chop Chop", "Paul Prudhomme", "Konriko",
  // West Monroe (fit audit r4: North Louisiana's own items).
  "Duck Commander"];
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
/** A Selfridges link on its US store: host selfridges.com (or a subdomain) and a path under /US/. */
const selfridgesUs = (t) => {
  const raw = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  if (!URL.canParse(raw)) return false;
  const u = new URL(raw);
  const h = u.hostname.toLowerCase();
  return (h === "selfridges.com" || h.endsWith(".selfridges.com")) && u.pathname.startsWith("/US/");
};
export const nonUsUrl = (s) => {
  const t = String(s ?? "").trim();
  return /(\.co\.uk|\.com\.au|\.ca)(\/|\?|#|$)|\/(uk|gb|en-gb|en-au|en-ca)(\/|$)|\.uk$/i.test(t)
    // Links audit r3 (11-19): every Selfridges pin opened selfridges.com/GB (the UK site); only its /US/ store is US.
    || (/selfridges/i.test(t) && !selfridgesUs(t))
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
/**
 * Items that do not fit one guide (gift guides r3 audit, 11-19): a Kindle is no New Puppy gift, a ~$45 Stanley
 * Quencher does not fit a stocking, and the Hot Wheels 20-pack is a kids' toy, not a Car Lover gift.
 */
const MENS_GUIDES = ["dad", "him", "boyfriend-or-husband", "grandpa", "father-in-law", "brother", "brother-in-law", "uncle"];
export const GUIDE_OFF = {
  "new-puppy": /\bkindle\b|airpods|\bquencher\b/i,
  "stocking-stuffers": /\bquencher\b|\bgodiva (gold gift box|masterpiece)|\bpajamas?\b|\bowala\b/i,
  "car-lover": /hot wheels/i,
  // Fit audit r3b (11-19): a men's guide holds no bracelet advent calendar, massage chair or unnamed snow-globe ornament.
  ...Object.fromEntries(MENS_GUIDES.map((g) => [g, /\badvent calendar\b.*\bpura vida\b|\bpura vida\b.*\badvent\b|massage chair|snow globe ornament/i])),
  // ... and the coffee guides no sticker pack or can cooler.
  "coffee-lover": /\bsticker pack\b|frost buddy|\bcan (cooler|insulator)\b/i,
  dad: /\badvent calendar\b.*\bpura vida\b|\bpura vida\b.*\badvent\b|massage chair|snow globe ornament|\bsticker pack\b/i,
  hunters: /\bsticker pack\b/i,
  coworkers: /\bsticker pack\b|\bair fryer\b|candy cane ornaments/i,
  "mail-carrier-and-delivery-drivers": /\bthank[- ]you cards?\b/i,
  "girls-teens": /\bdiamond\b|\bcarat\b|under-?eye|\bcorrector\b/i,
  ...Object.fromEntries(["boys", "boys-big-kids", "boys-little-kids", "boys-teens"].map((g) => [g, /hello kitty/i])),
  girls: /\bstanley\b|\biceflow\b/i,
  "girls-big-kids": /\bquencher\b|\bhatch restore\b/i,
  "gender-neutral-big-kids": /\bquencher\b/i,
  "cat-person": /squishmallow/i,
  grandma: /fire department coffee|black rifle|\b144 cups\b/i,
  "white-elephant": /\bember mug\b|\beverywhere belt bag\b|\bbombas\b|\bcozychic\b/i,
};
export const belongsWhy = (slug, group, p, seen = { tumblers: 0 }, researched = false) => {
  const name = String(p.name ?? "");
  const text = `${name} ${p.brand ?? ""}`;
  if (NOWHERE.test(text)) return "bartesian or cooking light";
  if (GUIDE_OFF[slug]?.test(text)) return "does not fit this guide";
  if (EMPTY_PACKAGING.test(name)) return "empty packaging";
  if (slug === "new-puppy") {
    if (!PUPPY_ITEM.test(name)) return "not a puppy item";
    if (OWNER_MERCH.test(name) && (seen.ownerMerch = (seen.ownerMerch ?? 0) + 1) > 1) return "second dog-mom item";
  }
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
  // Lead 11-19: the sold-out Ninja DualZone 8-Qt Later link came back through a curation add; banned for good.
  ["https://mavely.app.link/uv0obAgOa8b", "sold out"],
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
  // Links audit r4 (gg-r4-links, 11-19).
  ["https://go.shopmy.us/p-104112945", "wrong page"], // FreeSip Bottle 24oz (Owala): opens JD Sports' 40 oz bottle (LINK_FIX moves it to Owala's 24 oz pin)
  ["https://go.shopmy.us/p-104209798", "wrong page"], // Delícia Drench Body Butter (Sol de Janeiro): opens Urban Outfitters' 8 oz body cream
  ["https://mavely.app.link/rUbFIqQTa8b", "sold out"], // VAVSEA Cordless Stick Vacuum, 38KPa (Walmart: NOT_AVAILABLE, out of stock)
  ["https://mavely.app.link/7qwASmTTa8b", "sold out"], // FitRx 10 lb Rubber Hex Dumbbells, Pair (Walmart)
  ["https://mavely.app.link/EmDfi5TTa8b", "sold out"], // Bestier Botanical Floral Queen Comforter Set (Walmart)
  ["https://mavely.app.link/67wI8mUTa8b", "sold out"], // Bestier 2-Piece Blue Toddler Comforter Set (Walmart)
  ["https://mavely.app.link/CAOsxnPQa8b", "homepage deal"], // DEAL: Black Friday Public Sale (Funko): opens funko.com's homepage
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

/**
 * FIT AUDIT R3B (2026-11-19, ~/.lh-shots/design-audit-loop/gg-r3-fit; lead's calls on its open questions, 11-19).
 * - brandKey: one brand under its spellings before the brand cap (BRAND_CAP, 3 a guide): "Darn Tough Vermont" is Darn
 *   Tough, "Sperry US" Sperry, "Melissa and Doug" Melissa & Doug, Ninja and Shark one company (SharkNinja). BRAND_NAME
 *   gives the shown name the same spelling.
 * - UTILITY_CARE: utility or medical personal care (Aquaphor, ointments, acne, period products, plain drugstore lip balm,
 *   hand cream packs as filler, sheet masks, shampoo, sunscreen, deodorant, a hair trimmer) is no gift: out of every
 *   guide except New Mom.
 * - BEAUTY_ITEM: giftable beauty (makeup, perfume, LANEIGE, Sol de Janeiro, skincare, gift sets) stays, but only on the
 *   guides it fits (beautyGuide: Her, Mom, Wife, Girlfriend, Sister, Aunt, Grandma, Best Friend, Girls Teens, the budget
 *   guides, Stocking Stuffers, Self-Care and the beauty careers), and one beauty product on at most BEAUTY_GUIDE_MAX guides.
 * - ONCE_PER_GUIDE: near-twins a guide lists once (the 1.5 qt Legendary bottle under two names, two 8-qt DualZone air
 *   fryers, two LED face masks, the same Literie scent as a candle and a little candle, two Water Wow sets, the 2-Eye
 *   boat shoe twice).
 * - NEUTRAL_GUIDES drop women's- and men's-only items (Cousins, Coworkers, Secret Santa, White Elephant, Gender-Neutral
 *   Teens); empty gift baskets are no gift anywhere; XTRATUF deck boots are work boots (out of Mom, Her and Wife).
 * - NEW PUPPY (r3 follow-up: the backfill put a Stanley Quencher in it): only puppy, dog and new-pet-owner items, and
 *   at most one "dog mom" owner item.
 */
export const BRAND_ALIASES = { darntoughvermont: "darntough", sperryus: "sperry", sperrytopsider: "sperry", melissadoug: "melissaanddoug", ninja: "sharkninja", shark: "sharkninja", sharkbeauty: "sharkninja", stanley1913: "stanley" };
export const brandKey = (brand) => {
  const c = compact(brand);
  return BRAND_ALIASES[c] ?? c;
};
export const BRAND_NAME = { darntoughvermont: "Darn Tough", sperryus: "Sperry", melissaanddoug: "Melissa & Doug", melissadoug: "Melissa & Doug" };
/** Brands a Walmart research row leaves blank, read off the front of its name (Mail Carrier fill, fit audit r3b). */
export const NAME_BRANDS = ["Burt's Bees", "Jolly Rancher", "Ozark Trail", "Frito-Lay", "HotHands", "Ghirardelli", "Hallmark", "BUTKLNYTS", "Dalrosia", "KOITHOT", "NevEND", "George", "HOTOR", "OZERO", "Zacro", "totes", "onn.", "RTIC", "TAL"];
export const brandFromName = (name) => NAME_BRANDS.find((b) => String(name ?? "").startsWith(`${b} `)) ?? "";
const PLAIN_LIP_BRAND = /\b(eos|burt'?s bees|chapstick|carmex|vaseline|jolly rancher|blistex|nivea|vitamasques|aquaphor)\b/i;
const GIFT_HAND_CREAM = /l'?occitane|sol de janeiro|brazilian touch|aesop|crabtree|jo malone|kiehl/i;
export const UTILITY_CARE = /\b(aquaphor|ointments?|acne|pimples?|period (underwear|bikini|panty|panties|pouch)|menstrual|tampons?|maxi pads?|panty liners?|sheet masks?|shampoo|conditioner|sunscreen|spf ?\d+|deodorant|trimmer)\b/i;
export const utilityCare = (p) => {
  const text = `${p.name ?? ""} ${p.brand ?? ""}`;
  if (UTILITY_CARE.test(text) || /^eos$/i.test(String(p.brand ?? "").trim())) return true;
  if (/\blip\b/i.test(p.name ?? "") && PLAIN_LIP_BRAND.test(text)) return true;
  if (/\be\.?l\.?f\.?\b/i.test(text) && /\blip balm\b/i.test(p.name ?? "")) return true;
  return /\bhand (cream|balm|lotion)s?\b/i.test(p.name ?? "") && !GIFT_HAND_CREAM.test(text);
};
export const BEAUTY_ITEM = /\b(lip (sleeping )?mask|lip (oil|gloss|serum|tint|butter|glaze|balm|treatment|liner|stain|plumper|shimmer)s?|lipsticks?|mascara|bronzer|eyeshadow|eye ?liner|concealer|undereye|corrector|makeup|perfume|eau de (parfum|toilette)|body mist|fragrance mist|perfume mist|serums?|moisturi[sz]er|eye cream|face cream|skin cream|night cream|lotion\+|cleanser|exfoliat\w*|face scrub|sleeping mask|bum bum|body butter|body cream|hand (cream|balm)|hair oil|hair milk|dew drops|nail polish|bath bombs?|skin ?care)\b/i;
export const BEAUTY_BRAND = /\b(laneige|sol de janeiro|cheirosa|glow recipe|mario badescu|clinique|tatcha|summer fridays|glossier|rare beauty|charlotte tilbury|e\.l\.f\.|maybelline|tarte|mac cosmetics|fenty|drunk elephant|bubble skincare|kiehl'?s)\b/i;
export const beautyItem = (p) => BEAUTY_ITEM.test(p.name ?? "") || HAIR_BEAUTY.test(p.name ?? "") || BEAUTY_BRAND.test(`${p.name ?? ""} ${p.brand ?? ""}`);
export const BEAUTY_GUIDES = ["her", "mom", "wife", "girlfriend", "sister", "aunt", "grandma", "best-friend", "girls-teens", "stocking-stuffers", "self-care-lover"];
export const BEAUTY_BUDGET = /^(under-\d+|100-and-up)$/;
export const BEAUTY_CAREER = /^(nail-techs|estheticians|cosmetologists|hairstylists|hair-stylists|makeup-artists|salon-owners)$/;
export const beautyGuide = (slug) => slug.startsWith("store-") || BEAUTY_GUIDES.includes(slug) || BEAUTY_BUDGET.test(slug) || BEAUTY_CAREER.test(slug);
/** Beauty guides in the order they keep a capped beauty product (the people guides first, then budget and the rest). */
export const beautyRank = (slug) => (BEAUTY_GUIDES.includes(slug) ? BEAUTY_GUIDES.indexOf(slug) : BEAUTY_BUDGET.test(slug) ? 50 + Number(slug.replace(/\D/g, "") || 999) / 1000 : 100);
export const BEAUTY_GUIDE_MAX = 6;
export const ONCE_PER_GUIDE = [/\blegendary (vacuum )?bottle\b/i, /\bdual ?zone\b.*\bair fryer\b|\bair fryer\b.*\bdual ?zone\b/i,
  /\bled\b.*\b(face )?mask\b/i, /\bafternoon in central park\b.*\bcandle\b/i, /\bweekend in new england\b.*\bcandle\b/i, /\bwater ?wow\b/i, /\b2-eye boat shoe\b/i];
export const onceKey = (p) => ONCE_PER_GUIDE.findIndex((rx) => rx.test(p.name ?? ""));
export const NEUTRAL_GUIDES = ["gender-neutral-teens", "cousins", "coworkers", "secret-santa", "white-elephant"];
export const ONE_GENDER = /\b(women'?s|womens|ladies|men'?s|mens|for (wo)?men)\b/i;
export const EMPTY_PACKAGING = /\bgift baskets?\b.*\b\d+ ?(pack|pcs|count)\b|\bempty gift baskets?\b/i;
export const DECK_BOOT = /\bxtratuf\b|\bdeck boots?\b/i;
export const PUPPY_ITEM = /\b(dogs?|pupp(y|ies)|pups?|pets?|paws?|canine|k-?9|leash(es)?|harness(es)?|collars?|crates?|kennels?|carriers?|chews?|treats?|lick mats?|poop bags?|potty|woof\w*|bark\w*)\b/i;
export const OWNER_MERCH = /\bdog (mom|dad|mama|parent)\b/i;
/**
 * Photos with a seller's badge baked in (gg-r3 UX audit #15: the Kindle Paperwhite photo carries "INSURANCE AVAILABLE"),
 * each with the store's own clean photo (checked by eye 2026-11-19). The clean photo is Amazon's, so it shows only on an
 * Amazon link (Associates rule); on any other link, or with no clean photo (""), the badge photo is dropped. Matched
 * without the query string (TikTok's CDN signs each URL).
 */
export const BADGE_PHOTO_SWAPS = new Map([
  ["https://static.shopmy.us/uploads/b9346480-e5d8-405a-be12-eedecc9dad24_WBG2C_SQ1_0000000004_BLACK_SLf.webp", "https://m.media-amazon.com/images/I/61KMlIaN9pL._AC_SL500_.jpg"],
  // Best Friend's e.l.f. lip oil trio: "TIKTOK SHOP EXCLUSIVE" and "$22 / $27 VALUE" badges, no clean photo of the set
  // (r3 follow-up): no swap, so the photo is dropped and a photo'd pick takes the row.
  ["https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/a1cad1c0a8ae4be69efa19221195a9c4~tplv-fhlh96nyum-crop-webp:800:800.webp", ""],
]);
/**
 * Names and brands the fit audit r3b (Lows) found wrong or unclear, fixed where the shop's own name says what it is: the
 * "Acylic" typo, a men's guide's "for Men for Women" aviators, Maker Wine's canned wine packs and True Beauty's false
 * lashes; brand fields that named the store or another brand (the Five Minute Journal is Intelligent Change's, the
 * AeroPress AeroPress's, the Coral Coast mist Saltair's, the Fire TV Stick Amazon's).
 */
export const NAME_FIXES = [
  [/\bAcylic\b/g, "Acrylic"],
  [/^(Ray-Ban RB3025 Classic Aviator Sunglasses) for Men for Women$/, "$1"],
  [/^Best Sellers Mixed Pack$/, "Best Sellers Canned Wine Mixed Pack"],
  [/^Sparkling Wine Mixed Pack$/, "Sparkling Canned Wine Mixed Pack"],
  [/^Gold Standard Lash Style$/, "Gold Standard False Lash Style"],
];
/**
 * Fit audit r4 (11-19): a title cut at its comma, and names that did not say what the item is (each read off the shop's
 * own product URL or photo file name). Applied to each page's final list (r4Name), after the featured order has matched
 * the names it was written against.
 */
export const R4_NAME_FIXES = [
  [/^Salt, Fat(, Acid)?$/, "Salt, Fat, Acid, Heat"],
  [/^Venezia 18K$/, "St. Louis Venezia 18K Sunglasses"],
  [/^(.+ Zippy)$/, "$1 Zip-Up Pajamas"],
  [/^(Ghost Potion Friends|Cozy Cats|Laundry Day)$/, "$1 Diamond Art Painting Kit"],
  [/^Holiday Bundle$/, "Holiday Coffee Bundle"],
  [/^Acadiana Table$/, "Acadiana Table Cookbook"],
  [/^Snow Angel Boots$/, "Snow Angel Winter Boots"],
  [/^Klash Pants$/, "Klash Hiking Pants"],
  [/^pegasus running shoes$/, "Pegasus Running Shoes"],
  [/^Fossil (MTP-VT01GL)/, "Casio $1"],
  [/^GLOBAL ADVERTISING SOLUTIONS Lot of 6 Branches Military Flags$/, "Set of 6 Military Branch Flags"],
  [/^Standard Baggu$/, "Standard Baggu Reusable Bag"],
  [/^24 Day Advent Calendar$/, "24 Day Bracelet Advent Calendar"],
  [/^1 Month Gift \(Coffee Pods\)$/, "1-Month Coffee Pod Subscription Gift"],
  [/\s*-:\s*Dried$/, ", Dried"],
];
/** A name that is only a pack's scent ("Holiday Gift Pack, Swagger") opens with its brand (Old Spice, Olay). */
export const BRAND_FIRST = /^Holiday Gift Pack\b/;
export const brandedName = (name, brand) => (BRAND_FIRST.test(String(name ?? "")) && String(brand ?? "").trim() ? `${String(brand).trim()} ${name}` : name);
/** A pick's r4 name and brand: { name, brand } (unchanged when no fix applies). */
export const r4Name = (p) => {
  const name = brandedName(R4_NAME_FIXES.reduce((n, [rx, to]) => n.replace(rx, to), String(p.name ?? "")), p.brand);
  return { name, brand: name === p.name ? p.brand : (fixedBrand(name) || p.brand) };
};
export const fixName = (name) => NAME_FIXES.reduce((n, [rx, to]) => n.replace(rx, to), String(name ?? ""));
export const BRAND_FIXES = [
  [/\bfive minute journal\b/i, "Intelligent Change"],
  [/^aeropress coffee maker$/i, "AeroPress"],
  [/^coral coast fine fragrance body mist - saltair$/i, "Saltair"],
  [/^fire tv stick\b/i, "Amazon"],
  [/^salt, fat, acid, heat$/i, "Samin Nosrat"],
  [/^casio mtp-/i, "Casio"],
];
export const fixedBrand = (name) => BRAND_FIXES.find(([rx]) => rx.test(String(name ?? "")))?.[1] ?? "";

/**
 * MODEL YEARS (owner 11-19: "why the hell would we recommend a 2024 model of anything", on "Amazon Kindle Paperwhite
 * 16GB (2024 model)"). A shown name never carries a model year:
 *   - SUPERSEDED: an older model whose newer one is in our library (Yoto Mini 2024 Edition / Yoto Player 3rd Gen vs the
 *     4th Gen, AirPods 3rd Gen vs AirPods 4) is removed;
 *   - "(2024 model)", "(2024)", "(2024 Edition)", "[2026 Upgraded]", "2024 Edition" are cut from the name (the product
 *     is the current model: the Oct 2024 Kindle Paperwhite is still Amazon's newest);
 *   - a bare year before 2026 left after that ("USMLE Step 1 2020", "Southern Living 2025 Annual Recipes") is an old
 *     edition, so the pick is removed; a bare 2026+ year stays only on a dated title (a calendar, planner, almanac,
 *     dated ornament), and is cut from anything else ("2026 TruFeel Golf Balls" -> "TruFeel Golf Balls").
 * A wattage or size ("2000-Watt") is no year. Guard: src/test/giftGuideTop10White1119.test.ts.
 */
export const SUPERSEDED_MODEL = /\byoto mini \(2024 ed|\byoto player \(3rd gen|\bairpods (\(?3rd gen|3\b)/i;
export const DATED_TITLE = /\b(calendars?|planners?|almanac|ornaments?|pajamas|stocking|dreambook|diary|agenda|yearbook)\b/i;
const YEAR = /\b20\d\d\b(?![-\s]?(watts?|w|mah|lumens?|pieces?|pcs?|count|ct|mm|lbs?|psi|rpm)\b)/i;
const YEAR_G = new RegExp(YEAR.source, "gi");
const OLD_YEAR_BARE = /\b(20[01]\d|202[0-5])\b(?![-\s]?(watts?|w|mah|lumens?|pieces?|pcs?|count|ct|mm|lbs?|psi|rpm)\b)/i;
/** The shown name without a model year, or "" when the pick is an old model or an old edition (removed). */
export function modelYearName(name) {
  const raw = String(name ?? "");
  if (SUPERSEDED_MODEL.test(raw)) return "";
  let n = raw
    .replace(/\s*[([]\s*20\d\d(\s*[-–]\s*20\d\d)?(\s+(model|edition|ed\.?|upgraded|updated|release|version|new|newest|latest))?\s*[)\]]/gi, "")
    .replace(/\s*\b(new\s+)?20\d\d\s+(model|edition|upgraded|updated|version|release)\b/gi, "")
    .replace(/\s{2,}/g, " ").trim();
  if (OLD_YEAR_BARE.test(n)) return "";
  if (!DATED_TITLE.test(n) && YEAR.test(n)) n = n.replace(YEAR_G, "").replace(/\s+([,)\]])/g, "$1").replace(/^[\s,-]+|[\s,-]+$/g, "").replace(/\s{2,}/g, " ").trim();
  return n;
}
/** A shown name that still names a model year (the guard's check): any year on a non-dated title, or a pre-2026 year. */
export const namesModelYear = (name) => OLD_YEAR_BARE.test(name) || (!DATED_TITLE.test(name) && YEAR.test(name)) || /[([]\s*20\d\d/.test(name);

/**
 * NOT GIFTABLE DECOR (owner 11-19: "remove [these]. alot cuter things to pick from", on an AimHave tablecloth, a
 * Minteefy glass wall art and a Mosaic weighted blanket): tablecloths, table runners, wall art (prints, canvas, glass
 * art) and placemats from off-brand home-decor shops are no gift on the people, budget and life-moment guides. New
 * Homeowner keeps them from a known home brand only. GUIDE_GROUPS is filled by the import from giftGuideIndex.ts.
 */
export const NOT_GIFT_DECOR = /\b(tablecloths?|table ?cloths?|table ?runners?|wall art|wall d[eé]cor|wall hangings?|wall plaques?|canvas (prints?|art|wall art|paintings?)|art prints?|glass (wall )?art|placemats?|place ?mats?)\b/i;
export const DECOR_OFF_GROUPS = ["By person", "By budget", "Life moments"];
export const DECOR_OK_GUIDES = ["new-homeowner", "housewarming"];
export const KNOWN_DECOR_BRAND = /^(pottery barn|williams[- ]sonoma|crate (&|and) barrel|west elm|anthropologie|rifle paper co\.?|le creuset|hearth (&|and) hand|magnolia|threshold|ralph lauren|kate spade|mackenzie-childs|juliska)$/i;
export const GUIDE_GROUPS = new Map();
export const decorOff = (slug, p) => NOT_GIFT_DECOR.test(p.name) && DECOR_OFF_GROUPS.includes(GUIDE_GROUPS.get(slug))
  && !(DECOR_OK_GUIDES.includes(slug) && KNOWN_DECOR_BRAND.test(String(p.brand ?? "").trim()));

/**
 * NO FOOD TINS FOR FAMILY (owner 11-19 on /gift-guides/mom: "remove you dont gift this to a mom for christmas?", on
 * David's Cookies tins and Edible Arrangements trays): food gift tins (cookie, brownie, popcorn), fruit arrangements and
 * dessert boxes are no gift for close family, a partner or a kid. They stay on coworkers, boss, neighbor, hostess,
 * teachers, the food and Louisiana guides, thank-you, get-well and store pages (any guide not listed here).
 */
export const FOOD_TIN = /\b(cookies?|brownies?|popcorn|fudge|toffee|biscotti|pretzels?|treats?|sweets|snacks?)\b[^,]*\b(tins?|boxe?s?|platters?|trays?|assortment|sampler|baskets?|towers?|bundles?)\b|\b(tins?|boxe?s?|platters?|trays?|assortment|sampler|baskets?|towers?)\s+of\s+(cookies|brownies|popcorn|treats)\b|\bmeltaways\b|\bfruit (arrangements?|bouquets?|baskets?|platters?|boxe?s?)\b|\bdessert (boards?|boxe?s?|trays?|platters?)\b|\b(chocolate[- ](covered|dipped)|dipped) (strawberries|fruit)\b|\bedible arrangements?\b/i;
export const FOOD_TIN_BRAND = /^(david'?s cookies|edible arrangements|cheryl'?s( cookies)?|the popcorn factory|popcornopolis|mrs\.? fields)$/i;
/** Owner 11-19 ("remove for mom", GODIVA Holiday Luxury Gift Set): chocolate and candy boxes, gift sets and baskets too. */
export const CANDY_BOX = /\b(chocolates?|truffles?|candy|candies|bonbons?|pralines?|caramels?|toffee|fudge|lindor|godiva)\b[^,]*\b(gift sets?|boxe?s?|tins?|baskets?|assortment|sampler|collection|tower|bundle)\b|\b(gift sets?|boxe?s?|tins?|baskets?|assortment|sampler)\s+of\s+(chocolates?|truffles|candy|candies)\b|\b(fruit baskets?|snack baskets?)\b/i;
export const CANDY_BRAND = /^(godiva|lindt|see'?s( candies)?|harry (&|and) david|ferrero( rocher)?|ghirardelli|russell stover|whitman'?s|lake champlain chocolates|vosges|compartés|compartes|neuhaus|leonidas|teuscher|la maison du chocolat|wolferman'?s)$/i;
export const FOOD_TIN_OFF_GUIDES = ["mom", "dad", "wife", "her", "him", "boyfriend-or-husband", "girlfriend", "grandma", "grandpa", "grandparents",
  "sister", "brother", "mother-in-law", "father-in-law", "sister-in-law", "brother-in-law", "aunt", "uncle", "niece", "nephew", "cousins", "big-sisters"];
export const foodTinOff = (slug, p) => (FOOD_TIN_OFF_GUIDES.includes(slug) || GUIDE_GROUPS.get(slug) === "For kids")
  && (FOOD_TIN.test(p.name) || FOOD_TIN_BRAND.test(String(p.brand ?? "").trim()) || CANDY_BOX.test(p.name) || CANDY_BRAND.test(String(p.brand ?? "").trim()));

/**
 * NO MAGAZINES FOR FAMILY (owner 11-19: "remove magazine for mom"): a magazine subscription (Magazines.com, Magzter, any
 * "Magazine Subscription") shows only on Subscriptions, Book Lover and store pages.
 */
/** The pick link's host is one of these domains (or a subdomain); parses the URL, so no unanchored substring match. */
const hrefOnHost = (href, ...domains) => {
  const raw = String(href ?? "");
  if (!URL.canParse(raw)) return false;
  const h = new URL(raw).hostname.toLowerCase();
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
};
export const MAGAZINE = /\bmagazines?\b|\bmagzter\b/i;
export const MAGAZINE_OK_GUIDES = ["subscriptions", "book-lover"];
export const magazineOff = (slug, p) => !slug.startsWith("store-") && !MAGAZINE_OK_GUIDES.includes(slug)
  && (MAGAZINE.test(p.name) || /^(magazines\.com|magzter)$/i.test(String(p.brand ?? "").trim()) || hrefOnHost(p.href, "magazines.com", "magzter.com"));

/**
 * NO WOMEN'S SPERRYS (owner 11-19: "no women wear sperrys these days"): women's Sperry boat shoes and loafers show on no
 * guide; men's Sperry stays only on Boater, Fishing and the men's guides.
 */
export const SPERRY = /\bsperry\b/i;
export const SPERRY_MEN_GUIDES = ["boater", "fishermen", "commercial-fishermen-and-shrimpers", "him", "dad", "boyfriend-or-husband", "grandpa", "brother", "uncle",
  "father-in-law", "brother-in-law", "nephew", "boys-teens"];
export const sperryOff = (slug, p) => {
  if (slug.startsWith("store-") || !(SPERRY.test(p.name) || SPERRY.test(String(p.brand ?? "")))) return false;
  if (/\bwomen'?s\b|\bwomens\b|\bladies\b|\bgirls?'?\b/i.test(p.name)) return true;
  return !SPERRY_MEN_GUIDES.includes(slug);
};

/**
 * LIFE IS GOOD (owner 11-19: "life is good is not as popular in louisiana"): no Life is Good item on the people, budget
 * or life-moment guides; its own store page stays.
 */
export const LIFE_IS_GOOD = /\blife is good\b|^lig\b/i;
export const lifeIsGoodOff = (slug, p) => !slug.startsWith("store-")
  && (LIFE_IS_GOOD.test(String(p.brand ?? "")) || LIFE_IS_GOOD.test(p.name) || hrefOnHost(p.href, "lifeisgood.com"));

/**
 * NO BASS PRO BLANKETS FOR HER (owner 11-19: "there are a lot better blanket options than one from bass pro"): Bass Pro
 * Shops and Cabela's home and decor items (blankets, throws, decor) show on no women's guide; they stay on the outdoors,
 * hunting and fishing guides and their store pages.
 */
export const OUTDOOR_STORE = /^(bass pro( shops)?|cabela'?s)$/i;
export const HOME_DECOR = /\b(blankets?|throws?|sherpa|quilts?|pillows?|d[eé]cor|wall art|signs?|rugs?|curtains?|candles?|lamps?|mugs?|ornaments?)\b/i;
export const outdoorDecorOff = (slug, p) => WOMEN_GUIDES.includes(slug)
  && (OUTDOOR_STORE.test(String(p.brand ?? "").trim()) || OUTDOOR_STORE.test(String(p.store ?? "").trim()) || /^store-(bass-pro|cabela)/.test(String(p.store ?? "")) || OUTDOOR_STORE.test(String(p.retailer ?? "").trim()) || hrefOnHost(p.href, "basspro.com", "cabelas.com"))
  && HOME_DECOR.test(p.name);

/**
 * FOOD IS NOT A GIFT-GUIDE PICK (owner 11-19: "take all the snack items out of guides and make a section for them, they
 * don't belong in gift guides"; "the food does not belong in a gift guide"). Every food and snack gift (cookie, brownie
 * and popcorn tins, Milk Bar, Levain, David's Cookies, ice cream, chocolate and candy boxes, fruit and dessert
 * arrangements, food gift baskets, snack boxes, sauces and spice sets, coffee and tea samplers) moves to ONE guide,
 * Treats & Food Gifts (TREATS_GUIDE). Food stays only on the guides that ARE about food (FOOD_GUIDES) and on store
 * pages; Mail Carrier keeps its snack boxes at $20 or less (a small thank-you is the point there). Pet treats,
 * kitchen tools, cookbooks and food-themed clothes or decor are no food. Supersedes the 11-19 family-only food-tin rule.
 */
export const FOOD_NAME = /\b(cookies|brownies|blondies|cupcakes|cheesecakes?|pies|bundt cakes?|cake balls|layer cakes?|king cakes?|pound cakes?|rum cakes?|fruitcakes?|chocolates|chocolate bars?|truffles|bonbons|candy|candies|caramels|toffee|fudge|brittle|pralines|popcorn|pretzels|jerky|beef sticks|meat sticks|ice cream pints?|pints of ice cream|gelato|hot sauces?|bbq sauces?|barbecue sauces?|sauce (sets?|trio|collection|gift|variety)|sauces|seasonings?|spice (sets?|rubs?|kits?|blends?|collection|gift)|spices|rubs|snack (box(es)?|crates?|baskets?|packs?|bundles?|assortment)|snacks|mixed nuts|cashews|pecans|almonds|pistachios|charcuterie (box|gift|set|kit)|cheese (box|gifts?|sets?|assortment|sampler|board gift)|salami|steaks|filet mignon|beignet mix|coffee (sampler|gift set|variety pack|tasting)|tea (sampler|gift set|variety pack|tasting)|gift baskets?|fruit (baskets?|bouquets?|arrangements?|box(es)?)|chocolate[- ](covered|dipped)|dipped strawberries|meltaways|cookie (tin|box|dough)|macarons|biscotti|shortbread|petit fours|baklava|honey (sets?|gift|trio|sampler)|jam (sets?|gift|trio)|preserves (set|gift))\b/i;
export const NOT_FOOD = /\b(maker|machine|popper|cutters?|stand|pan|plates?|molds?|mould|scoop|bowls?|grinder|mill|rack|organizer|book|cookbook|candle|lip|balm|scrub|lotion|soap|wax melt|scented|plush|squishmallow|toy|ornaments?|socks?|tee|shirt|pajamas?|hoodie|blanket|mug|tumbler|pillow|jar opener|spoon|tongs?|thermometer|smoker|grill|skillet|knife|dispenser|shaker|holder|container|storage|keychain|charm|earrings?|necklace|lego|puzzle|game|costume|sticker|print|sign|sauce ?pan|dish|(cutting|serving|charcuterie|cheese|bread|cork|vision|game|bulletin|ironing|surf|paddle|skate|dart|cribbage|chess) ?boards?|hats?|caps?|towels?|napkins?|pouch|flags?|zippy|candy land|spa|bath|gift ?cards?|e-?gift|dogs?|cats?|horses?|pets?|puppy|kitten|coffee(?! (sampler|gift set|variety pack|tasting)))\b/i;
export const FOOD_BRAND = /^(david'?s cookies|edible arrangements|cheryl'?s( cookies)?|the popcorn factory|popcornopolis|mrs\.? fields|milk bar|levain( bakery)?|godiva|lindt|see'?s( candies)?|harry (&|and) david|ferrero( rocher)?|ghirardelli|russell stover|whitman'?s|lake champlain chocolates|vosges|compart[eé]s|neuhaus|leonidas|teuscher|la maison du chocolat|wolferman'?s|omaha steaks|ecreamery|jeni'?s( splendid ice creams)?|goldbelly|sugarfina|dylan'?s candy bar|insomnia cookies|crumbl|baked by melissa|tate'?s( bake shop)?|brooklyn delhi|fly by jing|truff|graza|haven'?s kitchen|olipop|poppi|carnegie deli|zingerman'?s|stonewall kitchen|hickory farms|figi'?s|swiss colony)$/i;
/** Owner 11-19 ("remove from mens", Maker Wine's Red Wine Mixed Pack): wine and alcohol samplers count as food and drink. */
export const DRINK_NAME = /\b(red|white|ros[eé]|sparkling)? ?wines?\b[^,]*\b(mixed pack|packs?|sampler|gift sets?|box|club|flight|trio|bottles?)\b|\b(bourbon|whiske?y|vodka|tequila|mezcal|gin|champagne|prosecco|cocktail mixers?|craft beer|beer)\b[^,]*\b(sampler|gift sets?|mixed pack|flight|trio|box)\b/i;
export const DRINK_NOT = /\b(openers?|glass(es)?|aerators?|chillers?|stoppers?|racks?|decanters?|tumblers?|coolers?|totes?|bags?|stones|socks?|shirts?|tees?)\b/i;
export const DRINK_BRAND = /^(maker wine|maker|winc|firstleaf|vinebox|bright cellars|naked wines|wine access|flaviar|cocktail courier|saucey)$/i;
export const isFood = (p) => DRINK_BRAND.test(String(p.brand ?? "").trim()) || (DRINK_NAME.test(String(p.name ?? "")) && !DRINK_NOT.test(String(p.name ?? ""))) || FOOD_BRAND.test(String(p.brand ?? "").trim()) || ((FOOD_NAME.test(String(p.name ?? "")) || FOOD_TIN.test(String(p.name ?? "")) || CANDY_BOX.test(String(p.name ?? ""))) && !NOT_FOOD.test(String(p.name ?? "")));
export const TREATS_GUIDE = "treats-and-food-gifts";
export const FOOD_GUIDES = [TREATS_GUIDE, "louisiana-kitchen", "louisiana-sweets-and-bakeries", "coffee-and-beignets", "home-cook", "foodie", "coffee-lover",
  "tea-lover", "wine-lover", "wine-and-spirits", "grill-master", "baker", "chefs", "cooks-and-kitchen-staff"];
export const foodOff = (slug, p) => !slug.startsWith("store-") && !FOOD_GUIDES.includes(slug) && isFood(p) && !(slug === "subscriptions" && isFoodSub(p))
  && !(slug === "mail-carrier-and-delivery-drivers" && typeof p.price === "number" && p.price <= 20);

/**
 * NOT FOR MEN / NOT A PERSONAL GIFT (owner 11-19): CHORD's Black Watch Plaid Cap leaves the men's guides; nixplay's
 * custom-upload canvas and photo book (stock photos) leave every guide but their store page, and a nixplay frame shows
 * only on Grandparents; the Ring Battery Doorbell shows only on New Homeowner.
 */
export const MEN_GUIDES = ["him", "dad", "boyfriend-or-husband", "brother", "grandpa", "uncle", "father-in-law", "brother-in-law", "nephew", "new-dad",
  "boys", "boys-babies", "boys-toddlers", "boys-little-kids", "boys-big-kids", "boys-teens"];
export const personalGiftOff = (slug, p) => {
  if (slug.startsWith("store-")) return false;
  const name = String(p.name ?? "");
  const brand = String(p.brand ?? "");
  // Owner 11-19: "hats are popular in mens but not like this": no CHORD item on any people guide.
  if (/^chord$/i.test(brand.trim()) && GUIDE_GROUPS.get(slug) === "By person") return true;
  // Owner 11-19 ("a man does not want this"): only nixplay digital frames, only on the grandparent guides.
  if (/nixplay/i.test(brand) || /\bnixplay\b/i.test(name)) return !/\bframes?\b/i.test(name) || /\b(canvas|photo book|hardcover|throw|blanket|ornament)\b/i.test(name) || !["grandparents", "grandma", "grandpa"].includes(slug);
  if (/\bring\b/i.test(brand) && /\bdoorbell\b/i.test(name)) return slug !== "new-homeowner";
  return false;
};
/**
 * NEW AFFILIATE APPROVALS (lead 11-19, _new-approvals-1119.json): where a newly approved brand's pick goes in a guide's
 * final list. Never above the first NEW_APPROVAL_KEEP_TOP picks or any Trending pick (`isTop`); from there it goes ahead
 * of the first lower-commission pick (`isLower`: Amazon), so it outranks those at equal fit; with none left, at the end.
 */
export const NEW_APPROVAL_KEEP_TOP = 3;
export const newApprovalSlot = (list, isTop, isLower) => {
  let start = Math.min(NEW_APPROVAL_KEEP_TOP, list.length);
  list.forEach((p, i) => { if (isTop(p) && i + 1 > start) start = i + 1; });
  for (let i = start; i < list.length; i++) if (isLower(list[i])) return i;
  return list.length;
};
/**
 * The research row's `why_fits` as the shopper's line: our notes (what a brand pays, the owner's code, a rate) and any
 * price ("$" + digit hides a pick) come out; a line left empty is "".
 */
export const approvalLine = (why) => {
  let s = String(why ?? "").replace(/\s*\([^)]*(\$|%|\brate\b)[^)]*\)/g, "").split(";")[0];
  s = s.replace(/,[^,]*\$\s?\d[^,]*?(?=[.,]|$)/g, "");
  s = s.replace(/\s+(under|from)\s+\$\s?\d[\d.,]*/gi, "");
  s = s.replace(/\s+/g, " ").trim().replace(/[.,;:\s]+$/, "");
  if (!s || /\$\s?\d|%|\bpays\b|\bcommission\b|\bLEXI10\b/i.test(s)) return "";
  return `${s}.`;
};
/**
 * FIT AUDIT R4 (2026-11-19, ~/.lh-shots/design-audit-loop/gg-r4-fit: 12 High, 89 Medium, 72 Low; lead 11-19). The career
 * fills (_career-fill-A-1118.json, _fill-B-1118.json) are Amazon search results shared by every guide one search fed, so a
 * stray result rode along into each of them (the teacher block's dentist retirement socks, doorbell and server apron; a
 * toenail-fungus soak, cough drops and Purell in the service jobs; stethoscopes for desk staff and therapists). These
 * rules keep each career to what fits that job, on every page's final list (fitR4Why and typeCaps, read by the holistic
 * pass of scripts/gift-guide-picks.mjs), whatever file brings a pick back:
 * - MEDICAL_CARE: medical and pain care (fungus, cough drops, sanitizer, heat patches, a back brace, burn gel, a blood
 *   pressure cuff, pill box, oximeter, pain relief, a burial flag case) is no gift: in no guide. A bath or foot soak only
 *   on the beauty guides.
 * - STETHOSCOPE only on the clinical guides; NURSE_LABEL items (nurse scrub caps, nurse bags) only on the nurse guides.
 * - vagueGiftName: a name that says only "<job> Gifts for Women" (HEXMOZ, URBRE, DOEARTE) names no item: out of the guides.
 * - R4_OFF: the audit's per-guide misfits, by guide (a golf net in Car Lover, gel pens in Music Lover ...).
 * - Colors (colorWhy): a color guide drops a pick that names another color and not its own, and one whose color is only
 *   a pun (red light, red wine, putting green, Back the Blue).
 * - TYPE_CAPS: one of a kind per guide (trauma shears, penlights, stethoscopes, truck fridges, CB radios, book lights ...),
 *   and PRODUCT_TWINS: the same product under two links or names (MX Master 3S, MUCK Arctic Pro, Hoka Men's Bondi 9).
 * - Louisiana: the brand cap of 3 holds in the Louisiana guides too; North Louisiana holds only North Louisiana items
 *   (NORTH_LA); a Louisiana guide lists items, not places (a business's homepage or an event page).
 * - Beauty: hair tools count as beauty (curlers, Airwrap, dryers, straighteners, facial systems), so they keep to the
 *   beauty guides and to 6 guides a product; BEAUTY_PREFERRED names the 6 a widely listed product keeps.
 */
export const MEDICAL_CARE = /\b(toe ?nail|nail fungus|fungus|athlete'?s foot|sore throat|cough drops?|throat drops|lozenges?|hand sanitizer|purell|heat patch(es)?|thermacare|back support belt|back brace|burn (relief )?gel|alocane|blood pressure monitor|pill organizer|pill box|pulse oximeter|pain relief (kit|patch(es)?|cream|gel|rub|roll-?on)|burial flag)\b/i;
export const BATH_SOAK = /\b(epsom salt|foot soak|bath soak)\b/i;
export const medicalCare = (p) => MEDICAL_CARE.test(`${p.name ?? ""} ${p.brand ?? ""}`);
export const STETHOSCOPE = /\bstethoscopes?\b(?!\s*(personalized )?(name )?(tag|id|charm|cover|holder|hook|clip))/i;
export const STETHOSCOPE_GUIDES = /nurse|^(rns|lpns|cnas|crnas|doctors|surgeons|physician-assistants|medical-assistants|paramedics-and-emts|med-students|nursing-students|healthcare|healthcare-workers|respiratory-therapists|vets-and-vet-techs|first-responders|nursing-home-staff)$/;
export const NURSE_LABEL = /\bnurses?\b(?!,? (and |& )?doctors?\b)|\bnursing (clipboard|bag|tote)\b/i;
export const NURSE_GUIDES = /nurse|^(rns|lpns|cnas|crnas|healthcare|healthcare-workers|caregivers|nursing-home-staff|nursing-students|medical-assistants)$/;
const BABY_GUIDE = /^(new-mom|mom-to-be|baby-shower|new-parents)$|bab(y|ies)/;
/** A trailing "Gifts for Women", "Appreciation Gifts" or "Stocking Stuffers for Men" with no item named before it. */
export const GIFT_SUFFIX = /[\s,-]*\b(?:(?:(?:cool|unique|appreciation|worker) )*gifts|gifts? for (?:wo)?men(?: (?:and |& )?(?:wo)?men)?|(?:christmas )?stocking stuffers?(?: for (?:wo)?men)?)$/i;
const ROLE_WORDS = /\b(best|christmas|holiday|funny|cute|unique|cool|teachers?|coach(es)?|lawyers?|lineman|linemen|dental|dentists?|assistants?|hygienists?|bus|drivers?|police|officers?|thin|blue|line|nurses?|appreciation|workers?|for|and|women|men|the|her|him)\b/gi;
export const vagueGiftName = (p) => {
  const name = String(p.name ?? "");
  if (!GIFT_SUFFIX.test(name)) return false;
  let rest = name.replace(GIFT_SUFFIX, "");
  const brand = String(p.brand ?? "").trim();
  if (brand && rest.toLowerCase().startsWith(brand.toLowerCase())) rest = rest.slice(brand.length);
  else rest = rest.replace(/^[A-Z0-9&]{3,}\b/, "");
  return rest.replace(ROLE_WORDS, "").replace(/[^a-z]/gi, "") === "";
};
const TEACHERS = ["educators", "elementary-teachers", "high-school-teachers", "teachers", "paraprofessionals", "principals-and-school-staff"];
const DENTAL = ["dentists", "dental-assistants", "dental-hygienists"];
const BUDGET_25 = ["under-25", "under-20", "under-15", "under-10", "under-5"];
const LA_PLACE = /\b(restaurant( & market)?|house tours( and cafe)?|festival of lights|syrup shop|foods)$|^dupuy's abbeville$/i;
/** The audit's per-guide misfits (R4_OFF[slug] tested against "<name> <brand>"). */
export const R4_OFF = {
  ...Object.fromEntries(TEACHERS.map((g) => [g, /\bretirement\b|\bdentist\b|\bdoorbell\b|\bserver aprons?\b|\bwine tote\b/i])),
  "boat-captains-and-deckhands": /\bornament (hooks|anchor)\b|\byacht captain hat\b|\bsailor hat\b|\bwet dry bags?\b|\bbabygoal\b/i,
  "commercial-fishermen-and-shrimpers": /\bwet dry bags?\b|\bbabygoal\b/i,
  "car-lover": /\bgolf\b/i,
  "music-lover": /\bgel pens?\b|\bpens\b/i,
  chefs: /\bsandals?\b/i,
  dentists: /\btoothbrush holder\b|\bnursing clipboard\b|\bgraduation (coffee )?mug\b|\bdental model\b/i,
  "dental-assistants": /\bdental model\b/i,
  "dental-hygienists": /\bdental model\b/i,
  farmers: /\banimal sounds\b|\bmusical tractor\b|\bhayride\b/i,
  "hotel-staff": /\bhand repair gift set\b|\bspa gift basket\b|\blint roller\b/i,
  housekeepers: /\bcerave\b|\bbaby lotion\b|\bcleaning gloves\b|\bcleaning\b.*\bcaddy\b|\bmicrofiber\b|\bhousekeeping week\b|\bbulk\b/i,
  "landd-nurses": /\bbaby shower\b|\bsumind\b/i,
  "med-students": /\busmle step 1 20[012]\d\b|\btranslation earbuds\b/i,
  veterans: /\bburial flag\b|\bchallenge coins\b/i,
  diyer: /\bcharcuterie\b|\bdoor ?mat\b/i,
  gardener: /\bhousehold tool set\b|\bcooler\b/i,
  crafter: /\bgarden (scissors|shears)\b|\bweighted blanket\b|\bboard game storage\b/i,
  "black-lover": /\bnapkins\b/i,
  "blue-lover": /\bback the blue\b|\blittle blue truck\b|\bmonster truck\b/i,
  "green-lover": /\bputting green\b|\bolive oil\b|\bfire pit mat\b|^mens' patagonia\b/i,
  "neutral-lover": /\bbulk\b/i,
  "purple-lover": /\bhair dryer\b|\bcurling (wand|iron)\b|\btallow balm\b|\bsilicone boot\b|\bwatch bands?\b/i,
  "red-lover": /\bheadlamp\b|\bwine aerator\b|\bcostume\b|\bblush tint\b/i,
  "yellow-lover": /\bjbl grip portable bluetooth speaker jbl$|\bhi[- ]?vis\b|\bwork gloves\b|\bgrocery bags\b|\bmixer cover\b|\bcanvas tote\b|\bcurling iron\b/i,
  "new-kitten": /\bsmart mug\b|\bember\b/i,
  "911-dispatchers": /\bcandle\b/i,
  "restaurant-servers": /\bcandle\b/i,
  "social-workers": /\bstudy guide\b|\bessential oil\b|\bcandle\b/i,
  bartenders: /\bserver books?\b/i,
  "coast-guard": /\bgolf\b/i,
  machinists: /\bcircuit breaker finder\b|^fowler 54-/i,
  "police-officers": /\bhandcuffs\b/i,
  surgeons: /\bcufflinks\b/i,
  "flight-attendants": /\bpilot wings\b/i,
  hairstylists: /\bhair dryer holder\b|\bheatless\b.*\bcurl/i,
  "heavy-equipment-operators": /\bbruder\b/i,
  "crane-operators": /\bbruder\b/i,
  "lab-techs-phlebotomists": /\bvein ?finder\b|\bveinlite\b|\bpractice kit\b/i,
  "mom-to-be": /\bpostpartum\b/i,
  hostess: /\bair fryer\b|\bcast iron skillet\b|\bflatware\b|\bstocking\b/i,
  "new-homeowner": /\bfloor mattress\b/i,
  "coffee-and-beignets": /\bsmart mug\b|\bember\b/i,
  "louisiana-small-businesses": /\btony chachere/i,
  "louisiana-sweets-and-bakeries": /\bhot honey\b/i,
  "stocking-stuffers": /\bsimmer sauce\b/i,
  ...Object.fromEntries(["college-student", "graduate"].map((g) => [g, /\bkitsch\b|\bheatless\b/i])),
  "thinking-of-you": /\bkitsch\b|\bheatless\b|\b12 month calendar\b/i,
  "girls-big-kids": /\brestore\b.*\bhatch\b|\bhatch restore\b/i,
  "gender-neutral-toddlers": /\bminnie mouse\b/i,
  ...Object.fromEntries(BUDGET_25.map((g) => [g, /\bquencher\b/i])),
  "under-25": /\bquencher\b|\bcozychic\b|\bcolumbia pfg\b/i,
  "baton-rouge": /\bmossy oak\b/i,
  "game-day": /\bkijaro\b|\bfrost buddy\b|^game day\b/i,
  "customer-service-reps": /^5aup\b/i,
  "hospital-front-desk": /^funny sarcastic novelty joke\b/i,
  cashiers: /\bandaz press funny round metal christmas ornament\b/i,
  marines: /^kurt adler resin ornament\b/i,
  "movie-buff": /^kpop demon hunters\b/i,
  "white-elephant": /^mystic pickle\b/i,
  "cat-person": /^(count scratchula|cats with cash|meow pak)\b/i,
  "vets-and-vet-techs": /\bscrub caps\b/i,
  "store-macys": /\bsun bum\b|\bsunscreen\b/i,
  "store-walmart": /\bcar seat\b/i,
};
/** Each color guide's own color words (GUIDE_COLOR, plus shades the audit read: lime is green, gold is yellow). */
export const COLOR_OWN = { ...GUIDE_COLOR, "green-lover": /green|sage|olive|mint|emerald|forest|lime/i, "yellow-lover": /yellow|lemon|sunflower|mustard|golden/i };
const ANY_COLOR = /\b(black|white|red|blue|green|pink|purple|yellow|orange|navy|teal|lime|lavender|lilac|violet|plum|burgundy|crimson|scarlet|sage|olive|mint|emerald|cobalt|denim|jet black|onyx|magenta|fuchsia|rose|blush)\b/i;
/** Color words that are not the color (a red light, red wine, a putting green, Back the Blue, Thin Blue Line). */
export const COLOR_PUN = /\bred[- ](light|wine)\b|\bputting green\b|\bgreen (tea|beans?)\b|\bback the blue\b|\bthin blue line\b|\bblue (light|tooth)\b|\bblack (friday|rifle|pepper|tea)\b|\brose gold\b/gi;
export const colorWhy = (slug, p) => {
  const own = COLOR_OWN[slug];
  if (!own || slug === "purple-and-gold-lover") return "";
  const name = String(p.name ?? "");
  const plain = name.replace(COLOR_PUN, " ");
  if (own.test(plain)) return "";
  if (own.test(name)) return "color pun";
  return ANY_COLOR.test(plain) ? "another color" : "";
};
/** North Louisiana makers, teams and towns (Monroe, West Monroe, Shreveport, Bossier, Ruston, Natchitoches ...). */
export const NORTH_LA = /\b(north louisiana|shreveport|bossier|monroe|ruston|natchitoches|minden|grambling|louisiana tech|la tech|ulm|warhawks|duck commander|lasyone'?s|cane river)\b/i;
export const NORTH_LA_GUIDE = "north-louisiana";
/** Louisiana guides' place rows: a business or event named as the pick, not an item (Poche's Restaurant & Market, Dupuy's Abbeville, Steen's Syrup Shop). */
export const placeRow = (p) => LA_PLACE.test(String(p.name ?? "").trim()) || /\/event-details\//i.test(String(p.href ?? ""));
/** Why a pick does not fit this page under the r4 rules ("" when it fits). `group` is its index group. */
export const fitR4Why = (slug, group, p) => {
  const name = String(p.name ?? "");
  const text = `${name} ${p.brand ?? ""}`;
  if (R4_OFF[slug]?.test(text)) return "r4: not this guide";
  if (slug.startsWith("store-") || slug === "25-days-sponsors") return "";
  if (medicalCare(p)) return "r4: medical care";
  if (BATH_SOAK.test(text) && !beautyGuide(slug)) return "r4: bath soak";
  if (STETHOSCOPE.test(name) && !STETHOSCOPE_GUIDES.test(slug)) return "r4: stethoscope";
  if (NURSE_LABEL.test(name) && !NURSE_GUIDES.test(slug) && !BABY_GUIDE.test(slug)) return "r4: nurse item";
  if (vagueGiftName(p)) return "r4: vague name";
  if (group === "Colors") { const c = colorWhy(slug, p); if (c) return `r4: ${c}`; }
  if (slug === NORTH_LA_GUIDE && !NORTH_LA.test(text)) return "r4: not north louisiana";
  return "";
};
/**
 * One of a kind per guide: [pattern, max, guides?] (no guides = every guide; store pages only where named). Read in
 * list order, so the first (featured) ones stay.
 */
export const TYPE_CAPS = [
  [/\btrauma shears\b|\bmedical scissors\b/i, 1],
  [/\bpen ?lights?\b/i, 1],
  [STETHOSCOPE, 1],
  [/\b(refrigerator|fridge|freezer)\b/i, 1],
  [/\bcb radio\b/i, 1],
  [/\bbook lights?\b|\breading lights?\b/i, 1],
  [/\bwine (bottle )?opener\b/i, 1],
  [/\baerator\b/i, 1],
  [/\bfoot massager\b/i, 1],
  [/\bhand warmers?\b/i, 1],
  [/\bcoolers?\b/i, 3, ["tailgater"]],
  [/\bcoolers?\b(?!.*\btowel)/i, 2],
  [/\blunch (box|boxes|bag|lugger)\b|\bbento\b|\bfood jar\b/i, 2],
  [/\bbadge (reels?|holders?)\b/i, 3],
  [/\bseat cushion\b/i, 2],
  [/\b\d+[- ]?(piece|pc|pcs)\b.*\btool (set|kit)\b/i, 1],
  [/\bcoffee club\b/i, 1],
  [/\bmulti-?tool\b|\bleatherman (wave|wingman|signal|charge|skeletool|rebar|free)\b/i, 2],
  [/\bcandles?\b|\btea gift set\b/i, 1, ["book-lover"]],
  [/\belectric toothbrush\b|\bwater flosser\b|\bsonicare\b|\boral-b\b|\bcocofloss\b/i, 1, DENTAL],
  [/\btherapy putty\b|\bpeg ?board\b|\blacing beads\b|\bweighted lap pad\b|\bpencil grip\w*\b|\bgrip strengthener\b/i, 1, ["occupational-therapists"]],
  [/\bwh question\b|\bwho what why\b|\bvocabulary photo cards\b|\bself-portrait mirror\b|\bspot it\b/i, 2, ["speech-therapists"]],
  [/\bquencher h2\.0\b/i, 1, ["store-stanley"]],
  [/\beverywhere belt bag\b/i, 1, ["store-lululemon"]],
  [/\bpower bank\b.*\b10k\b|\b10k\b.*\bpower bank\b/i, 1, ["store-best-buy"]],
];
/** The same product listed twice under different links or names (one key per product, one row a guide). */
export const PRODUCT_TWINS = [/\bmx master( black)? 3s?\b/i, /\barctic pro\b/i, /(^|[^o])\bmen'?s bondi 9\b/i, /\bsalt, fat, acid\b/i];
/** The caps a pick counts toward on this page: [key, max]. */
export const typeCaps = (slug, p) => {
  const name = String(p.name ?? "");
  const out = [];
  TYPE_CAPS.forEach(([rx, max, only], i) => {
    if (only ? !only.includes(slug) : slug.startsWith("store-")) return;
    if (rx.test(name)) out.push([`type${i}`, max]);
  });
  if (!slug.startsWith("store-")) PRODUCT_TWINS.forEach((rx, i) => { if (rx.test(name)) out.push([`twin${i}`, 1]); });
  return out;
};
/** Hair tools and facial devices are beauty too (Kitsch curlers were on 17 guides, the Dyson Airwrap on 16). */
export const HAIR_BEAUTY = /\b(heatless|curlers?|curling (iron|wand|set)|airwrap|multi-?styler|hair dryers?|blow dryers?|straighten(ing|er)|flat iron|hot (air )?brush|facial system)\b/i;
/** The 6 guides a widely listed beauty product keeps, best fit first (lead 11-19); others follow beautyRank. */
export const BEAUTY_PREFERRED = [
  [/\bkitsch\b|\bheatless\b.*\bcurl/i, ["girls-teens", "self-care-lover", "stocking-stuffers", "sister", "under-20", "best-friend"]],
  [/\bairwrap\b/i, ["her", "wife", "girlfriend", "mom", "sister", "self-care-lover"]],
];
export const beautyPreference = (p, slug) => {
  const text = `${p.name ?? ""} ${p.brand ?? ""}`;
  const hit = BEAUTY_PREFERRED.find(([rx]) => rx.test(text));
  if (!hit) return 99;
  const i = hit[1].indexOf(slug);
  return i < 0 ? 99 : i;
};
/**
 * A brand field that names the store, not the maker (fit audit r4: Macy's Le Creuset kettle, Target's BISSELL vacuum,
 * Tractor Supply's Hape grill): the maker the name opens with, else no brand (never "On Macy's").
 */
export const RETAILER_BRAND = /^(macy'?s|target|target\.com|tractor supply|walmart|walmart\.com)$/i;
export const MAKER_PREFIXES = ["Bayou Classic", "BISSELL", "Camellia", "Cook With Color", "Cutting Edge", "Hape", "Hotel Collection", "Huntworth",
  "Lancôme", "Le Creuset", "Michael Kors", "Nespresso", "NEXPURE", "Nexpure", "Tabasco", "Tony Chachere's", "VAVSEA", "YETI", "Zatarain's", "Zatarains"];
export const retailerBrand = (name, brand) => {
  const b = String(brand ?? "").trim();
  if (!RETAILER_BRAND.test(b)) return brand;
  const n = String(name ?? "");
  if (n.toLowerCase().startsWith(b.toLowerCase().replace(/\.com$/, ""))) return brand;
  const maker = MAKER_PREFIXES.find((m) => n.startsWith(`${m} `));
  return maker === "Zatarains" ? "Zatarain's" : maker ?? "";
};

/**
 * SIBLING OVERLAP (owner 11-19: "mom guide has a lot of the same items the wife guide has? there are soooooo many good
 * options that we do not need to repeat this"). Within a family two guides share none of their top SIBLING_TOP picks,
 * and at most SIBLING_MAX_SHARE of a guide's picks appear in any one sibling. A pick several want stays where it fits
 * best (SIBLING_FIT, first match in family order), else where it ranks highest. Guard: giftGuideTop10White1119.test.ts.
 */
export const SIBLING_FAMILIES = [
  ["grandma", "wife", "girlfriend", "mom", "her", "sister", "best-friend", "mother-in-law", "aunt"],
  ["grandpa", "boyfriend-or-husband", "dad", "him", "brother", "father-in-law", "uncle"],
];
export const SIBLING_TOP = 12;
export const SIBLING_MAX_SHARE = 0.15;
/** The share rule never thins a guide under this many picks (the top-12 rule always applies). */
export const SIBLING_MIN_PICKS = 20;
export const SIBLING_FIT = {
  grandma: /\b(blankets?|throws?|slippers?|robes?|photo|frames?|puzzles?|tea|cozy|cardigan|wrap)\b/i,
  wife: /\b(jewel\w*|necklaces?|bracelets?|earrings?|rings?|perfume|parfum|eau de|barefoot dreams|silk|cashmere|lingerie|pajama set)\b/i,
  girlfriend: /\b(jewel\w*|necklaces?|bracelets?|earrings?|perfume|parfum|eau de|barefoot dreams|silk|cashmere)\b/i,
  mom: /\b(ember|owala|ugg|our place|mugs?|tumblers?|always pan|slippers?|blankets?|throws?|aura|frames?)\b/i,
  her: /\b(sol de janeiro|laneige|lip|glow|stanley|belt bag|dyson|airwrap|trend\w*)\b/i,
  sister: /\b(games?|cute|squishmallow|candles?|fun|bag charms?|claw clips?)\b/i,
  "best-friend": /\b(games?|cute|candles?|fun|friendship|matching)\b/i,
  "boyfriend-or-husband": /\b(watch|cologne|wallet|leather|whiskey|cufflinks?)\b/i,
  grandpa: /\b(slippers?|robes?|photo|frames?|puzzles?|flannel|cardigan)\b/i,
  dad: /\b(grill\w*|tools?|multitool|yeti|cooler|flashlight|wallet)\b/i,
};
/**
 * Applies the sibling rule to { slug: picks[] } in place; `key` names a product. Returns { slug: removedCount }.
 * Pass 1: a product in two siblings' top SIBLING_TOP stays in one (the fit, else the better rank). Pass 2: a guide whose
 * share with one sibling is still over SIBLING_MAX_SHARE loses its lowest-ranked shared picks (never one in its top).
 */
export function applySiblingOverlap(pages, key) {
  const removed = {};
  const drop = (slug, k) => {
    const before = pages[slug].length;
    pages[slug] = pages[slug].filter((p) => key(p) !== k);
    removed[slug] = (removed[slug] ?? 0) + before - pages[slug].length;
  };
  // Dropping a pick moves later picks up into the top, so the passes repeat until nothing changes.
  for (let round = 0, before = -1; round < 20; round += 1) {
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    if (total === before) break;
    before = total;
  for (const fam of SIBLING_FAMILIES) {
    const guides = fam.filter((g) => Array.isArray(pages[g]));
    const at = (g, k) => pages[g].findIndex((p) => key(p) === k);
    const tops = new Map();
    for (const g of guides) pages[g].slice(0, SIBLING_TOP).forEach((p) => tops.set(key(p), [...(tops.get(key(p)) ?? []), g]));
    for (const [k, inTop] of tops) {
      const all = guides.filter((g) => at(g, k) >= 0);
      if (all.length < 2 || !inTop.length) continue;
      const pick = pages[all[0]][at(all[0], k)];
      const fit = all.find((g) => SIBLING_FIT[g]?.test(`${pick.name} ${pick.brand ?? ""}`));
      const owner = fit ?? [...all].sort((a, b) => at(a, k) - at(b, k) || guides.indexOf(a) - guides.indexOf(b))[0];
      for (const g of all) if (g !== owner && at(g, k) >= 0 && at(g, k) < SIBLING_TOP) drop(g, k);
    }
    for (const g of guides) {
      for (const s of guides) {
        if (s === g) continue;
        const theirs = new Set(pages[s].map(key));
        const cap = Math.floor(pages[g].length * SIBLING_MAX_SHARE);
        let shared = pages[g].map((p, i) => [key(p), i]).filter(([k]) => theirs.has(k));
        while (shared.length > cap && pages[g].length > SIBLING_MIN_PICKS) {
          const [k, i] = shared[shared.length - 1];
          if (i < SIBLING_TOP) break;
          drop(g, k);
          shared = pages[g].map((p, j) => [key(p), j]).filter(([x]) => theirs.has(x));
        }
      }
    }
  }
  }
  return removed;
}
/** The share of `a`'s picks that `b` also lists, and how many of `a`'s top SIBLING_TOP are in `b`'s top. */
export const siblingOverlap = (a, b, key) => {
  const kb = new Set(b.map(key));
  const topB = new Set(b.slice(0, SIBLING_TOP).map(key));
  return { share: a.length ? a.filter((p) => kb.has(key(p))).length / a.length : 0, topShared: a.slice(0, SIBLING_TOP).filter((p) => topB.has(key(p))).length };
};

/**
 * RESALE AND UK-ONLY SHOPS, KIDS' CROCS (lead 11-19, library check): a Depop page is someone's used listing and
 * boots.com is a UK-only store, so neither shows anywhere; kids' Crocs show only on the kids guides.
 */
const hostOf = (u) => (URL.canParse(String(u ?? "")) ? new URL(String(u)).hostname.toLowerCase().replace(/^www\./, "") : "");
export const RESALE_OR_UK_HOST = /^(depop\.com|boots\.com)$/;
export const resaleOrUkShop = (p) => [p.href, p.affiliate_href].some((u) => RESALE_OR_UK_HOST.test(hostOf(u)))
  || /^(depop|boots|boots uk)$/i.test(String(p.retailer ?? "").trim()) || /^store-(depop|boots)$/.test(String(p.store ?? ""));
export const kidsCrocsOff = (slug, p) => !slug.startsWith("store-") && GUIDE_GROUPS.get(slug) !== "For kids"
  && /\bcrocs\b/i.test(`${p.name} ${p.brand ?? ""}`) && /\b(kids?'?|toddlers?'?|little kids?|big kids?|juniors?|youth|boys'?|girls'?)\b/i.test(String(p.name ?? ""));

/**
 * CHARACTER COLLABS (owner 11-19: "remove, that's kind of ugly", on "Kitsch x BT21 Satin Pillowcase in CHIMMY in King"):
 * a Kitsch x BT21 (or other "Brand x Character") print shows on no guide; plain Kitsch satin and curl sets stay.
 */
export const CHARACTER_COLLAB = /\bkitsch\s*x\s*\w+|\bx\s*(bt21|hello kitty|sanrio|disney|pokemon|pok[eé]mon|barbie|care bears|peanuts|minions|harry potter|star wars|marvel)\b|\bbt21\b|\bchimmy\b/i;
export const characterCollab = (p) => CHARACTER_COLLAB.test(String(p.name ?? "")) && /kitsch|bt21|chimmy/i.test(`${p.name} ${p.brand ?? ""}`);

/**
 * DRUGSTORE BASICS ARE NO GIFT (owner 11-19: "remove", on Cantu's leave-in conditioning lotion): everyday drugstore hair
 * and skin products (leave-ins, shampoos, conditioners, plain lotions; Cantu, Suave, Dove, Aveeno, CeraVe ...) show on
 * no guide; a gift set stays (under the beauty rules), and store pages keep their own items.
 */
export const DRUGSTORE_BRAND = /^(cantu|suave|dove|aveeno|cerave|neutrogena|head (&|and) shoulders|pantene|tresemm[eé]|garnier|vaseline|jergens|nivea|cetaphil|eucerin|gold bond|lubriderm|aussie|herbal essences|v05|vo5|st\.? ives|olay|l'or[eé]al paris|mielle( organics)?|shea moisture|sheamoisture|not your mother'?s|ogx|aquaphor|eos)$/i;
export const DRUGSTORE_ITEM = /\b(leave-?in|shampoo|conditioner|conditioning lotion|body lotion|body wash|lotion|moisturizing cream|hair oil|hair milk|curl cream|edge control|deodorant|dry shampoo)\b/i;
export const drugstoreOff = (slug, p) => !slug.startsWith("store-") && !/\bgift ?sets?\b|\bgift box\b|\bholiday (set|kit)\b/i.test(String(p.name ?? ""))
  && (DRUGSTORE_BRAND.test(String(p.brand ?? "").trim()) || DRUGSTORE_BRAND.test(String(p.name ?? "").split(/\s+/).slice(0, 2).join(" ")) || DRUGSTORE_BRAND.test(String(p.name ?? "").split(/\s+/)[0]))
  && DRUGSTORE_ITEM.test(String(p.name ?? ""));

/**
 * OWNER REMOVALS 11-19 ("you can find cuter more popular things than this"): MASON New York diamond jewelry leaves the
 * people and budget guides (its store page stays); Re/Done tees leave every guide; and lashes: at most one lash item
 * on a guide, never in its top 12 (lashOff drops True Beauty Lashes' "Holiday Glam Styles"; LASH marks the rest).
 */
export const masonOff = (slug, p) => ["By person", "By budget"].includes(GUIDE_GROUPS.get(slug)) && /^mason new york$/i.test(String(p.brand ?? "").trim());
export const redoneOff = (slug, p) => !slug.startsWith("store-") && /^re\/?done$/i.test(String(p.brand ?? "").trim()) && /\b(tee|t-shirt|shirt)\b/i.test(String(p.name ?? ""));
export const LASH = /\b(lash(es)?|eyelash(es)?)\b/i;
export const lashOff = (slug, p) => !slug.startsWith("store-") && /holiday glam styles/i.test(String(p.name ?? "")) && /true beauty lashes/i.test(String(p.brand ?? ""));

/** Owner 11-19 ("remove the black vera bradley, add in BÉIS or other popular ones"): the Air Birdie Weekender goes. */
export const VERA_BRADLEY = /^vera bradley$/i;
export const veraBradleyOff = (slug, p) => !slug.startsWith("store-") && /\bair birdie weekender\b/i.test(String(p.name ?? ""));

/**
 * NO HIKING GEAR FOR HER (owner 11-19: "pretty ugly for women guides. no one hikes here its louisiana"): hiking gear and
 * hiking socks (Darn Tough, Smartwool hiking socks, trekking poles, hiking boots, trail packs) show only on the Hiker,
 * Camper, Mountain Lover and outdoors guides; Louisiana outdoors means fishing, hunting, boating and the Gulf.
 */
export const HIKING = /\b(hik(e|er|ers|ing)|trekking|trail (pack|runner|shoe)s?|backpacking|darn tough)\b|^darn tough$/i;
export const HIKING_OK_GUIDES = ["hiker", "camper", "mountain-lover", "outdoors-lover", "outdoorsman"];
export const hikingOff = (slug, p) => !slug.startsWith("store-") && !HIKING_OK_GUIDES.includes(slug)
  && (HIKING.test(String(p.name ?? "")) || /^darn tough( vermont)?$/i.test(String(p.brand ?? "").trim()) || (/^smartwool$/i.test(String(p.brand ?? "").trim()) && /\bhik/i.test(String(p.name ?? ""))));

/**
 * STAGE-1 OWNER RULES 11-19 ("why would you put this on womens guides"): cheap novelty socks (character or licensed
 * no-shows, any socks under $10) show only on kids guides and Stocking Stuffers; barware and cocktail shakers only on
 * men's guides, Hostess and Entertainer; fashion sneakers (adidas Gazelle / Samba, Veja, New Balance 530) never on the
 * men's guides ("men do not wear this in louisiana").
 */
export const SOCKS = /\bsocks?\b|\bno-?shows?\b/i;
export const NOVELTY_SOCK = /\b(nightmare before christmas|hello kitty|disney|marvel|star wars|grinch|peanuts|snoopy|sanrio|minecraft|pok[eé]mon|barbie|licensed|character|novelty|funny)\b|\bno-?show\b.*\b\d+[- ]?pack\b|\b\d+[- ]?pack\b.*\bno-?show\b/i;
export const SOCK_OK_GUIDES = ["stocking-stuffers", "kids", "girls", "boys", "gender-neutral"];
export const cheapSockOff = (slug, p) => !slug.startsWith("store-") && !SOCK_OK_GUIDES.includes(slug) && GUIDE_GROUPS.get(slug) !== "For kids"
  && SOCKS.test(String(p.name ?? "")) && (NOVELTY_SOCK.test(String(p.name ?? "")) || (typeof p.price === "number" && p.price < 10));
export const BARWARE = /\b(cocktail (shaker|set|kit)s?|shakers? set|bar (tool|set|kit)s?|happy hour (shaker|set)|whiskey stones|decanter|jigger|muddler|bar cart)\b|\bstanley\b.*\bshaker\b/i;
export const BARWARE_OK_GUIDES = ["dad", "him", "boyfriend-or-husband", "grandpa", "brother", "father-in-law", "uncle", "brother-in-law", "hostess", "entertainer", "bartenders", "wine-lover", "new-homeowner"];
export const barwareOff = (slug, p) => !slug.startsWith("store-") && !BARWARE_OK_GUIDES.includes(slug) && BARWARE.test(String(p.name ?? ""));
export const FASHION_SNEAKER = /\b(gazelle|samba|campo|veja|new balance 530|nb 530|\b530 sneakers?|air force 1|af1|dunk low|jordan 1)\b|^veja$/i;
export const MEN_FAMILY_GUIDES = ["him", "dad", "boyfriend-or-husband", "grandpa", "brother", "father-in-law", "uncle", "brother-in-law"];
export const fashionSneakerOff = (slug, p) => MEN_FAMILY_GUIDES.includes(slug) && (FASHION_SNEAKER.test(String(p.name ?? "")) || /^veja$/i.test(String(p.brand ?? "").trim())
  // Owner 11-19 ("think more outdoors hunting fishing"): no Pura Vida string bracelets on the men's guides.
  || /^pura vida( bracelets)?$/i.test(String(p.brand ?? "").trim())
  // ... and no Warby Parker ("men dont wear warby parker here"); men's sunglasses are Costa, Oakley, Maui Jim, Pelagic.
  || /^warby parker$/i.test(String(p.brand ?? "").trim()) || /\bwarby parker\b/i.test(String(p.name ?? "")))
  // Prescription glasses are no gift on any guide (pre-launch audit 11-19: Warby Parker frames on RNs).
  || (!slug.startsWith("store-") && /^warby parker$/i.test(String(p.brand ?? "").trim()) && /\b(glasses|frames?|eyeglasses|prescription)\b/i.test(String(p.name ?? "")));

/** Owner 11-19 ("remove"): FARM Rio's busy prints leave the people guides; Pura Vida's Engravable Bar Bracelet goes. */
export const farmRioOff = (slug, p) => (!slug.startsWith("store-") && /^farm rio$/i.test(String(p.brand ?? "").trim()))
  || (!slug.startsWith("store-") && /\bengravable bar bracelet\b/i.test(String(p.name ?? "")));
/** Owner 11-19 ("no grandma wants legos"): no LEGO, Botanicals and adult sets included, on the grandparent guides. */
// Broadened 11-19 ("remove any legos for adults"): LEGO only on the kids, age, niece, nephew and teens guides.
export const LEGO_OK = (slug) => GUIDE_GROUPS.get(slug) === "For kids" || ["kids", "niece", "nephew", "cousins"].includes(slug) || /teens$/.test(slug);
export const legoOff = (slug, p) => !slug.startsWith("store-") && !LEGO_OK(slug) && /\blego\b/i.test(`${p.name} ${p.brand ?? ""}`);
/** Owner 11-19 ("remove from grandpa", Ray-Ban aviators with yellow lenses): no sunglasses on the grandparent guides. */
export const grandSunglassesOff = (slug, p) => ["grandma", "grandpa", "grandparents", "new-grandparent"].includes(slug) && /\b(sunglasses|aviators?|wayfarers?|ray-?ban)\b/i.test(`${p.name} ${p.brand ?? ""}`);
/** Owner 11-19 ("remove digital photo from grandpa"): a digital photo frame shows only on Grandma or Grandparents. */
export const DIGITAL_FRAME = /\b(digital (photo |picture )?frames?|smart (photo )?frames?|wi-?fi (photo )?frames?)\b|\b(aura|skylight|nixplay)\b[^,]*\bframes?\b|^aura carver|\bcarver mat\b/i;
export const frameOff = (slug, p) => !slug.startsWith("store-") && !["grandma", "grandparents"].includes(slug) && DIGITAL_FRAME.test(`${p.name} ${p.brand ?? ""}`);
/**
 * FOOD SUBSCRIPTIONS (owner 11-19: "I have seen way too many fruit subscriptions"): fruit, food, cheese and snack
 * clubs show only on Treats & Food Gifts (at most FOOD_SUB_MAX.treats) and Subscriptions (at most one).
 */
export const FOOD_SUB = /\b(fruit|cheese|snack|cookie|chocolate|candy|jerky|bacon|meat|steak|wine|beer|coffee|tea|pie|cake|bakery|popcorn|salsa|hot sauce|pickle|olive oil|nut|ice cream)\b[^,]*\b(of the month|club|subscriptions?|monthly|delivery|box)\b|\b(amazing clubs|monthlyclubs|monthly clubs|fruit of the month)\b/i;
export const FOOD_SUB_MAX = { "treats-and-food-gifts": 2, subscriptions: 1 };
export const isFoodSub = (p) => FOOD_SUB.test(`${p.name} ${p.brand ?? ""}`) && !/\b(coffee|tea) (maker|mug|tumbler|grinder)\b/i.test(String(p.name ?? ""));
export const foodSubOff = (slug, p) => !slug.startsWith("store-") && !(slug in FOOD_SUB_MAX) && isFoodSub(p);
/**
 * Owner 11-19: "remove the ice cream from all guides" (shipped pints and ice cream gift boxes, the Treats guide too; a
 * CREAMi machine is an appliance) and the basic Crock-Pot ("there are a lot more high tech ones than that").
 */
export const SHIPPED_ICE_CREAM = /\b(ice cream|gelato)\b[^,]*\b(pints?|gift|box|sampler|collection|pack|delivery|club)\b|\bpints?\b[^,]*\bice cream\b|^(ecreamery|jeni'?s( splendid ice creams)?|salt (&|and) straw|mcconnell'?s( fine ice creams)?|van leeuwen)$/i;
export const iceCreamOff = (slug, p) => !slug.startsWith("store-") && !/\b(maker|machine|creami|scoop|bowl)\b/i.test(String(p.name ?? ""))
  && (SHIPPED_ICE_CREAM.test(String(p.name ?? "")) || SHIPPED_ICE_CREAM.test(String(p.brand ?? "").trim()));
export const crockPotOff = (slug, p) => !slug.startsWith("store-") && /\bcrock-?pot\b/i.test(`${p.name} ${p.brand ?? ""}`) && !/\b(smart|wi-?fi|app)\b/i.test(String(p.name ?? ""));
/**
 * Owner 11-19 screenshots: photos that showed as blank boxes on the live men's guides (Southern Tide's Skipjack Polo
 * ShopMy pin, Stanley's 12 oz camp mug PNG; both answer 200 to curl, cause not yet confirmed) leave the people guides,
 * and a pastel cooler or drinkware is no men's gift ("a man does not want this girly looking ice chest").
 */
export const BLANK_ON_LIVE = new Set([
  "https://static.shopmy.us/pins/zoom-107566377-1795058601800-skipjack-polo-shirt-sea-pink-sea-pink-lifestyle-8900.jpg",
  "https://cdn.shopify.com/s/files/1/0375/3269/6635/files/Web_PNG_Square-TheStay-HotCampMug12OZ-Shale-Front.png",
]);
export const PASTEL = /\b(mint|cream|pink|blush|rose( quartz)?|lavender|lilac|peach|pastel|seafoam|sky blue|baby blue|coral|petal|orchid|shale)\b|stanley the easy carry outdoor cooler/i;
export const blankOrPastelOff = (slug, p) => !slug.startsWith("store-") && (BLANK_ON_LIVE.has(String(p.image ?? ""))
  || (MEN_FAMILY_GUIDES.includes(slug) && /\b(coolers?|ice chest|tumblers?|mugs?|bottles?|quencher|rambler)\b/i.test(String(p.name ?? "")) && PASTEL.test(`${p.name} ${p.image ?? ""}`)));
/** Owner 11-19 ("there are too many digital photobooks"): photo books and custom photo products only on New Parents /
 *  Grandparents guides; with the one frame (frameOff), at most 2 site-wide (capped in the import, 2026-11-19). */
export const PHOTO_PRODUCT = /\b(photo ?books?|custom photo|photo (album|blanket|canvas|calendar|print|mug|pillow|puzzle|ornament)s?|picture book (custom|personalized))\b|^(shutterfly|artifact uprising|mixbook|chatbooks|snapfish|minted)$/i;
export const PHOTO_BOOK_GUIDES = ["new-mom", "new-dad", "grandparents", "new-grandparent"];
export const photoProductOff = (slug, p) => !slug.startsWith("store-") && !PHOTO_BOOK_GUIDES.includes(slug)
  && (PHOTO_PRODUCT.test(String(p.name ?? "")) || PHOTO_PRODUCT.test(String(p.brand ?? "").trim()));
/** Owner 11-19 ("too many puzzles"): jigsaw puzzles only from Ravensburger or Galison (or a Louisiana-themed one on a
 *  Louisiana guide), at most PUZZLE_MAX site-wide (capped in the import), never in a people guide's top 12. */
export const JIGSAW = /\b(jigsaw|\d{3,4}[- ]?(piece|pc)s?\b[^,]*\bpuzzles?|puzzles?\b[^,]*\b\d{3,4}[- ]?(piece|pc)s?)\b/i;
export const PUZZLE_BRAND = /^(ravensburger|galison)$/i;
export const PUZZLE_MAX = 3;
export const puzzleOff = (slug, p) => !slug.startsWith("store-") && JIGSAW.test(String(p.name ?? ""))
  && !PUZZLE_BRAND.test(String(p.brand ?? "").trim()) && !(GUIDE_GROUPS.get(slug) === "Louisiana" && LOUISIANA_THEME.test(String(p.name ?? "")));

/** Owner 11-19 ("remove", Jelly Belly 8 oz at $5): cheap grocery candy (bags and checkout candy under $15) shows on no
 *  guide, the Treats guide included. */
export const GROCERY_CANDY = /\b(jelly beans?|gummies|gummy|candy (bag|canes?|tube|bar)s?|chocolate bars?|m&m'?s|skittles|starburst|sweetarts|reese'?s|hershey'?s|kit ?kat|twix|snickers|peppermint bark squares|candy)\b/i;
export const groceryCandyOff = (slug, p) => !slug.startsWith("store-") && GROCERY_CANDY.test(`${p.name} ${p.brand ?? ""}`)
  && (typeof p.price !== "number" || p.price < 15) && !/\b(gift (box|set|tin)|assortment|collection box)\b/i.test(String(p.name ?? "")) || (!slug.startsWith("store-") && /^jelly belly$/i.test(String(p.brand ?? "").trim()) && /\b8 ?oz\b/i.test(String(p.name ?? "")));
/** Owner 11-19 ("lots of more popular cups to replace this one"): no JD Sports drinkware listing on any guide. */
export const jdDrinkwareOff = (slug, p) => !slug.startsWith("store-") && /^jd sports$/i.test(String(p.retailer ?? p.store ?? "").trim().replace(/^store-/, "").replace(/-/g, " "))
  && /\b(tumblers?|quencher|bottles?|mugs?|cups?|flowstate)\b/i.test(String(p.name ?? ""));
