/**
 * THE GUIDE MERGES (owner pop-ups 2026-11-19 ~8:20-9:05 PM, every "Recommended" option picked; FOLLOWUP-OWNER-1119.md
 * items 71, 76-82): about 250 guides become about 55, each merged guide keeping the old guides as SECTIONS. One table,
 * read by the picks import (scripts/gift-guide-picks.mjs folds each section's picks into its parent's chunk, at most
 * SECTION_CAP each), the page catalog (src/content/giftGuideCatalog.ts: a merged guide has no page of its own; its old
 * link opens /gift-guides/<parent>#<old slug>), the server head (api/share.ts answers the old link with a 301 there) and
 * the sitemap (only parents are listed).
 *
 * `parent` is the guide that stays (its own picks, if any, lead as their own section); `sections` are the old guides
 * folded in, in page order; the section id is the old slug, so /gift-guides/healthcare#rns opens the RNs section.
 * Guard: src/test/giftGuideMerges1120.test.ts.
 */

/** The most picks one section shows (owner 11-19: "25 max per SECTION"). */
export const SECTION_CAP = 25;

/** @type {{ parent: string; sections: string[] }[]} */
export const GUIDE_MERGES = [
  // 1 Healthcare Workers: every nursing, medical, dental, therapy, pharmacy, lab, radiology, caregiver and hospital guide.
  { parent: "healthcare", sections: ["rns", "lpns", "cnas", "nurse-practitioners", "nursing-students", "crnas", "landd-nurses", "er-nurses", "icu-nurses", "nicu-nurses", "or-nurses", "pediatric-nurses", "travel-nurses", "home-health-nurses", "doctors", "physician-assistants", "surgeons", "med-students", "medical-assistants", "respiratory-therapists", "lab-techs-phlebotomists", "radiology-techs", "pharmacists", "pharmacy-techs", "physical-therapists", "occupational-therapists", "speech-therapists", "dentists", "dental-hygienists", "dental-assistants", "caregivers", "nursing-home-staff", "hospital-front-desk", "healthcare-workers", "vets-and-vet-techs"] },
  // 2 Military & Veterans.
  { parent: "military", sections: ["army", "navy", "air-force", "marines", "coast-guard", "national-guard", "veterans"] },
  // 3 First Responders.
  { parent: "first-responders", sections: ["firefighters", "police-officers", "sheriffs-deputies", "paramedics-and-emts", "911-dispatchers"] },
  // 4 Teachers & School.
  { parent: "educators", sections: ["teachers", "elementary-teachers", "high-school-teachers", "preschool-teachers", "professors", "principals-and-school-staff", "paraprofessionals", "coaches", "bus-drivers"] },
  // 5 Trades & Oilfield (with the roles the old Industrial hub already held: welders, truck drivers, boat crews, shrimpers).
  { parent: "oilfield-and-trades", sections: ["electricians", "plumbers", "hvac-techs", "linemen", "pipefitters", "welders", "machinists", "crane-operators", "heavy-equipment-operators", "construction-workers", "mechanics", "oilfield-workers", "offshore-workers", "pipeline-workers", "refinery-and-plant-workers", "truck-drivers", "boat-captains-and-deckhands", "commercial-fishermen-and-shrimpers"] },
  // 6 Service Industry.
  { parent: "service-industry", sections: ["restaurant-servers", "bartenders", "baristas", "cooks-and-kitchen-staff", "cashiers", "retail-workers", "customer-service-reps", "hotel-staff", "housekeepers", "hairstylists", "nail-techs", "mail-carrier-and-delivery-drivers", "delivery-drivers", "flight-attendants"] },
  // 7 Gifts by Color (purple-and-gold goes to Game Day, owner ~8:55 PM).
  { parent: "gifts-by-color", sections: ["red-lover", "pink-lover", "purple-lover", "blue-lover", "green-lover", "yellow-lover", "black-lover", "neutral-lover"] },
  // 8 Kids: Girls, Boys and Gender-Neutral, each with its five ages as sections (15 guides -> 3).
  { parent: "girls", sections: ["girls-babies", "girls-toddlers", "girls-little-kids", "girls-big-kids", "girls-teens"] },
  { parent: "boys", sections: ["boys-babies", "boys-toddlers", "boys-little-kids", "boys-big-kids", "boys-teens"] },
  { parent: "gender-neutral", sections: ["gender-neutral-babies", "gender-neutral-toddlers", "gender-neutral-little-kids", "gender-neutral-big-kids", "gender-neutral-teens"] },
  // 9 Louisiana Food Gifts; Louisiana by Region; Crawfish.
  { parent: "louisiana-food-gifts", sections: ["louisiana-pantry", "louisiana-kitchen", "louisiana-sweets-and-bakeries", "treats-and-food-gifts"] },
  { parent: "louisiana-by-region", sections: ["new-orleans", "baton-rouge", "acadiana", "north-louisiana"] },
  { parent: "crawfish-season", sections: ["crawfish-boil-host"] },
  // 10 In-laws as sections of Mom, Dad, Brother and Sister (Sister also takes Big Sisters, item 20); Pets (New Puppy stays).
  { parent: "mom", sections: ["mother-in-law"] },
  { parent: "dad", sections: ["father-in-law"] },
  { parent: "brother", sections: ["brother-in-law"] },
  { parent: "sister", sections: ["big-sisters", "sister-in-law"] },
  { parent: "pets", sections: ["dog-lover", "cat-person", "new-kitten", "horse-lover", "fish-lover", "bird-lover"] },
  // 11 Office & Professional.
  { parent: "office-and-professional", sections: ["accountants", "lawyers", "engineers", "real-estate-agents", "small-business-owners", "social-workers"] },
  // 12 New Baby & Parents.
  { parent: "new-baby-and-parents", sections: ["mom-to-be", "new-mom", "new-dad", "new-grandparent"] },
  // 13 Love; New Home; Get Well.
  { parent: "couples", sections: ["newly-engaged", "newlyweds"] },
  { parent: "new-homeowner", sections: ["first-apartment", "neighbor"] },
  { parent: "get-well-soon", sections: ["hospital-stay"] },
  // 14 Lake & Beach (Hunters and Fishermen stay separate); Gift Wrap.
  { parent: "lake-and-beach", sections: ["beach-lover", "boater", "kayaker"] },
  { parent: "gift-wrap-and-cards", sections: ["gift-tags"] },
  // 15 Foodie & Cook; Coffee.
  { parent: "home-cook", sections: ["baker", "grill-master", "chefs", "entertainer", "hostess"] },
  { parent: "coffee-lover", sections: ["coffee-and-beignets"] },
  // 16 Creative & Hobby; Garden; Entertainment.
  { parent: "creative-and-hobby", sections: ["artist", "crafter", "diyer", "photographer"] },
  { parent: "gardener", sections: ["plant-lover"] },
  { parent: "entertainment", sections: ["gamer", "movie-buff", "music-lover"] },
  // 17 Fitness; Outdoors; Cozy & Self-Care.
  { parent: "fitness", sections: ["gym-lover", "runner"] },
  { parent: "outdoors", sections: ["camper", "mountain-lover"] },
  { parent: "cozy-and-self-care", sections: ["self-care-lover", "homebody"] },
  // 18 Grandparents; Grads & College; Big Moments; Purple & Gold -> Game Day (LSU fans).
  { parent: "grandparents", sections: ["grandma", "grandpa"] },
  { parent: "graduate", sections: ["college-student"] },
  { parent: "big-moments", sections: ["retiree", "new-job"] },
  { parent: "game-day", sections: ["purple-and-gold-lover"] },
  // 19 For Her; For Him.
  { parent: "her", sections: ["wife", "girlfriend"] },
  { parent: "him", sections: ["boyfriend-or-husband"] },
  // 20 Friends (Sister is above).
  { parent: "friends", sections: ["best-friend"] },
  // 21 Aunt & Cousins; Niece & Nephew; Work Gifts.
  { parent: "aunt", sections: ["cousins"] },
  { parent: "niece-and-nephew", sections: ["niece", "nephew"] },
  { parent: "work-gifts", sections: ["boss", "coworkers"] },
  // 22 Secret Santa & White Elephant (Stocking Stuffers stays).
  { parent: "secret-santa", sections: ["white-elephant"] },
  // 23 Budget: Under $25 with the smaller budgets as price sections; Under $50 with $30 and $40; Splurge.
  { parent: "under-25", sections: ["under-5", "under-10", "under-15", "under-20"] },
  { parent: "under-50", sections: ["under-30", "under-40"] },
  { parent: "splurge", sections: ["under-75", "under-100", "100-and-up"] },
  // 24 Shop Small Louisiana (the Small Business Saturday page links here).
  { parent: "shop-small-louisiana", sections: ["louisiana-made", "louisiana-boutiques", "louisiana-small-businesses", "louisiana-artists"] },
  // 25 Easy & Last-Minute.
  { parent: "easy-and-last-minute", sections: ["gift-cards", "subscriptions", "advent-calendars"] },
];

/**
 * SECTION GROUPS (owner pop-up 2026-11-20, after the merges: "Fold thin sections", "Max 6 sections per guide", "By
 * role, not job title"). A merged guide's old guides are grouped by role into its sections; `own` names the section
 * its own picks join (else they lead as "Top picks"). The import then folds any section under SECTION_MIN picks into
 * its closest sibling (the next one, the last into the one before) and joins the two smallest neighbours while a guide
 * has more than SECTION_MAX, so a section's final id and title come from the import (SECTION_ANCHORS in
 * src/content/giftGuidePicks.ts). A guide not listed here starts with each old guide as its own section.
 * `pins` place one product in a section by name (owner: the Fabletics scrubs, one color per Healthcare section).
 */
export const SECTION_MIN = 8;
export const SECTION_MAX = 6;
/** @type {Record<string, { own?: string; groups: { id: string; title: string; from: string[] }[]; pins?: { name: RegExp; group: string }[] }>} */
export const SECTION_GROUPS = {
  healthcare: {
    own: "support-staff",
    groups: [
      { id: "nurses", title: "Nurses", from: ["rns", "lpns", "cnas", "landd-nurses", "er-nurses", "icu-nurses", "nicu-nurses", "or-nurses", "pediatric-nurses", "travel-nurses", "home-health-nurses"] },
      { id: "doctors-and-providers", title: "Doctors & Providers", from: ["doctors", "nurse-practitioners", "physician-assistants", "crnas", "surgeons", "med-students", "nursing-students"] },
      { id: "therapy", title: "Therapy", from: ["respiratory-therapists", "physical-therapists", "occupational-therapists", "speech-therapists"] },
      { id: "dental", title: "Dental", from: ["dentists", "dental-hygienists", "dental-assistants"] },
      { id: "lab-and-pharmacy", title: "Lab & Pharmacy", from: ["lab-techs-phlebotomists", "radiology-techs", "pharmacists", "pharmacy-techs"] },
      { id: "support-staff", title: "Support Staff", from: ["medical-assistants", "caregivers", "nursing-home-staff", "hospital-front-desk", "healthcare-workers", "vets-and-vet-techs"] },
    ],
    // Owner 11-19: the Fabletics scrubs in a different color in each section (navy, onyx, green).
    pins: [{ name: /^Fabletics .*Scrub.*Navy/i, group: "nurses" }, { name: /^Fabletics .*Scrub.*Onyx/i, group: "doctors-and-providers" }, { name: /^Fabletics .*Scrub.*Green/i, group: "support-staff" }],
  },
  military: {
    groups: [
      { id: "army-and-national-guard", title: "Army & National Guard", from: ["army", "national-guard"] },
      { id: "navy-coast-guard-and-air-force", title: "Navy, Coast Guard & Air Force", from: ["navy", "coast-guard", "air-force"] },
      { id: "marines-and-veterans", title: "Marines & Veterans", from: ["marines", "veterans"] },
    ],
  },
  "first-responders": {
    own: "police-and-deputies",
    groups: [
      { id: "firefighters", title: "Firefighters", from: ["firefighters"] },
      { id: "police-and-deputies", title: "Police & Deputies", from: ["police-officers", "sheriffs-deputies"] },
      { id: "paramedics-and-dispatchers", title: "Paramedics & Dispatchers", from: ["paramedics-and-emts", "911-dispatchers"] },
    ],
  },
  educators: {
    own: "teachers",
    groups: [
      { id: "teachers", title: "Teachers", from: ["teachers", "elementary-teachers", "high-school-teachers", "preschool-teachers", "paraprofessionals"] },
      { id: "professors-and-staff", title: "Professors, Principals & Staff", from: ["professors", "principals-and-school-staff", "bus-drivers"] },
      { id: "coaches", title: "Coaches", from: ["coaches"] },
    ],
  },
  "oilfield-and-trades": {
    own: "oilfield-and-offshore",
    groups: [
      { id: "oilfield-and-offshore", title: "Oilfield & Offshore", from: ["oilfield-workers", "offshore-workers", "pipeline-workers", "refinery-and-plant-workers"] },
      { id: "electrical-and-hvac", title: "Electrical & HVAC", from: ["electricians", "linemen", "hvac-techs"] },
      { id: "plumbing-and-pipes", title: "Plumbing & Pipes", from: ["plumbers", "pipefitters"] },
      { id: "building-and-machining", title: "Building, Welding & Machining", from: ["construction-workers", "welders", "machinists", "crane-operators", "heavy-equipment-operators"] },
      { id: "mechanics-and-drivers", title: "Mechanics & Drivers", from: ["mechanics", "truck-drivers"] },
      { id: "on-the-water", title: "On the Water", from: ["boat-captains-and-deckhands", "commercial-fishermen-and-shrimpers"] },
    ],
  },
  "service-industry": {
    own: "restaurants-and-bars",
    groups: [
      { id: "restaurants-and-bars", title: "Restaurants & Bars", from: ["restaurant-servers", "bartenders", "baristas", "cooks-and-kitchen-staff"] },
      { id: "retail-and-customer-service", title: "Retail & Customer Service", from: ["cashiers", "retail-workers", "customer-service-reps"] },
      { id: "hotels-and-housekeeping", title: "Hotels & Housekeeping", from: ["hotel-staff", "housekeepers"] },
      { id: "hair-and-nails", title: "Hair & Nails", from: ["hairstylists", "nail-techs"] },
      { id: "delivery-and-travel", title: "Delivery & Travel", from: ["mail-carrier-and-delivery-drivers", "delivery-drivers", "flight-attendants"] },
    ],
  },
  "gifts-by-color": {
    groups: [
      { id: "red-and-pink", title: "Red & Pink", from: ["red-lover", "pink-lover"] },
      { id: "purple", title: "Purple", from: ["purple-lover"] },
      { id: "blue", title: "Blue", from: ["blue-lover"] },
      { id: "green", title: "Green", from: ["green-lover"] },
      { id: "yellow", title: "Yellow", from: ["yellow-lover"] },
      { id: "black-and-neutral", title: "Black & Neutral", from: ["black-lover", "neutral-lover"] },
    ],
  },
  "home-cook": {
    groups: [
      { id: "baker", title: "Bakers", from: ["baker"] },
      { id: "grill-master", title: "Grill Masters", from: ["grill-master"] },
      { id: "chefs-and-entertainers", title: "Chefs & Entertainers", from: ["chefs", "entertainer"] },
      { id: "hostess", title: "Hostesses", from: ["hostess"] },
    ],
  },
  "louisiana-food-gifts": {
    groups: [
      { id: "pantry-and-kitchen", title: "Pantry & Kitchen", from: ["louisiana-pantry", "louisiana-kitchen"] },
      { id: "sweets-and-treats", title: "Sweets, Bakeries & Treats", from: ["louisiana-sweets-and-bakeries", "treats-and-food-gifts"] },
    ],
  },
  "louisiana-by-region": {
    groups: [
      { id: "new-orleans", title: "New Orleans", from: ["new-orleans"] },
      { id: "baton-rouge-acadiana-north", title: "Baton Rouge, Acadiana & North Louisiana", from: ["baton-rouge", "acadiana", "north-louisiana"] },
    ],
  },
  "shop-small-louisiana": {
    groups: [
      { id: "louisiana-made", title: "Louisiana-Made", from: ["louisiana-made"] },
      { id: "boutiques-shops-and-artists", title: "Boutiques, Shops & Artists", from: ["louisiana-boutiques", "louisiana-small-businesses", "louisiana-artists"] },
    ],
  },
  "under-25": {
    groups: [
      { id: "under-10", title: "Under $10", from: ["under-5", "under-10"] },
      { id: "under-20", title: "Under $20", from: ["under-15", "under-20"] },
    ],
  },
  "under-50": { groups: [{ id: "under-40", title: "Under $40", from: ["under-30", "under-40"] }] },
  splurge: {
    groups: [
      { id: "under-100", title: "Under $100", from: ["under-75", "under-100"] },
      { id: "100-and-up", title: "$100 & Up", from: ["100-and-up"] },
    ],
  },
  "new-baby-and-parents": {
    groups: [
      { id: "mom-to-be", title: "Mom-to-Be", from: ["mom-to-be"] },
      { id: "new-mom", title: "New Mom", from: ["new-mom"] },
      { id: "new-dad-and-grandparents", title: "New Dad & Grandparents", from: ["new-dad", "new-grandparent"] },
    ],
  },
  "new-homeowner": { groups: [{ id: "first-apartment-and-neighbors", title: "First Apartment & Neighbors", from: ["first-apartment", "neighbor"] }] },
  sister: { groups: [{ id: "big-sisters-and-sisters-in-law", title: "Big Sisters & Sisters-in-Law", from: ["big-sisters", "sister-in-law"] }] },
  couples: { groups: [{ id: "engaged-and-newlyweds", title: "Engaged & Newlyweds", from: ["newly-engaged", "newlyweds"] }] },
  "office-and-professional": {
    groups: [
      { id: "accountants", title: "Accountants", from: ["accountants"] },
      { id: "lawyers", title: "Lawyers", from: ["lawyers"] },
      { id: "engineers", title: "Engineers", from: ["engineers"] },
      { id: "real-estate-agents", title: "Real Estate Agents", from: ["real-estate-agents"] },
      { id: "small-business-and-social-work", title: "Small Business & Social Work", from: ["small-business-owners", "social-workers"] },
    ],
  },
  "creative-and-hobby": {
    groups: [
      { id: "artists", title: "Artists", from: ["artist"] },
      { id: "crafters-diyers-and-photographers", title: "Crafters, DIYers & Photographers", from: ["crafter", "diyer", "photographer"] },
    ],
  },
  entertainment: {
    groups: [
      { id: "gamers", title: "Gamers", from: ["gamer"] },
      { id: "movies-and-music", title: "Movies & Music", from: ["movie-buff", "music-lover"] },
    ],
  },
  "easy-and-last-minute": {
    groups: [
      { id: "gift-cards", title: "Gift Cards", from: ["gift-cards"] },
      { id: "subscriptions-and-advent-calendars", title: "Subscriptions & Advent Calendars", from: ["subscriptions", "advent-calendars"] },
    ],
  },
  outdoors: { groups: [{ id: "campers-and-mountain-lovers", title: "Campers & Mountain Lovers", from: ["camper", "mountain-lover"] }] },
  "big-moments": { groups: [{ id: "retirees-and-new-jobs", title: "Retirees & New Jobs", from: ["retiree", "new-job"] }] },
  pets: {
    groups: [
      { id: "dogs", title: "Dog Lovers", from: ["dog-lover"] },
      { id: "cats", title: "Cat Lovers", from: ["cat-person", "new-kitten"] },
      { id: "horses", title: "Horse Lovers", from: ["horse-lover"] },
      { id: "fish-and-birds", title: "Fish & Birds", from: ["fish-lover", "bird-lover"] },
    ],
  },
};

/**
 * 26 Store pages (owner ~9:00 PM): the most popular ones stay, ranked by pageviews and how well shoppers know the store
 * (the owner's named list, where a page exists, then the largest well-known pages up to 30). Every other store page is
 * folded: its items stay in the guides, its old link 301s to the gift guides landing page.
 */
export const STORE_PAGES_KEPT = [
  "store-amazon", "store-target", "store-walmart", "store-sephora", "store-ulta-beauty", "store-lululemon", "store-nordstrom",
  "store-kendra-scott", "store-yeti", "store-stanley", "store-apple", "store-best-buy", "store-bath-and-body-works",
  "store-anthropologie", "store-free-people", "store-coach", "store-baublebar", "store-crocs", "store-hoka", "store-carhartt",
  "store-bass-pro-shops", "store-dillards", "store-abercrombie-and-fitch", "store-ae",
  "store-tractor-supply", "store-rei", "store-wayfair", "store-macys", "store-nordstrom-rack", "store-crate-and-barrel",
];

/** The merged guides made new here: no list of their own, only their sections (each listed in giftGuideIndex.ts). */
export const NEW_PARENTS = ["gifts-by-color", "louisiana-food-gifts", "louisiana-by-region", "pets", "office-and-professional", "new-baby-and-parents",
  "lake-and-beach", "creative-and-hobby", "entertainment", "fitness", "outdoors", "cozy-and-self-care", "big-moments", "niece-and-nephew", "work-gifts",
  "splurge", "shop-small-louisiana", "easy-and-last-minute"];

/** Old guide slug -> { parent, index } (index: its place among the parent's sections). */
export const MERGED_INTO = Object.fromEntries(GUIDE_MERGES.flatMap((m) => m.sections.map((s, index) => [s, { parent: m.parent, index }])));

/** A folded store page (any store-<x> not in STORE_PAGES_KEPT). */
export const isFoldedStore = (slug) => slug.startsWith("store-") && !STORE_PAGES_KEPT.includes(slug);
