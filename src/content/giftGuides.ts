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
export const BRAND_SITES = ["www.zchocolat.com", "www.diecastmodelswholesale.com"] as const;

/**
 * Louisiana shops and 25 Days sponsors the researched picks link to (lead 2026-11-18, ~/Desktop/Gift-guide-picks:
 * each link a product page from the shop's own list, HTTP 200 when opened). Exact hosts, never a wildcard.
 */
export const LOUISIANA_SHOPS = ["dirtycoast.com", "fleurtygirl.com", "nolacouture.com", "www.communitycoffee.com", "auntsallys.com", "www.krewe.com", "leahspralines.com", "southernmarsh.com", "gambinos.com", "crew-dog.com", "www.cajunpowersauce.com", "www.zydecochopchop.com", "shop.tabasco.com", "www.dirtycoast.com", "www.leahspralines.com", "shop.cafedumonde.com", "www.frenchtruckcoffee.com", "www.cajungrocer.com", "www.camelliabrand.com", "www.steenssyrup.com", "randazzokingcake.com", "southerncandymakers.com", "redstickspice.com", "dupuys.com", "poches.com", "savoiesfoods.com", "www.ripvanwinklegardens.com", "www.theoilcenter.com"] as const;

/**
 * Brands made in Louisiana: only these get the "Louisiana-made" badge (a pick marked louisianaFit that is not one of
 * them, e.g. YETI, gets none). Each is a Louisiana company making the product in Louisiana.
 */
export const LOUISIANA_MADE_BRANDS = ["Dirty Coast", "Fleurty Girl", "Café Du Monde", "Tony Chachere's", "Community Coffee", "NOLA Couture", "Aunt Sally's", "KREWE", "Leah's Pralines", "Southern Marsh", "Slap Ya Mama", "Zatarain's", "Joe Gambino's Bakery", "Cajun Power", "Savoie's", "Zapp's", "Magic Seasoning Blends", "French Market", "TABASCO", "Camellia Brand", "Steen's", "Kary's", "Abita", "Crystal", "Blue Plate", "Louisiana Fish Fry", "Bruce's", "Cafe Du Monde", "French Truck Coffee", "Red Stick Spice Company", "Panola Pepper Co.", "Poche's", "Randazzo King Cake", "Southern Candymakers"];

/** The 25 Days of Giveaways sponsors among the picks' brands: their picks get the "25 Days sponsor" badge. */
export const SPONSOR_BRANDS = ["Crew Dog", "Zydeco Chop Chop"];

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
}
export const discountCodes: DiscountCode[] = [
  { rank: 1, store: "Muck Boot", code: "CYBER", offer: "20% off sitewide", dates: "Nov 29 – Dec 6", expires: "2026-12-06" },
  { rank: 1, store: "Muck Boot", code: "TAKE25", offer: "25% off everything (Black Friday)", dates: "Nov 20 – 28", expires: "2026-11-28" },
  { rank: 2, store: "Durango Boots", code: "TAKE30", offer: "30% off sitewide; free shipping on $99+" },
  { rank: 3, store: "Magnifique", code: "LEXI10", offer: "10% off; stacks with eligible promotions" },
  { rank: 4, store: "Free Country", code: "WINTER50", offer: "Up to 50% off pet jackets" },
  { rank: 5, store: "Bruno Marc", code: "GREEN20", offer: "20% off sitewide" },
  { rank: 6, store: "HerbsPro", code: "SAVE70", offer: "Extra 70% off all products" },
  { rank: 7, store: "Parallels Desktop", code: "PD50", offer: "50% off Standard and Pro (new 1-year licenses)", expires: "2026-11-23" },
  { rank: 7, store: "Parallels Desktop", code: "PD35", offer: "35% off Business Edition (new 1-year licenses)", expires: "2026-11-23" },
];

/** The codes still good on `today` (YYYY-MM-DD, local): a code is shown through its `expires` day. */
export const activeCodes = (codes: DiscountCode[], today: string) => codes.filter((c) => !c.expires || c.expires >= today);

/** One box per store, by rank (owner 2026-11-18: a store with two codes shows both in one box). */
export const codesByStore = (codes: DiscountCode[]) => {
  const stores = new Map<string, DiscountCode[]>();
  for (const c of [...codes].sort((a, b) => a.rank - b.rank)) stores.set(c.store, [...(stores.get(c.store) ?? []), c]);
  return [...stores.entries()].map(([store, list]) => ({ store, codes: list }));
};

export const giftGuides = {
  /** The page header's short title; the band carries the full one. */
  pageTitle: "Gift guides",
  bandLead: "top-rated finds",
  title: "Holiday Gift Guides",
  disclosure: "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.",
  /** Amazon Associates Operating Agreement: the exact statement every site with Amazon links must show. */
  amazonStatement: "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.",
  allGuidesLabel: "All guides",
  sidebarLabel: "Gift guides",
  seeAllLabel: "See all",
  shopLabel: "Shop",
  fullGuideLabel: "Shop the full guide",
  newTab: "opens in a new tab",
  onStore: (store: string) => `On ${store}`,
  /** The pick badges (owner 2026-11-18). Never a price. */
  badges: { trending: "Trending", "louisiana-made": "Louisiana-made", sponsor: "25 Days sponsor", "ships-fast": "Ships fast", "local-pickup": "Local pickup" },
  myListLabel: "My list",
  myListEmpty: "Tap a heart on any guide or gift to save it here.",
  searchNone: "No guides match. Try another word.",
  codesLabel: "Discount codes",
  copyCode: "Copy",
  copiedCode: "Copied",
  codeEnds: (date: string) => `Ends ${date}`,
  codeValid: (dates: string) => `Valid ${dates}`,
  comingSoonTitle: "Picks coming soon",
  comingSoonBody: "We're gathering the best gifts for this guide. Check back soon, or browse another guide.",
  allLinks: [
    { label: "Every collection on ShopMy", href: "https://shopmy.us/shop/lexilombas" },
    { label: "Every gift guide on Pinterest", href: `${PIN}/gift-guides/` },
  ] satisfies GiftLink[],

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
        {
          name: "zChocolat French chocolates",
          line: "French chocolate gift boxes, for the chocolate lover.",
          image: "https://www.zchocolat.com/img/menu/featured-assortments.jpg",
          href: "https://www.zchocolat.com/",
        },
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
        {
          name: "DiecastModelsWholesale.com model cars",
          line: "Diecast model cars, for collectors.",
          image: "https://cdn11.bigcommerce.com/s-4df9uz5/images/stencil/500x659/carousel/22/shop_all__28122.jpg",
          href: "https://www.diecastmodelswholesale.com/",
        },
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
