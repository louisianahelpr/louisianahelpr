/**
 * The 25 Days sponsors guide's gift-type labels (owner 2026-11-22, consistency audit 1122 #9: "Show the gift type").
 * A sponsor row with no real value shows one short label IN THE PRICE SLOT, in the guides' "~$NN" position and style,
 * instead of a grey sub-line; a row with a captured price keeps its price. No dollar amount is ever made up.
 * One vocabulary, picked from each sponsor's lineup prize (src/content/sponsorPage.ts) and the tracker:
 *   - "Gift card": a gift card, gift certificate or shop credit;
 *   - "Experience": tickets, a stay, a cruise, a party, a membership or a month of classes;
 *   - "Session": a photo session, a class pass or a set of wellness sessions;
 *   - "Gift set": two or more items given together;
 *   - "Product": one item.
 * Keyed by the row's name in src/content/giftGuidePicks/25-days-sponsors.json. Guard:
 * src/test/giftGuideSponsorGiftType1122.test.tsx (every no-price row has a label; no label for a row that is gone).
 */
export const SPONSOR_GIFT_TYPE_LABELS = ["Gift card", "Experience", "Session", "Gift set", "Product"] as const;
export type SponsorGiftType = (typeof SPONSOR_GIFT_TYPE_LABELS)[number];

export const SPONSOR_GIFT_TYPES: Readonly<Record<string, SponsorGiftType>> = {
  // Louisiana Shops & Makers
  "The Fois": "Product", // a Fois Christmas sweater or the wooden Fois roux spoon
  "Cher Bebe Embroidery": "Gift set",
  "Wicks NOLA Candle Company": "Product",
  "Bake & Brush": "Gift card",
  "Birdwell's": "Gift card",
  "Monarch Books": "Gift set",
  "Tays Sweet Shop": "Gift card",
  "Breads and Sweets by Babs": "Gift card",
  "Mystic Forests Nursery": "Product",
  "Perfectly Planned Events": "Product",
  "Candle Bloom Confections": "Product",
  "Ethan's Closet Children's Boutique & Little Feet": "Gift card",
  "The Charmed Page Bookstore": "Gift card",
  "Wildcat Brothers Distilling": "Gift set",
  "Pixie Dust Biodegradable Glitter": "Experience",
  "Chattanooga Beard Co.": "Gift set",
  "Sweet Bee Organics": "Product",
  "CHIC by dmo": "Gift set",
  "Beaver's Abundance": "Gift card",
  "The Crab Man Plus": "Gift set",
  "Whimsies from Within": "Product",
  "Handmade By Hayli": "Gift set",
  "Bayou Grace Outfitters": "Product",
  "Accesorios Para Niñas": "Gift set",
  "Ty's Boutique Shop": "Product",
  "Proof & Pour Wax Co.": "Gift set",
  "Krazy Bull Kreations": "Gift card",
  "The Soft Life Collective": "Gift set",
  "Cajun Fiya": "Product",
  "Jaboom Baits": "Gift set",
  "Faith & Fire BBQ": "Gift set",
  "Tufted Artworks": "Product",
  "Basic Bee": "Gift set",
  // Louisiana Experiences & Events
  "Le Petit Théâtre: The Secret Garden": "Experience",
  "The AllWays Lounge & Cabaret Tote Bag": "Product",
  "Olivia Grace Photography": "Session",
  "Paddlewheeler Creole Queen": "Experience",
  "Suzi Marques Photography": "Session",
  "Tevin Lewis, District 2 Alderman": "Gift card",
  "Crabtrap Functional Fitness": "Experience",
  "Jessica Lanham Photography": "Gift card",
  "Ace Bungee Fitness": "Experience",
  "Cat 5 Fishing Charters": "Gift card",
  "God's Country RV Resort": "Experience",
  "Ripley's Crawfish": "Gift card",
  "Restore Hyper Wellness Mandeville": "Session",
  "Celebration Station": "Experience",
  "Tree Frogs Adventure Park": "Experience",
  "Hello Darlin'": "Experience",
  "Wanderlust by Abby": "Experience",
  "Britt Creates": "Session",
  "GoodWolf Power Yoga": "Session",
  "Hannahbelle Photography": "Session",
  "Tiffany Morton Cosmetic Tattooing": "Gift card",
  "Phyllis Guy Dance Center": "Experience",
  "Botanical Nail and Skin Studio": "Gift card",
  "Hair Fashion and Spa": "Gift card",
  "Playtopia Lafayette": "Experience",
  "Summar T. Photography": "Session",
  "HOTWORX Denham Springs": "Experience",
  "Grand Kyiv Ballet": "Experience",
  // National Brands
  "Felco F2 Pruning Shears": "Product",
  "Timeless Skin Care Skincare Package": "Gift set",
  "Texas Beard Company": "Gift set",
  "Everyday Dose": "Gift set",
  "Active Beauty": "Gift set",
  "RoseMae Eimear Creations": "Gift set",
  "Forgiven Hearts": "Gift card",
  "Dolly's Boutique": "Product",
  "BIME Beauty": "Gift set",
  Bashi: "Gift card",
  Hilma: "Gift set",
  "Mary Kay": "Gift set",
};

/** The sponsors guide's label for a row with no price shown, or undefined (a row with a price, or any other guide). */
export const sponsorGiftType = (name: string): SponsorGiftType | undefined => (Object.prototype.hasOwnProperty.call(SPONSOR_GIFT_TYPES, name) ? SPONSOR_GIFT_TYPES[name] : undefined);
