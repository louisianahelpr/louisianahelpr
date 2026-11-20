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
/** The 11-19 merges (the big batch, #4785) that the follow-up merges below build on. */
/** @type {{ parent: string; sections: string[] }[]} */
export const BASE_MERGES = [
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
  // 10 In-laws as sections of Mom, Dad, Brother and Sister (Sister also takes Big Sisters, item 20); Pets (New Puppy joins Dogs, follow-up 1120: 6 picks).
  { parent: "mom", sections: ["mother-in-law"] },
  { parent: "dad", sections: ["father-in-law"] },
  { parent: "brother", sections: ["brother-in-law"] },
  { parent: "sister", sections: ["big-sisters", "sister-in-law"] },
  { parent: "pets", sections: ["dog-lover", "new-puppy", "cat-person", "new-kitten", "horse-lover", "fish-lover", "bird-lover"] },
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

/** An 11-19 merged guide with every guide folded into it (BASE_MERGES), for the follow-up merges below. */
const withSections = (slug) => [slug, ...(BASE_MERGES.find((m) => m.parent === slug)?.sections ?? [])];
/**
 * FOLLOW-UP 1120 (owner pop-ups 11-19 ~11:45 PM "65 -> ~56", ~11:58 PM "DEEPER MERGES", 11-20 ~1:10 AM "FINAL MERGES";
 * FOLLOWUP-OWNER-1119.md): each new parent and the old guides it takes in whole (each with its own 11-19 sections).
 * Healthcare, Mom, Dad, Grandparents, Her, Him, Pets, Splurge and the Louisiana, color and store guides stay.
 */
const FOLLOW_UP_1120 = {
  family: ["brother", "sister", "aunt", "uncle", "niece-and-nephew", "couples", "stay-at-home-parents"],
  "friends-and-coworkers": ["friends", "work-gifts", "secret-santa"],
  heroes: ["first-responders", "military"],
  "work-life": ["educators", "office-and-professional", "service-industry", "oilfield-and-trades", "farmers"],
  "outdoors-and-travel": ["hunters", "fishermen", "golfer", "lake-and-beach", "outdoors", "traveler", "gardener"],
  "home-and-kitchen": ["home-cook", "wine-lover", "cozy-and-self-care"],
  "creative-and-entertainment": ["creative-and-hobby", "book-lover", "entertainment"],
  // Easy & Last-Minute joins too (follow-up 1120: with every 0% gift card out it held 6 advent calendars, under the 8 floor).
  "gifts-by-budget": ["stocking-stuffers", "under-25", "under-50", "easy-and-last-minute"],
  "louisiana-celebrations": ["mardi-gras", "game-day", "tailgater", "crawfish-season"],
  "life-moments": ["new-baby-and-parents", "graduate", "new-homeowner", "get-well-soon", "thinking-of-you", "big-moments"],
  kids: ["girls", "boys", "gender-neutral"],
};
const FOLDED_1120 = new Set(Object.values(FOLLOW_UP_1120).flat());
/**
 * THE GUIDE MERGES as shipped: every 11-19 merge whose parent stays, then each follow-up parent with its old guides
 * (and their sections) as its sections, in that order.
 */
/** @type {{ parent: string; sections: string[] }[]} */
export const GUIDE_MERGES = [
  ...BASE_MERGES.filter((m) => !FOLDED_1120.has(m.parent)),
  ...Object.entries(FOLLOW_UP_1120).map(([parent, olds]) => ({ parent, sections: olds.flatMap(withSections) })),
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
  splurge: {
    groups: [
      { id: "under-100", title: "Under $100", from: ["under-75", "under-100"] },
      { id: "100-and-up", title: "$100 & Up", from: ["100-and-up"] },
    ],
  },
  "easy-and-last-minute": {
    groups: [
      { id: "gift-cards", title: "Gift Cards", from: ["gift-cards"] },
      { id: "subscriptions-and-advent-calendars", title: "Subscriptions & Advent Calendars", from: ["subscriptions", "advent-calendars"] },
    ],
  },
  pets: {
    groups: [
      { id: "dogs", title: "Dog Lovers", from: ["dog-lover", "new-puppy"] },
      { id: "cats", title: "Cat Lovers", from: ["cat-person", "new-kitten"] },
      { id: "horses", title: "Horse Lovers", from: ["horse-lover"] },
      { id: "fish-and-birds", title: "Fish & Birds", from: ["fish-lover", "bird-lover"] },
    ],
  },
  // FOLLOW-UP 1120 (owner pop-ups 11-19 11:58 PM "DEEPER MERGES" + 11-20 1:10 AM "FINAL MERGES"): the ~30 guides' sections.
  family: {
    groups: [
      { id: "siblings", title: "Siblings", from: ["brother", "brother-in-law", "sister", "big-sisters", "sister-in-law"] },
      { id: "aunt-and-uncle", title: "Aunt & Uncle", from: ["aunt", "cousins", "uncle"] },
      { id: "niece-and-nephew", title: "Niece & Nephew", from: ["niece-and-nephew", "niece", "nephew"] },
      { id: "couples", title: "Couples", from: ["couples", "newly-engaged", "newlyweds"] },
      { id: "stay-at-home-parents", title: "Stay-at-Home Parents", from: ["stay-at-home-parents"] },
    ],
  },
  "friends-and-coworkers": {
    groups: [
      { id: "friends", title: "Friends", from: ["friends", "best-friend"] },
      { id: "coworkers-and-boss", title: "Coworkers & Boss", from: ["work-gifts", "coworkers", "boss"] },
      { id: "secret-santa", title: "Secret Santa & White Elephant", from: ["secret-santa", "white-elephant"] },
    ],
  },
  heroes: {
    groups: [
      { id: "firefighters", title: "Firefighters", from: ["firefighters"] },
      { id: "police-and-deputies", title: "Police & Deputies", from: ["first-responders", "police-officers", "sheriffs-deputies"] },
      { id: "paramedics-and-dispatchers", title: "Paramedics & Dispatchers", from: ["paramedics-and-emts", "911-dispatchers"] },
      { id: "army-and-national-guard", title: "Army & National Guard", from: ["military", "army", "national-guard"] },
      { id: "navy-coast-guard-and-air-force", title: "Navy, Coast Guard & Air Force", from: ["navy", "coast-guard", "air-force"] },
      { id: "marines-and-veterans", title: "Marines & Veterans", from: ["marines", "veterans"] },
    ],
  },
  "work-life": {
    groups: [
      { id: "teachers-and-school", title: "Teachers & School", from: ["educators", "teachers", "elementary-teachers", "high-school-teachers", "preschool-teachers", "paraprofessionals", "professors", "principals-and-school-staff", "coaches", "bus-drivers"] },
      { id: "office-and-professional", title: "Office & Professional", from: ["office-and-professional", "accountants", "lawyers", "engineers", "real-estate-agents", "small-business-owners", "social-workers"] },
      { id: "service-industry", title: "Service Industry", from: ["service-industry", "restaurant-servers", "bartenders", "baristas", "cooks-and-kitchen-staff", "cashiers", "retail-workers", "customer-service-reps", "hotel-staff", "housekeepers", "hairstylists", "nail-techs", "mail-carrier-and-delivery-drivers", "delivery-drivers", "flight-attendants"] },
      { id: "trades", title: "Trades", from: ["electricians", "linemen", "hvac-techs", "plumbers", "pipefitters", "construction-workers", "welders", "machinists", "crane-operators", "heavy-equipment-operators", "mechanics", "truck-drivers"] },
      { id: "oilfield-and-offshore", title: "Oilfield & Offshore", from: ["oilfield-and-trades", "oilfield-workers", "offshore-workers", "pipeline-workers", "refinery-and-plant-workers", "boat-captains-and-deckhands", "commercial-fishermen-and-shrimpers"] },
      { id: "farmers", title: "Farmers & Ranchers", from: ["farmers"] },
    ],
  },
  "outdoors-and-travel": {
    groups: [
      { id: "hunting", title: "Hunters", from: ["hunters"] },
      { id: "fishing", title: "Fishermen", from: ["fishermen"] },
      { id: "golf", title: "Golfers", from: ["golfer"] },
      { id: "lake-and-beach", title: "Lake & Beach", from: ["lake-and-beach", "beach-lover", "boater", "kayaker"] },
      { id: "travel-and-camping", title: "Travel & Camping", from: ["outdoors", "traveler", "camper", "mountain-lover"] },
      { id: "gardening", title: "Gardeners & Plant Lovers", from: ["gardener", "plant-lover"] },
    ],
  },
  "home-and-kitchen": {
    groups: [
      { id: "home-cooks-and-hosts", title: "Home Cooks & Hosts", from: ["home-cook", "chefs", "entertainer", "hostess"] },
      { id: "bakers", title: "Bakers", from: ["baker"] },
      { id: "grill-masters", title: "Grill Masters", from: ["grill-master"] },
      { id: "wine-lovers", title: "Wine Lovers", from: ["wine-lover"] },
      { id: "cozy-and-self-care", title: "Cozy & Self-Care", from: ["cozy-and-self-care", "self-care-lover", "homebody"] },
    ],
  },
  "creative-and-entertainment": {
    groups: [
      { id: "artists-and-crafters", title: "Artists & Crafters", from: ["creative-and-hobby", "artist", "crafter"] },
      { id: "diy-and-photography", title: "DIY & Photography", from: ["diyer", "photographer"] },
      { id: "book-lovers", title: "Book Lovers", from: ["book-lover"] },
      { id: "gamers", title: "Gamers", from: ["entertainment", "gamer"] },
      { id: "movies-and-music", title: "Movies & Music", from: ["movie-buff", "music-lover"] },
    ],
  },
  "gifts-by-budget": {
    groups: [
      { id: "stocking-stuffers", title: "Stocking Stuffers", from: ["stocking-stuffers"] },
      { id: "under-25", title: "Under $25", from: ["under-25", "under-5", "under-10", "under-15", "under-20"] },
      { id: "under-50", title: "Under $50", from: ["under-50", "under-30", "under-40"] },
      { id: "memberships-and-advent-calendars", title: "Memberships & Advent Calendars", from: ["easy-and-last-minute", "gift-cards", "subscriptions", "advent-calendars"] },
    ],
  },
  "louisiana-celebrations": {
    groups: [
      { id: "mardi-gras", title: "Mardi Gras", from: ["mardi-gras"] },
      { id: "game-day", title: "Game Day & Tailgating", from: ["game-day", "purple-and-gold-lover", "tailgater"] },
      { id: "crawfish-season", title: "Crawfish Season", from: ["crawfish-season", "crawfish-boil-host"] },
    ],
  },
  "life-moments": {
    groups: [
      { id: "baby", title: "Baby", from: ["new-baby-and-parents", "mom-to-be", "new-mom", "new-dad", "new-grandparent"] },
      { id: "graduation", title: "Graduation", from: ["graduate", "college-student"] },
      { id: "new-home", title: "New Home", from: ["new-homeowner", "first-apartment", "neighbor"] },
      { id: "get-well", title: "Get Well", from: ["get-well-soon", "hospital-stay", "thinking-of-you"] },
      { id: "milestones", title: "Milestones", from: ["big-moments", "retiree", "new-job"] },
    ],
  },
  // One Kids guide by age (owner 11-20 1:10 AM): each age mixes girls, boys and any; a pick's `from` keeps which.
  kids: {
    own: "top-picks",
    groups: [
      { id: "top-picks", title: "Top picks", from: ["girls", "boys", "gender-neutral"] },
      { id: "babies", title: "Babies (ages 0–1)", from: ["girls-babies", "boys-babies", "gender-neutral-babies"] },
      { id: "toddlers", title: "Toddlers (ages 1–3)", from: ["girls-toddlers", "boys-toddlers", "gender-neutral-toddlers"] },
      { id: "little-kids", title: "Little Kids (ages 4–7)", from: ["girls-little-kids", "boys-little-kids", "gender-neutral-little-kids"] },
      { id: "big-kids", title: "Big Kids (ages 8–12)", from: ["girls-big-kids", "boys-big-kids", "gender-neutral-big-kids"] },
      { id: "teens", title: "Teens (ages 13+)", from: ["girls-teens", "boys-teens", "gender-neutral-teens"] },
    ],
  },
};

/**
 * THE STORE PAGES (owner pop-up 2026-11-20 ~2:45 AM, FINAL STORE LIST = "Use the data list", superseding the 11-19
 * ~9:00 PM list and the 11-20 ~1:45 AM drop/add): 26 pages (24 shown while STORE_PAGES_HELD wait for a refill), each 10-15 of that store's best-paying, most popular items
 * (~/Desktop/Gift-guide-picks/_store-fill-1120.json). Every other store page is folded: its items stay in the guides,
 * its old link 301s to the gift guides landing page (Anthropologie, Free People, Wayfair, Crate & Barrel, REI,
 * Nordstrom, Nordstrom Rack, Macy's, AE, Abercrombie, Kendra Scott among them). No page for Academy, Kohl's, Costco,
 * Lowe's or Hobby Lobby (~0%).
 */
export const STORE_PAGES_KEPT = [
  "store-walmart", "store-amazon", "store-target", "store-best-buy", "store-ulta-beauty", "store-sephora", "store-bath-and-body-works",
  "store-lululemon", "store-stanley", "store-yeti", "store-carhartt", "store-baublebar", "store-crocs", "store-hoka", "store-apple",
  "store-coach", "store-nike", "store-at-home", "store-old-navy", "store-sams-club",
  "store-dicks-sporting-goods", "store-dillards", "store-tractor-supply", "store-bass-pro-shops",
];
/**
 * Held for a refill (train 1120b, lead 44 2026-11-20: "store pages need 10-15 picks; hide them until refilled"): TJ Maxx
 * (its product photos are hotlink-blocked, 4 picks left) and JCPenney (its house-brand picks are out, 7 left). Folded
 * like the dropped pages (old link 301s to the gift guides landing) until each has 10+ picks with working photos; then
 * move it back into STORE_PAGES_KEPT.
 */
export const STORE_PAGES_HELD = ["store-tj-maxx-marshalls", "store-jcpenney"];

/** The merged guides with no list of their own, only their sections (each listed in giftGuideIndex.ts). */
export const NEW_PARENTS = ["gifts-by-color", "louisiana-food-gifts", "louisiana-by-region", "pets", "splurge", "shop-small-louisiana",
  "fitness", "family", "friends-and-coworkers", "heroes", "work-life", "outdoors-and-travel", "home-and-kitchen",
  "creative-and-entertainment", "gifts-by-budget", "louisiana-celebrations", "life-moments"];
/**
 * The big batch's merged guides that had no list of their own and are sections now (follow-up 1120): they still take no
 * picks themselves in the sort (their sections' old guides do), as before the follow-up merges.
 */
export const NO_LIST_SECTIONS = ["easy-and-last-minute", "office-and-professional", "new-baby-and-parents", "lake-and-beach", "creative-and-hobby", "entertainment", "outdoors",
  "cozy-and-self-care", "big-moments", "niece-and-nephew", "work-gifts"];

/** Old guide slug -> { parent, index } (index: its place among the parent's sections). */
export const MERGED_INTO = Object.fromEntries(GUIDE_MERGES.flatMap((m) => m.sections.map((s, index) => [s, { parent: m.parent, index }])));

/** A folded store page (any store-<x> not in STORE_PAGES_KEPT). */
export const isFoldedStore = (slug) => slug.startsWith("store-") && !STORE_PAGES_KEPT.includes(slug);
