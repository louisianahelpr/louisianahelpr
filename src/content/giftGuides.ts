/**
 * /gift-guides: EVERY word, pick and link on the Holiday Gift Guides page lives in this one file (owner 2026-11-16:
 * "i think we should add this to our landing pages on louisiana helpr so people can see our gift guides"; pop-up
 * choice "New gift guide page"). Edit here; nothing else needs to change.
 *
 * Where the links come from (read 2026-11-16 from the owner's own accounts, never invented):
 *   - ShopMy collections: shopmy.us/shop/lexilombas, "Gift Guides" and "Louisiana" tabs. Each collection opens at
 *     https://shopmy.us/collections/<id>.
 *   - Pinterest boards and sections: pinterest.com/lexilombas ("Gift Guides", "Amazon Gift Guides").
 *   - Each pick is a real product in the collection its `href` opens, and its `image` is that product's photo on
 *     ShopMy's image host. A pick's Shop link opens the collection the product sits in.
 *
 * Rules (src/test/giftGuidesPage.test.tsx checks them):
 *   - Every link is https and on shopmy.us, pinterest.com, amazon.com / amzn.to, or a brand site in BRAND_SITES. The
 *     page gives every one rel="sponsored noopener" and opens it in a new tab. Every Amazon link carries
 *     tag=louisianahelpr-20 (the Amazon guides live in src/content/giftGuidesAmazon.ts).
 *   - Never invent a product, a price or a claim. No prices here at all: they change, and a stale one misleads.
 *   - A section with no confirmed ShopMy collection links to the Pinterest board instead.
 *   - `disclosure` is the FTC affiliate disclosure (16 CFR Part 255) and `amazonStatement` the exact line the Amazon
 *     Associates Operating Agreement requires. Both sit at the BOTTOM of the page as plain lines (owner 2026-11-18).
 */

export interface GiftLink {
  label: string;
  href: string;
  /** Another guide's collection (Her lists Mom, Sister, Aunt, Friends): shown under "More on ShopMy", never as this guide's own. */
  related?: boolean;
}

export interface GiftPick {
  /** The product's name as the collection lists it. */
  name: string;
  /** One short line: what the thing is. No price, no claim we have not checked. */
  line: string;
  /** The product photo (https). Shown lazy-loaded at a fixed size. */
  image: string;
  /** Where "Shop" goes: the collection holding this product, or the brand's own site (BRAND_SITES). */
  href: string;
}

export interface GiftSection {
  id: string;
  title: string;
  line: string;
  /** The section's main link: its full guide. */
  shop: GiftLink;
  /** More guides for the same section. */
  more: GiftLink[];
  picks: GiftPick[];
}

/**
 * Brand sites the owner approved as picks (owner via the lead, 2026-11-16: zChocolat, approved on CJ; and
 * DiecastModelsWholesale.com). Plain site links for now; the lead swaps in the CJ tracking links later. Each image is
 * one the brand's own home page shows.
 */
// 1530 train (lead 11-19): zChocolat left the For Her row and DiecastModelsWholesale is blocked; no link uses either host.
// Big batch 1120 (lead, from the owner): the small nurse and RT shops she asked for by name before the "only where we
// earn" rule (21 Collective, a 25 Days sponsor with code COLLECTIVE10; Seven2seven; Monochromatic Finds badge reels;
// Vix Socks), shown on their own sites at 0% and sorted by commission like every pick (so they sit lower).
// Follow-up 1120 (owner: no 0% pick but a sponsor's): the owner-named nurse shops were swapped for earning picks.
export const BRAND_SITES = [] as const;

/**
 * The affiliate networks' link hosts a pick's `affiliate_href` may use (follow-up batch 2026-11-18: Later/Mavely,
 * Walmart Creator, CJ, Awin, Rakuten, ShopMy product links). Exact hosts; two-way (each is used by some link).
 */
export const AFFILIATE_HOSTS = ["mavely.app.link", "walmrt.us", "www.anrdoezrs.net", "click.linksynergy.com", "go.shopmy.us", "samsclub.co"] as const;

/**
 * Louisiana shops and 25 Days sponsors the researched picks link to (lead 2026-11-18, ~/Desktop/Gift-guide-picks:
 * each link a product page from the shop's own list, HTTP 200 when opened). Exact hosts, never a wildcard.
 */
// Follow-up 1120 (owner 11-20 ~12:05 AM): a 0% Louisiana shop shows only when it is a 25 Days sponsor, so the
// non-sponsor shops' hosts left with their picks (Dirty Coast, Fleurty Girl, NOLA Couture, Aunt Sally's, KREWE ...).
export const LOUISIANA_SHOPS = ["crew-dog.com", "dupuys.com", "www.ripvanwinklegardens.com"] as const;

/**
 * Brands made in Louisiana: only these get the "Louisiana-made" badge (a pick marked louisianaFit that is not one of
 * them, e.g. YETI, gets none). Each is a Louisiana company making the product in Louisiana.
 */
export const LOUISIANA_MADE_BRANDS = ["Dirty Coast", "Fleurty Girl", "Café Du Monde", "Tony Chachere's", "Community Coffee", "NOLA Couture", "Aunt Sally's", "KREWE", "Leah's Pralines", "Southern Marsh", "Slap Ya Mama", "Zatarain's", "Joe Gambino's Bakery", "Cajun Power", "Savoie's", "Zapp's", "Magic Seasoning Blends", "French Market", "TABASCO", "Camellia Brand", "Steen's", "Kary's", "Abita", "Crystal", "Blue Plate", "Louisiana Fish Fry", "Bruce's", "Cafe Du Monde", "French Truck Coffee", "Red Stick Spice Company", "Panola Pepper Co.", "Poche's", "Randazzo King Cake", "Southern Candymakers"];

/**
 * The 25 Days of Giveaways sponsors' own sites (lead 2026-11-18, ~/Desktop/Gift-guide-picks/25-days-sponsors.json):
 * the sponsors guide links each sponsor's gift. Exact hosts, never a wildcard.
 */
// Follow-up 1120 (owner 11-20 ~12:40 AM): every confirmed Louisiana sponsor on Shop Small Louisiana links its website,
// Facebook or Instagram (src/content/giftGuideSmallBiz.json); City Sightseeing New Orleans on Louisiana by Region.
// Owner's standard plan (11-20 evening) + holiday audit B (a name-only sponsor is never carded): Shop Small Louisiana cards
// the 10 sponsors with a shop photo, so the 14 hosts no card links any more left this list (hotworx, Mary Kay, Facebook,
// Instagram and the sponsors' own sites); a sponsor carded again adds its host back.
export const SPONSOR_SITES = ["thestrandtheatre.com", "basicbee.co", "www.zydecochopchop.com", "www.faulkcalls.com", "www.writtenontheriver.com", "www.rozlecompte.com", "meganbenoitscloset.com", "www.lepetittheatre.com", "www.theallwayslounge.net", "citysightseeingneworleans.com"] as const;
/**
 * The national 25 Days sponsors' own shops (train 1120b, owner 11-20 ~8:35 AM: each gets one best-fit guide spot with
 * the sponsor badge, 0% allowed). Kept apart from SPONSOR_SITES, which are Louisiana businesses: a Louisiana host's
 * pick stays in the Louisiana section, a national sponsor's does not.
 */
export const NATIONAL_SPONSOR_SITES = ["homerunpet.com", "www.drinkryse.com", "www.rockbottomgolf.com", "www.timelessha.com", "gentlestylebrush.com", "srilabs.com", "thesculptsociety.com", "aevabeauty.com", "www.k18hair.com", "www.katemcleod.com", "mantasleep.com", "drinklmnt.com", "www.oyubotanica.com", "iokaskinscience.com", "saltycat.com", "mindtheskinlabs.com", "idrawellness.com", "arey.com", "bostonmints.com", "www.hilma.co", "saranoni.com", "skyandsol.co", "criquetshirts.com", "www.aosulife.com", "catlady.com", "www.demingdelights.com", "21collectiveco.com"] as const;

/** The 25 Days of Giveaways sponsors among the picks' brands: their picks get the "25 Days sponsor" badge. */
export const SPONSOR_BRANDS = ["Crew Dog", "Zydeco Chop Chop", "21 Collective"];

const shopmy = (id: number) => `https://shopmy.us/collections/${id}`;
const PIN = "https://www.pinterest.com/lexilombas";

const MOM = shopmy(8978491);
const DAD = shopmy(8987388);
const TODDLERS = shopmy(9000035);
const NEW_HOMEOWNER = shopmy(8988205);
const LOUISIANA_PANTRY = shopmy(9000334);

/**
 * Every collection on the owner's ShopMy shop (read 2026-11-18 from shopmy.us/shop/lexilombas, one fetch per
 * collection; collection 9000043 answered 502 and is left out). Each becomes a guide or the "full guide" link of the
 * matching guide (src/content/giftGuideCatalog.ts).
 */
export const SHOPMY_COLLECTIONS: { id: number; label: string }[] = [
  { id: 8978491, label: "Gifts for Mom" },
  { id: 8987388, label: "Gifts for Dad" },
  { id: 8987440, label: "Gifts for Sister" },
  { id: 8987483, label: "Gifts for Friends" },
  { id: 8987524, label: "Gifts for Aunt" },
  { id: 8987579, label: "Gifts for Grandparents" },
  { id: 8987631, label: "Gifts for Cousins" },
  { id: 8987711, label: "Gifts for Female Nurses" },
  { id: 8987757, label: "Gifts for Teachers" },
  { id: 8987879, label: "Louisiana Kitchen" },
  { id: 8987928, label: "Gifts for Hunters" },
  { id: 8987957, label: "Gifts for Fishermen" },
  { id: 8987968, label: "Gifts for Boys" },
  { id: 8987983, label: "Gifts for Girls" },
  { id: 8987998, label: "Gifts for Teens" },
  { id: 8988029, label: "Gifts for the Homebody" },
  { id: 8988040, label: "Gifts for the Beach Lover" },
  { id: 8988060, label: "Gifts for the Traveler" },
  { id: 8988084, label: "Gifts for Healthcare Workers" },
  { id: 8988105, label: "Gifts for Male Nurses" },
  { id: 8988114, label: "Gifts for the New Mom" },
  { id: 8988131, label: "Gifts for the New Dad" },
  { id: 8988150, label: "Gifts for Newlyweds" },
  { id: 8988183, label: "Gifts for the Newly Engaged" },
  { id: 8988205, label: "Gifts for the New Homeowner" },
  { id: 8988243, label: "Gifts for the Mountain Lover" },
  { id: 8988262, label: "Gifts for the Cat Person" },
  { id: 8988283, label: "Gifts for the Dog Lover" },
  { id: 8988297, label: "Gifts for the Workaholic" },
  { id: 8988306, label: "Gifts for the Pink Lover" },
  { id: 8988317, label: "Gifts for the Blue Lover" },
  { id: 8999988, label: "Gifts for the Coffee Lover" },
  { id: 9000033, label: "Gifts for Boyfriend or Husband" },
  { id: 9000034, label: "Gifts for Brother" },
  { id: 9000035, label: "Gifts for Toddlers" },
  { id: 9000036, label: "Gifts for Coworkers" },
  { id: 9000041, label: "Gifts for the Home Cook" },
  { id: 9000042, label: "Gifts for the Book Lover" },
  { id: 9000044, label: "Gifts for the Golfer" },
  { id: 9000046, label: "Gifts for the Gamer" },
  { id: 9000047, label: "Gifts for the Gardener" },
  { id: 9000334, label: "Louisiana Pantry" },
  { id: 9013686, label: "Creative Gifts for Big Sisters" },
];

export const shopmyCollection = (id: number) => shopmy(id);

/**
 * The owner's discount codes for the sidebar's "Discount codes" section (owner 2026-11-18). Copied from her list
 * (~/Desktop/Gift-guide-discount-codes-1118.json: each code is in a brand's own email to her, named there), offers
 * shortened to the brand's own words. Instant Funding is left out (owner). A code past `expires` hides itself.
 */
export interface DiscountCode {
  /** The store's place in the list: Louisiana popularity, most popular first (owner 2026-11-18). */
  rank: number;
  store: string;
  code: string;
  offer: string;
  /** When the code works, if the brand limited it ("Nov 29 – Dec 6"). */
  dates?: string;
  /** YYYY-MM-DD, the last day it works; from the next day it is hidden. */
  expires?: string;
  /** YYYY-MM-DD, the first day it works; until then it is hidden (affiliate sweep 11-18: Muck Boot CYBER showed early). */
  starts?: string;
}
export const discountCodes: DiscountCode[] = [
  { rank: 1, store: "Muck Boot", code: "CYBER", offer: "20% off sitewide", dates: "Nov 29 – Dec 6", starts: "2026-11-29", expires: "2026-12-06" },
  { rank: 1, store: "Muck Boot", code: "TAKE25", offer: "25% off everything (Black Friday)", dates: "Nov 20 – 28", starts: "2026-11-20", expires: "2026-11-28" },
  // Train 1120c (lead 11-20 11:31 AM, CJ): XTRATUF's Black Friday code, 25% off sitewide, free shipping on $99+.
  { rank: 1, store: "XTRATUF", code: "XT25", offer: "25% off sitewide (Black Friday); free shipping on $99+", dates: "Nov 20 – 29", starts: "2026-11-20", expires: "2026-11-29" },
  { rank: 2, store: "Durango Boots", code: "TAKE30", offer: "30% off sitewide; free shipping on $99+" },
  { rank: 3, store: "Magnifique", code: "LEXI10", offer: "10% off; stacks with eligible promotions" },
  { rank: 5, store: "Bruno Marc", code: "GREEN20", offer: "20% off sitewide" },
  // Follow-up batch 2026-11-18: the rest of her list (the brands' own codes for her; Instant Funding still left out).
  { rank: 8, store: "Everyday Dose", code: "ONBRAND-LEXI", offer: "10% off your first order; stacks with sales, one use per person" },
  { rank: 10, store: "Aurate", code: "LEXIL-20", offer: "20% off" },
  { rank: 11, store: "Camp Snap", code: "LEXILOMBAS7", offer: "7% off" },
  { rank: 12, store: "Bon Wellness", code: "LEXI20", offer: "20% off" },
  { rank: 13, store: "Club Recess", code: "LEXI15", offer: "15% off" },
  { rank: 14, store: "Thrive Creative", code: "LEXIL20", offer: "20% off" },
  { rank: 15, store: "YVO Warrior", code: "LEXI15", offer: "15% off" },
  { rank: 16, store: "Daily Crunch Snacks", code: "LEXI15", offer: "15% off" },
  // Affiliate sweep 11-18 #10: the brands in her code list that have a pick here (Bonheur's Celine Huggy Hoops, Spa
  // Days). EF Collection, Quip and The Foggy Dog have no pick, so their codes stay off. BLKFRIDAY35 is embargoed to Nov 26.
  { rank: 17, store: "Bonheur Jewelry", code: "SHOPMY25", offer: "25% off" },
  { rank: 17, store: "Bonheur Jewelry", code: "BONHEUR15", offer: "15% off" },
  { rank: 17, store: "Bonheur Jewelry", code: "BLKFRIDAY35", offer: "35% off (Black Friday)", dates: "From Nov 26", starts: "2026-11-26" },
  // Tushbaby confirmed LAHELPR25 for us (11-18 PM; we told the brand we'd list it): shows Dec 1, hides after Dec 25.
  { rank: 18, store: "Tushbaby", code: "LAHELPR25", offer: "25% off sitewide", dates: "Dec 1 – 25", starts: "2026-12-01", expires: "2026-12-25" },
];

/** The codes still good on `today` (YYYY-MM-DD, local): a code is shown through its `expires` day. */
export const activeCodes = (codes: DiscountCode[], today: string) => codes.filter((c) => (!c.expires || c.expires >= today) && (!c.starts || c.starts <= today));

/** One box per store, by rank (owner 2026-11-18: a store with two codes shows both in one box). */
export const codesByStore = (codes: DiscountCode[]) => {
  const stores = new Map<string, DiscountCode[]>();
  for (const c of [...codes].sort((a, b) => a.rank - b.rank)) stores.set(c.store, [...(stores.get(c.store) ?? []), c]);
  return [...stores.entries()].map(([store, list]) => ({ store, codes: list }));
};

export const giftGuides = {
  /** The header title on every gift guides page, by the back arrow (owner 11-21: "add holiday to gift guides where it is by the back arrow"). */
  headerTitle: "Holiday gift guides",
  title: "Holiday Gift Guides",
  /**
   * The landing's ONE set of ways in (owner 11-20 PM: "a tidy grid of nicely spaced cards, each with a good photo and
   * title"): a card per main group, its photo the named guide's own cover, its short line below the title; then the
   * smaller groups as a plain line of links. Every guide is one tap from its group's page.
   */
  browseTitle: "Browse the guides",
  /** The quiet line under a landing tile (lead 11-21): "36 gifts". */
  tileCount: (n: number) => `${n} ${n === 1 ? "gift" : "gifts"}`,
  moreTitle: "More guides",
  entries: [
    { row: "by-person", title: "By person", sub: "Mom, Dad, Her & Him", cover: "her" },
    { row: "for-kids", title: "For kids", sub: "Babies to teens", cover: "kids" },
    { row: "by-budget", title: "By budget", sub: "Under $25, $50 & more", cover: "gifts-by-budget" },
    { row: "louisiana", title: "Louisiana", sub: "Local food & shops", cover: "louisiana-food-gifts" },
    { row: "by-store", title: "By store", sub: "Target, Walmart & more", cover: "store-target" },
  ] as { row: string; title: string; sub: string; cover: string }[],
  dealsEntry: { title: "Deals", sub: "Sales & codes" },
  disclosure: "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.",
  /** Amazon Associates Operating Agreement: the exact statement every site with Amazon links must show. */
  amazonStatement: "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.",
  allGuidesLabel: "All guides",
  sidebarLabel: "Gift guides",
  /**
   * The left menu's links to the deals page's three day sections (owner 11-21). The ids are the section anchors of the
   * one deals page (src/content/giftGuideDeals.mjs DEAL_EVENTS on feat/guide-deals-bfcm-1121).
   */
  sideDeals: [
    { id: "black-friday", label: "Black Friday deals" },
    { id: "small-business-saturday", label: "Small Business Saturday" },
    { id: "cyber-monday", label: "Cyber Monday" },
  ],
  /** The left menu's entry for the 25 Days sponsors page (owner 11-21: "move 25 day sponsors to the left panel"). */
  sideSponsorsLabel: "25 Days sponsors",
  seeAllLabel: "See all",
  shopLabel: "Shop",
  /** Every item's visible Shop pill (holistic review 11-18 H4): "Shop at Amazon", or plain "Shop" with no store name. */
  shopAt: (store: string) => (store ? `Shop at ${store}` : "Shop"),
  /** The item card's Shop link, for screen readers (owner 11-21: the card shows only "Shop"). */
  shopSr: (name: string, store: string) => `${name}${store ? ` at ${store}` : ""}, opens in a new tab`,
  /** The kids age rows (holistic review 11-18 H1): the landing's For kids section and the Niece, Nephew and Cousins pages. */
  agesTitle: "Kids by age",
  byAgeLabel: "By age",
  ageHubLabels: { girls: "Girls", boys: "Boys", "gender-neutral": "Gender-neutral" } as Record<string, string>,
  /** The quick-pick chips under search on the landing (holistic review 11-18 M9). */
  quickPicksLabel: "Quick picks",
  kidsByAgeChip: "Kids by age",
  /** A guide's item count under its banner (holistic review 11-18 L3). */
  itemCount: (n: number) => `${n} ${n === 1 ? "gift" : "gifts"}`,
  /** Search results, in two groups (holistic review 11-18 H5). */
  searchGuidesTitle: "Guides",
  searchItemsTitle: "Gifts",
  searchItemIn: (guide: string) => `In ${guide}`,
  /** A store page's live deal sections (follow-up batch 2026-11-18), after its picks. */
  dealsTitle: "Deals and holiday shops",
  /** A deal's end date, "2026-11-22" -> "Ends Nov 22". */
  dealEnds: (ymd: string) => `Ends ${new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
  newTab: "opens in a new tab",
  onStore: (store: string) => `On ${store}`,
  /** A ShopMy collection link opens a page of many products, not this one (design audit r2 #3/#9): the row says so. */
  collectionOnShopMy: "Collection on ShopMy",
  /** The pick badges (owner 2026-11-18). Never a price. */
  badges: { trending: "Trending", tiktok: "Trending on TikTok", preorder: "Pre-order", "louisiana-made": "Louisiana-made", sponsor: "25 Days sponsor", "ships-fast": "Ships fast", "local-pickup": "Local pickup", "shop-louisiana": "Shop Louisiana" },
  alsoSponsoring: (names: string) => `Also sponsoring: ${names}`,
  /** A pick's checked price beside Shop (owner 11-18), rounded to the dollar: "~$24". Amazon too since owner 11-21. */
  priceApprox: (dollars: number) => `~$${dollars}`,
  /** One note per page under a list that shows prices: the oldest check date, "Nov 18". */
  pricesAsOf: (day: string) => `Prices as of ${day}, may change`,
  /** The landing's photo-card strip of the picks the most guides list, after the first guide rows (owner 11-18 PM). */
  topTitle: "Top 10 This Week",
  /** The landing's sponsor logo row (train 1120b, owner 11-20 ~8:40 AM; GiftGuideSponsorRow.tsx). No giveaway days. */
  sponsorRow: {
    title: "Our 25 Days sponsors",
    intro: "Thank you to the businesses giving away gifts in our 25 Days of Louisiana Giveaways.",
    allHref: "/gift-guides/25-days-sponsors",
    left: "Scroll sponsors left",
    right: "Scroll sponsors right",
    louisiana: "Louisiana",
    national: "National",
  },
  /** The 25 Days card on the landing (owner 2026-11-18). No shopper page exists yet, so it points to the Facebook page. */
  // Louisiana Holiday Hub (owner-approved 2026-11-20): the landing's link to /holidays.
  holidayHub: {
    title: "Louisiana Holiday Hub",
    body: "Christmas lights, parades and holiday events near you, and a Helpr when you need a hand.",
    cta: "See the Holiday Hub",
  },
  giveaways: {
    title: "25 Days of Louisiana Giveaways",
    body: "A new Louisiana giveaway every day, December 1 to 25. Follow us on Facebook so you don't miss one.",
    cta: "Follow on Facebook",
  },
  helpr: {
    title: "No time to wrap?",
    body: "Hire a local Helpr to wrap your gifts, assemble toys or hang the Christmas lights.",
    cta: "Post a job",
  },
  myListLabel: "My list",
  myListEmpty: "Tap a heart on any guide or gift to save it here.",
  searchNone: "No guides match. Try another word.",
  codesLabel: "Discount codes",
  /** The sidebar's Sales (follow-up 2026-11-18): every live store sale, soonest end first; each hidden after it ends. */
  salesLabel: "Sales",
  /** The Sales list shows its first few, then this button opens the rest (design audit r2 #10: 229 in one list). */
  allSalesLabel: (n: number) => `See all sales (${n})`,
  /**
   * The one slim icon row under every title (owner redesign 11-18 PM: "share text search list codes is too much buttons
   * right here"): search, My list and Share. Text and Copy link live in Share's menu; codes are a page section.
   */
  quickLabel: "Gift guide tools",
  searchLabel: "Search gift guides",
  searchPlaceholder: "Search guides",
  myListCount: (n: number) => `My list, ${n} saved`,
  shareLabel: "Share",
  shareMenuLabel: "Share options",
  copyLink: "Copy link",
  linkCopied: "Link copied",
  textGuide: "Text this guide",
  textGuides: "Text these guides",
  moreShare: "More ways to share",
  /** One collapsed section for every discount (owner 11-18 PM: "Codes should be a section with the other discount stuff"). */
  dealsAndCodesLabel: "Deals & codes",
  dealsCount: (deals: number, codes: number) => [deals ? `${deals} deal${deals === 1 ? "" : "s"}` : "", codes ? `${codes} code${codes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
  allCodesLabel: (n: number) => `See all codes (${n})`,
  /** A store page's compact deals list (live audit r3 #1): its first few rows, then this opens the rest. */
  allDealsLabel: (n: number) => `See all deals (${n})`,
  copyCode: "Copy",
  copiedCode: "Copied",
  codeEnds: (date: string) => `Ends ${date}`,
  codeValid: (dates: string) => `Valid ${dates}`,
  comingSoonTitle: "Picks coming soon",
  comingSoonBody: "We're gathering the best gifts for this guide. Check back soon, or browse another guide.",
  relatedTitle: "Try these guides",
  loadingPicks: "Loading picks…",
  /** Under a long list (design audit 11-18 #3: store-amazon drew 827 rows at once): the next 50. */
  showMorePicks: (left: number) => `Show more (${left} more)`,
  /** A merged guide's section links under its banner (1120): one per section, "Jump to" read by screen readers. */
  sectionNavLabel: "Jump to a section",
  /** A brand's discount code on its cards (1120: 21 Collective). */
  codeChip: (code: string) => `Code ${code}`,
  /** The budget filter inside every guide (owner-approved 11-19 9:05 PM). A pick with no checked price leaves a budget view. */
  budgetLabel: "Budget",
  budgetAll: "Any price",
  budgetUnder: (n: number) => `Under $${n}`,
  budgetNote: "Items without a checked price aren't shown in a budget view.",
  budgetNone: "Nothing in this budget yet. Try a higher one.",
  /** The price sort on Her, Him and Kids (owner 2026-11-21: "the guides should be able to be sorted by price"). */
  sortLabel: "Sort by price",
  sortLowHigh: "Price: low to high",
  sortHighLow: "Price: high to low",
  sections: [
    {
      id: "for-her",
      title: "For Her",
      line: "For mom, sisters, aunts and friends.",
      shop: { label: "Gifts for Mom", href: MOM },
      more: [
        { label: "Gifts for Sister", href: shopmy(8987440) },
        { label: "Gifts for Aunt", href: shopmy(8987524) },
        { label: "Gifts for Friends", href: shopmy(8987483) },
      ],
      picks: [
        {
          name: "UGG Women's Tasman II Slipper",
          line: "A slipper from the Gifts for Mom guide.",
          image: "https://static.shopmy.us/pins/zoom-103906626-1794380185104-7463182f-3d64-4bba-98b2-08572887c09a.jpeg",
          href: MOM,
        },
        {
          name: "Le Creuset Signature 7.25-Qt. Round Dutch Oven",
          line: "A Dutch oven from the Gifts for Mom guide.",
          image: "https://static.shopmy.us/pins/zoom-104050519-1794418254578-.jpg",
          href: MOM,
        },
        // Lead 11-19 (1530 train): the zChocolat box is off the For Her row.
      ],
    },
    {
      id: "for-him",
      title: "For Him",
      line: "For dad, your guy and brothers.",
      shop: { label: "Gifts for Dad", href: DAD },
      more: [
        { label: "Gifts for Boyfriend or Husband", href: shopmy(9000033) },
        { label: "Gifts for Brother", href: shopmy(9000034) },
      ],
      picks: [
        {
          name: "Solo Stove Ranger 2.0 Firepit",
          line: "A fire pit from the Gifts for Dad guide.",
          image: "https://static.shopmy.us/uploads/pretty-prod-1764742009311",
          href: DAD,
        },
        {
          name: "YETI Roadie 24 2.0 Hard Cooler",
          line: "A hard cooler from the Gifts for Dad guide.",
          image: "https://static.shopmy.us/uploads/pretty-prod-1765315393509",
          href: DAD,
        },
        // Lead 11-19 (1530 train): the diecast store is off the For Him row (DiecastModelsWholesale is on the blocklist).
      ],
    },
    {
      id: "for-kids",
      title: "For Kids and Little Ones",
      line: "For toddlers, girls, boys and teens.",
      shop: { label: "Gifts for Toddlers", href: TODDLERS },
      more: [
        { label: "Gifts for Girls", href: shopmy(8987983) },
        { label: "Gifts for Boys", href: shopmy(8987968) },
        { label: "Gifts for Teens", href: shopmy(8987998) },
      ],
      picks: [
        {
          name: "Yoto 4th Gen Player",
          line: "A kids' audio player from the Gifts for Toddlers guide.",
          image: "https://static.shopmy.us/uploads/pretty-prod-1789686406501",
          href: TODDLERS,
        },
        {
          name: "LEGO DUPLO Animal Train 10412",
          line: "A DUPLO set from the Gifts for Toddlers guide.",
          image: "https://static.shopmy.us/uploads/pretty-prod-1794219508743",
          href: TODDLERS,
        },
      ],
    },
    {
      id: "for-the-home",
      title: "For the Home",
      line: "For new homeowners, homebodies and home cooks.",
      shop: { label: "Gifts for the New Homeowner", href: NEW_HOMEOWNER },
      more: [
        { label: "Gifts for the Homebody", href: shopmy(8988029) },
        { label: "Gifts for the Home Cook", href: shopmy(9000041) },
      ],
      picks: [
        {
          name: "Brooklinen Essential Sheet Set",
          line: "A sheet set from the Gifts for the New Homeowner guide.",
          image: "https://static.shopmy.us/uploads/img-product-1793059152298",
          href: NEW_HOMEOWNER,
        },
        {
          name: "Millwood Pines Esenia Acacia Charcuterie Board",
          line: "A charcuterie board from the Gifts for the New Homeowner guide.",
          image: "https://static.shopmy.us/pins/zoom-103905152-1794379486075-.jpg",
          href: NEW_HOMEOWNER,
        },
      ],
    },
    {
      // No ShopMy stocking-stuffer collection yet: the Pinterest sections stand in (rule above).
      id: "stocking-stuffers",
      title: "Stocking Stuffers",
      line: "Little gifts that fit in a stocking.",
      shop: { label: "Stocking Stuffers on Pinterest", href: `${PIN}/amazon-gift-guides/stocking-stuffers/` },
      more: [{ label: "Gifts under $25 on Pinterest", href: `${PIN}/amazon-gift-guides/under-25/` }],
      picks: [],
    },
    {
      id: "louisiana-made",
      title: "Louisiana-made",
      line: "Pantry staples and kitchen favorites from home.",
      shop: { label: "Louisiana Pantry", href: LOUISIANA_PANTRY },
      more: [{ label: "Louisiana Kitchen", href: shopmy(8987879) }],
      picks: [
        {
          name: "Cafe Du Monde Coffee and Chicory",
          line: "Coffee from the Louisiana Pantry guide.",
          image: "https://static.shopmy.us/pins/zoom-104066048-1794420042859-124391_XXX_v1.jpg",
          href: LOUISIANA_PANTRY,
        },
        {
          name: "Tony Chachere's Original Creole Seasoning, 17 oz",
          line: "Creole seasoning from the Louisiana Pantry guide.",
          image: "https://static.shopmy.us/pins/zoom-13310115-1739836672681-Tony-Chachere-s-Creole-Original-Seasoning-17-Oz_9eefe6d3-49c2-4b4e-aecd-3df46b2eb053.417856d4f5ed70d8391fb53bbd414e01.jpeg",
          href: LOUISIANA_PANTRY,
        },
      ],
    },
  ] satisfies GiftSection[],
};
