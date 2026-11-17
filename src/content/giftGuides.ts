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
 *   - Every link is https and on shopmy.us, pinterest.com, or a brand site in BRAND_SITES. The page gives every one
 *     rel="sponsored noopener" and opens it in a new tab.
 *   - Never invent a product, a price or a claim. No prices here at all: they change, and a stale one misleads.
 *   - A section with no confirmed ShopMy collection links to the Pinterest board instead.
 *   - `disclosure` is the FTC affiliate disclosure (16 CFR Part 255). Keep it plain and keep it near the top.
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

const shopmy = (id: number) => `https://shopmy.us/collections/${id}`;
const img = (path: string) => `https://static.shopmy.us${path}`;
const PIN = "https://www.pinterest.com/lexilombas";

const MOM = shopmy(8978491);
const DAD = shopmy(8987388);
const TODDLERS = shopmy(9000035);
const NEW_HOMEOWNER = shopmy(8988205);
const LOUISIANA_PANTRY = shopmy(9000334);

export const giftGuides = {
  title: "Holiday Gift Guides 2026",
  intro: "Gift ideas for everyone on your list. Pick a guide, then shop the full collection.",
  disclosure: "Some links are affiliate links. We may earn a small commission at no extra cost to you.",
  shopLabel: "Shop",
  fullGuideLabel: "Shop the full guide",
  moreLabel: "More guides:",
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
          image: img("/pins/zoom-103906626-1794380185104-7463182f-3d64-4bba-98b2-08572887c09a.jpeg"),
          href: MOM,
        },
        {
          name: "Le Creuset Signature 7.25-Qt. Round Dutch Oven",
          line: "A Dutch oven from the Gifts for Mom guide.",
          image: img("/pins/zoom-104050519-1794418254578-.jpg"),
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
          image: img("/uploads/pretty-prod-1764742009311"),
          href: DAD,
        },
        {
          name: "YETI Roadie 24 2.0 Hard Cooler",
          line: "A hard cooler from the Gifts for Dad guide.",
          image: img("/uploads/pretty-prod-1765315393509"),
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
          image: img("/uploads/pretty-prod-1789686406501"),
          href: TODDLERS,
        },
        {
          name: "LEGO DUPLO Animal Train 10412",
          line: "A DUPLO set from the Gifts for Toddlers guide.",
          image: img("/uploads/pretty-prod-1794219508743"),
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
          image: img("/uploads/img-product-1793059152298"),
          href: NEW_HOMEOWNER,
        },
        {
          name: "Millwood Pines Esenia Acacia Charcuterie Board",
          line: "A charcuterie board from the Gifts for the New Homeowner guide.",
          image: img("/pins/zoom-103905152-1794379486075-.jpg"),
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
          image: img("/pins/zoom-104066048-1794420042859-124391_XXX_v1.jpg"),
          href: LOUISIANA_PANTRY,
        },
        {
          name: "Tony Chachere's Original Creole Seasoning, 17 oz",
          line: "Creole seasoning from the Louisiana Pantry guide.",
          image: img(
            "/pins/zoom-13310115-1739836672681-Tony-Chachere-s-Creole-Original-Seasoning-17-Oz_9eefe6d3-49c2-4b4e-aecd-3df46b2eb053.417856d4f5ed70d8391fb53bbd414e01.jpeg",
          ),
          href: LOUISIANA_PANTRY,
        },
      ],
    },
  ] satisfies GiftSection[],
};
