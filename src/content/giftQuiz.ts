import type { CatalogPick } from "@/content/giftGuideCatalog";
import { TOP10_SLOTS } from "@/content/giftGuideTop10";
import { EARN_RANKS } from "@/content/giftGuideEarnOrder";

/**
 * The gift quiz, "Find a gift" (owner 2026-11-21 ~6:15 PM: "Then it's not really a quiz. It should show like a
 * few things. The whole point of a quiz is to ask questions to narrow down the list"). One question per screen:
 *   1. who: Her, Him or Kids (Mom and Dad are gone: they were Her and Him again);
 *   2. for Kids only, an age band;
 *   3. the budget, by the price each card shows (Under $25, $25 to $50, $50 to $100, $100 and up);
 *   4. what they are into: only the chips with at least QUIZ_MIN matches for the answers so far, plus "Anything".
 * The result is QUIZ_FIRST picks (QUIZ_MAX with "Show me more"), ranked: the owner's Top 10 first, then the click
 * order (src/content/giftGuideEarnRank.json), then the price that sits best in the budget; at most two of a brand.
 * Every answer rides in the URL (?who=her&budget=25-50&into=cozy, plus &age=6-8 for Kids), so a link shares the list.
 *
 * Interest tags and kids' age bands are read from each pick's own data: its gift type (the import's `type`) and its
 * name. Age bands are our judgment from the product's name and kind (the box may say otherwise); they only narrow the
 * list and are never shown as a fact. Guard: src/test/giftQuiz1121.test.tsx (every live pick gets a tag, every kids pick
 * an age band).
 */

export type QuizWho = "her" | "him" | "kids";
export type QuizAge = "0-2" | "3-5" | "6-8" | "9-12" | "teen";
export type QuizBudget = "under-25" | "25-50" | "50-75" | "75-100" | "100-plus";
export type QuizInto =
  | "cozy" | "beauty" | "style" | "outdoors" | "fitness" | "tech" | "kitchen" | "tools"
  | "games" | "build" | "creative" | "active" | "pretend" | "stocking" | "any";

export const QUIZ_WHO: { id: QuizWho; label: string; guide: string; forWords: string }[] = [
  { id: "her", label: "Her", guide: "her", forWords: "her" },
  { id: "him", label: "Him", guide: "him", forWords: "him" },
  { id: "kids", label: "Kids", guide: "kids", forWords: "kids" },
];
export const QUIZ_AGES: { id: QuizAge; label: string }[] = [
  { id: "0-2", label: "0 to 2" }, { id: "3-5", label: "3 to 5" }, { id: "6-8", label: "6 to 8" }, { id: "9-12", label: "9 to 12" }, { id: "teen", label: "Teen" },
];
/** Budget bands by the dollars a card shows (rounded, at least $1), the same edges as the guides' price sections. */
export const QUIZ_BUDGETS: { id: QuizBudget; label: string; min: number; max: number }[] = [
  { id: "under-25", label: "Under $25", min: 0, max: 24 },
  { id: "25-50", label: "$25 to $50", min: 25, max: 49 },
  { id: "50-75", label: "$50 to $75", min: 50, max: 74 },
  { id: "75-100", label: "$75 to $100", min: 75, max: 99 },
  { id: "100-plus", label: "$100 and up", min: 100, max: Infinity },
];
const ADULT_INTO: { id: QuizInto; label: string }[] = [
  { id: "cozy", label: "Cozy & home" },
  { id: "beauty", label: "Beauty & self-care" },
  { id: "style", label: "Style" },
  { id: "outdoors", label: "Outdoors, hunting & fishing" },
  { id: "fitness", label: "Fitness & wellness" },
  { id: "tech", label: "Tech & gadgets" },
  { id: "kitchen", label: "Kitchen, coffee & grilling" },
  { id: "tools", label: "Tools & cars" },
];
const KIDS_INTO: { id: QuizInto; label: string }[] = [
  { id: "games", label: "Games & gadgets" },
  { id: "build", label: "Building & science" },
  { id: "creative", label: "Arts & crafts" },
  { id: "active", label: "Active & outdoors" },
  { id: "pretend", label: "Pretend play & little ones" },
  { id: "cozy", label: "Cozy room" },
  { id: "stocking", label: "Stocking stuffers" },
];
const ANY: { id: QuizInto; label: string } = { id: "any", label: "Anything" };

/** A chip shows only with at least this many matches; the result never shows fewer without saying so. */
export const QUIZ_MIN = 3;
export const QUIZ_FIRST = 6;
export const QUIZ_MAX = 12;
/** At most this many of one brand in the result (Him holds many YETI and Smathers & Branson picks). */
const PER_BRAND = 2;

// ---------------------------------------------------------------------------------------------------------------
// Tags, from the pick's own gift type and name

/** Grown-up gift types and the interests each one is. */
const ADULT_TYPE_TAGS: Record<string, QuizInto[]> = {
  "throw-blanket": ["cozy"], bedding: ["cozy"], pajamas: ["cozy"], "sleep-mask": ["cozy"], candle: ["cozy"], socks: ["cozy"], "compression-socks": ["cozy"],
  clock: ["cozy", "tech"], coasters: ["cozy", "kitchen"], "valet-tray": ["cozy", "style"],
  skincare: ["beauty"], lip: ["beauty"], makeup: ["beauty"], "gift-set": ["beauty"], fragrance: ["beauty"], hair: ["beauty"],
  "beauty-device": ["beauty", "tech"], massager: ["fitness", "tech"], grooming: ["beauty"], soap: ["beauty"], "body-wash": ["beauty"],
  lotion: ["beauty"], shave: ["beauty"],
  pants: ["style"], jewelry: ["style"], bag: ["style"], sweatshirt: ["style", "cozy"], shoes: ["style"], "matching-set": ["style", "cozy"],
  scarf: ["style", "cozy"], hat: ["style"], shirt: ["style"], pullover: ["style", "cozy"], jacket: ["style", "outdoors"], belt: ["style"],
  wallet: ["style"], sunglasses: ["style", "outdoors"], vest: ["outdoors", "tech"], accessory: ["style"], boots: ["outdoors", "style"],
  luggage: ["style"], "sunglass-strap": ["outdoors", "style"], "travel-kit": ["style"],
  fishing: ["outdoors"], hunting: ["outdoors"], knife: ["outdoors"], "trail-camera": ["outdoors", "tech"], binoculars: ["outdoors"],
  cooler: ["outdoors", "kitchen"], "gear-case": ["outdoors"], light: ["outdoors", "tools", "tech"], "gun-safe": ["outdoors"], "gun-case": ["outdoors"],
  "can-cooler": ["outdoors", "kitchen"], "bottle-opener": ["kitchen"], golf: ["fitness"],
  speaker: ["tech"], camera: ["tech"], organizer: ["tech", "cozy"],
  mug: ["kitchen", "tech"], drinkware: ["kitchen"], grilling: ["kitchen"],
  tool: ["tools"], "car-care": ["tools"],
  // A tree ornament hangs at home (train 1121h: the LSU Fairisle ornament joined Him in 1121g with no interest).
  ornament: ["cozy"],
  // The LSU and YETI picks 1121g added to Him: cufflinks are style, a backpack and a flask go outdoors.
  cufflinks: ["style"], backpack: ["outdoors", "style"], flask: ["outdoors"],
  // The owner's launch-day Her adds (11-22, scripts/giftGuideOwnerAdds1122.mjs) brought five new types.
  "lip-balm": ["beauty"], "hair-towel": ["beauty"], robe: ["cozy"], pillow: ["cozy"], "wine-tool": ["kitchen"],
  // Batch 2 of her launch-day adds: sleep gummies and a wall diffuser are cozy home, a journal and a planner binder are
  // style pieces, the kitchen set and espresso machine are kitchen, a stick vacuum is a gadget, sleep earbuds both.
  "sleep-supplement": ["cozy", "fitness"], "home-fragrance": ["cozy"], journal: ["style"], planner: ["style"],
  "kitchen-knives": ["kitchen"], cookware: ["kitchen"], "coffee-maker": ["kitchen"], vacuum: ["tech"], "sleep-earbuds": ["tech", "cozy"],
  "smart-ring": ["tech", "fitness"], nightgown: ["cozy", "style"],
  // The owner's 11-22 screenshot adds (builder-guide-adds-2, scripts/giftGuideHer1121.mjs): a nurse's pens and stethoscope
  // are work tools; the fill-in book, earplugs, diffuser and cleaning picks are home; the e-reader, power bank
  // and family calendar are gadgets; the food jar is kitchen; safety glasses and an underscrub are what she wears.
  stationery: ["tools"], stethoscope: ["tools"], book: ["cozy"], earplugs: ["cozy"], diffuser: ["cozy"], "e-reader": ["tech", "cozy"],
  cleaning: ["cozy"], "food-jar": ["kitchen"], "tech-accessory": ["tech"], eyewear: ["style"],
  // The EADEM New Classics Set moved from Kids to Her (owner 11-22 PM): on a grown-up list a skincare set is beauty.
  "skincare-set": ["beauty"],
  scrubs: ["style"], calendar: ["tech", "cozy"], "hand-care": ["beauty"],
  // The popular adds of 11-22 (builder-guide-popular): a cooling fan, power bank, travel adapter, earbuds, headphones and
  // tracker are gadgets; a smartwatch is a gadget for workouts; a pizza oven is kitchen, out in the yard.
  "personal-fan": ["tech"], "power-bank": ["tech"], "travel-adapter": ["tech"], earbuds: ["tech"], headphones: ["tech"],
  tracker: ["tech"], smartwatch: ["tech", "fitness"], "pizza-oven": ["kitchen", "outdoors"],
  // Him batch 1 of her Nov 19 pins (11-22): a fire pit and duck calls go outdoors.
  "fire-pit": ["outdoors"], "duck-call": ["outdoors"],
  // Him batch 2: a nugget ice maker is kitchen.
  "ice-maker": ["kitchen"],
  // Him batch 3: a wool quarter-zip sweater is style and cozy.
  sweater: ["style", "cozy"],
  // Her block 2 (builder-guide-her4, 11-22): a lunch bag and a straw tumbler are kitchen, a water bottle and a sports bra
  // are fitness, a keychain safety alarm is a gadget.
  "lunch-bag": ["kitchen"], tumbler: ["kitchen"], "water-bottle": ["fitness"], "sports-bra": ["fitness", "style"], "safety-alarm": ["tech"],
  // Her block 2 batch 2: a hair perfume is beauty; monogram gift tags and gift bags are for home.
  "hair-perfume": ["beauty"], "gift-wrap": ["cozy"],
  // The owner's Louisiana adds (11-22 PM, builder-guide-louisiana): a toile serving tray is home and kitchen; cookbooks,
  // a cutting board, a king cake or beignet box, coffee pods and seasoning blends are kitchen; a crawfish-boil paddle is
  // kitchen, out in the yard.
  tray: ["cozy", "kitchen"], cookbook: ["kitchen"], "cutting-board": ["kitchen"], "food-gift": ["kitchen"], coffee: ["kitchen"],
  seasoning: ["kitchen"], "boil-paddle": ["kitchen", "outdoors"],
  // The owner's 11-23 Him keeps (scripts/giftGuideOwnerKeeps1123.mjs): a pocket knife sharpener and a mosquito repeller go
  // outdoors, a lighter is outdoors and style, a magnetic tool wristband is tools, a streaming stick is a gadget.
  "knife-sharpener": ["outdoors", "tools"], "mosquito-repeller": ["outdoors"], lighter: ["outdoors", "style"], "tool-wristband": ["tools"],
  "streaming-stick": ["tech"],
};
/** Kids' gift types and the interests each one is. */
const KIDS_TYPE_TAGS: Record<string, QuizInto[]> = {
  game: ["games"], "game-console": ["games"], "digital-pet": ["games"], watch: ["games"], "walkie-talkie": ["games", "active"], camera: ["games", "creative"],
  karaoke: ["games"], vr: ["games", "active"], tablet: ["games", "creative"], dance: ["games", "active"], toy: ["games"], audio: ["games"], bank: ["stocking"],
  "building-toy": ["build"], "building-set": ["build"], blocks: ["build", "pretend"], "construction-toy": ["build", "pretend"], science: ["build"], learning: ["build"],
  craft: ["creative"], art: ["creative"], book: ["creative", "stocking"], slime: ["creative", "stocking"],
  scooter: ["active"], "ride-on": ["active", "pretend"], hoverboard: ["active"], outdoor: ["active"], sports: ["active", "games"], "balance-bike": ["active"], rocket: ["active", "build"],
  "pretend-play": ["pretend"], doll: ["pretend"], dollhouse: ["pretend"], "pull-toy": ["pretend"], "car-toy": ["pretend"], "bath-toy": ["pretend"],
  rocker: ["pretend", "active"], "spin-toy": ["pretend", "active"], "play-table": ["pretend", "active"], "baby-clothes": ["cozy"],
  squishy: ["stocking"], fidget: ["stocking"], toothbrush: ["stocking"], ornament: ["stocking", "build"], chair: ["cozy"], bag: ["stocking"],
  // A skincare set on Kids is a teen self-care set (the EADEM New Classics Set was here until the owner moved it to Her, 11-22).
  "skincare-set": ["cozy"],
  // The popular Kids adds of 11-22 (builder-guide-popular): a brain-teaser puzzle is a game; a hatching egg, a playset, a
  // plush Elmo and a dino vehicle are pretend play.
  puzzle: ["games"], "hatching-toy": ["pretend"], playset: ["pretend"], plush: ["pretend"], "vehicle-toy": ["pretend"],
  // Backyard play gear she saved (11-22): outdoor sets for little ones.
  "backyard-play": ["active", "pretend"],
  "kids-pajamas": ["cozy"], "duck-call": ["active", "stocking"],
  // The owner's Louisiana adds (11-22 PM): deck boots and a team jersey are for active kids, an LSU cheer dress is
  // dress-up, and chinos, a tee and a baby wash set are cozy everyday wear and care.
  boots: ["active"], jersey: ["active"], dress: ["pretend"], pants: ["cozy"], tee: ["cozy"], "baby-care": ["cozy"],
  // The owner's 11-23 Kids keeps (scripts/giftGuideOwnerKeeps1123.mjs): figures are pretend play, a foam blaster, a fishing
  // kit and a water bottle are for active kids, shoe charms and putty are stocking stuffers, play sand is creative.
  figures: ["pretend"], blaster: ["active"], fishing: ["active"], "water-bottle": ["active"], "shoe-charms": ["stocking"],
  putty: ["stocking"], "sensory-sand": ["creative"],
};
/**
 * Name words that add an interest the gift type alone misses (each from what the product is, by its name). Tag pass by
 * eye over all 269 picks, 11-21 PM (lead: the ZDEER heated gua sha showed under Cozy & home): "heated" and "bottle" are
 * no longer cues (a heated beauty tool, a bottle opener), and the cozy words never tag beauty, shoes or boots.
 */
const NAME_TAGS: [RegExp, QuizInto][] = [
  [/\b(leggings|sneakers?|cloud 6)\b/i, "fitness"],
  [/\b(owala|water bottle)\b/i, "fitness"],
  [/\b(ember mug)\b/i, "kitchen"],
  [/\b(electric|laser|rechargeable|bluetooth|wireless|biometric|led)\b/i, "tech"],
  [/\b(camera)\b/i, "tech"],
  [/\b(fishing|duck|mallards?|hunting|whitetails?|redfish|trout|upland|decoys?|tackle)\b/i, "outdoors"],
  [/\b(carving knife|meat|bbq|grill)\b/i, "kitchen"],
  [/\b(fuzzy|sherpa|fleece|flannel|lounge|weighted|plush)\b/i, "cozy"],
];
/** Gift types the cozy name words never tag (a "fleece lined" boot is not Cozy & home). */
const NOT_COZY_TYPES = new Set(["skincare", "lip", "lip-balm", "hair-towel", "skincare-set", "makeup", "gift-set", "fragrance", "hair", "beauty-device", "grooming", "soap", "body-wash", "lotion", "shave", "shoes", "boots"]);
/** Per-pick fixes where the type and name rules misfire (by the pick's name; checked by eye, 11-21 PM). */
const TAG_OVERRIDES: [RegExp, QuizInto[]][] = [
  // A keychain video camera is a gadget, not a style piece.
  [/^camp snap\b/i, ["tech"]],
  // A baby's first-Christmas tote of toys is for the littlest, not a stocking stuffer.
  [/^baby'?s 1st christmas/i, ["pretend"]],
];

export function quizTags(pick: Pick<CatalogPick, "name" | "type">, who: QuizWho): QuizInto[] {
  const fixed = TAG_OVERRIDES.find(([re]) => re.test(pick.name));
  if (fixed) return [...fixed[1]];
  const table = who === "kids" ? KIDS_TYPE_TAGS : ADULT_TYPE_TAGS;
  const tags = new Set<QuizInto>(table[pick.type ?? ""] ?? []);
  if (who !== "kids") {
    for (const [re, tag] of NAME_TAGS) if (re.test(pick.name) && !(tag === "cozy" && NOT_COZY_TYPES.has(pick.type ?? ""))) tags.add(tag);
  }
  // A hunting/fishing knife is the outdoors; a kitchen carving set is the kitchen.
  if (who !== "kids" && /\bcarving\b/i.test(pick.name)) tags.delete("outdoors");
  return [...tags];
}

/** Kids' age bands by gift type, then by name for the types that span ages. */
const AGE_BY_TYPE: Record<string, QuizAge[]> = {
  "baby-clothes": ["0-2"], "bath-toy": ["0-2", "3-5"], "pull-toy": ["0-2", "3-5"], rocker: ["0-2", "3-5"], "spin-toy": ["0-2", "3-5"],
  "play-table": ["0-2", "3-5"], blocks: ["0-2", "3-5"], "balance-bike": ["0-2", "3-5"], "construction-toy": ["3-5"], "pretend-play": ["3-5"],
  doll: ["3-5", "6-8"], dollhouse: ["3-5", "6-8"], "car-toy": ["0-2", "3-5"], audio: ["3-5", "6-8"], learning: ["3-5", "6-8"],
  "building-toy": ["3-5", "6-8"], "ride-on": ["3-5", "6-8"], dance: ["3-5", "6-8"], sports: ["3-5", "6-8"], toothbrush: ["3-5", "6-8"],
  karaoke: ["3-5", "6-8"], camera: ["3-5", "6-8"], chair: ["3-5", "6-8"], art: ["6-8", "9-12"], craft: ["6-8", "9-12"], book: ["6-8", "9-12"],
  slime: ["6-8", "9-12"], squishy: ["6-8", "9-12"], fidget: ["6-8", "9-12", "teen"], game: ["6-8", "9-12", "teen"], bank: ["6-8", "9-12"],
  toy: ["6-8", "9-12"], outdoor: ["6-8", "9-12"], rocket: ["6-8", "9-12"], watch: ["6-8", "9-12"], "walkie-talkie": ["6-8", "9-12"],
  science: ["6-8", "9-12"], "digital-pet": ["6-8", "9-12"], "building-set": ["9-12", "teen"], ornament: ["6-8", "9-12", "teen"],
  scooter: ["6-8", "9-12"], hoverboard: ["6-8", "9-12"], "game-console": ["9-12", "teen"], vr: ["9-12", "teen"], tablet: ["6-8", "9-12", "teen"], bag: ["6-8", "9-12", "teen"],
  // A skincare set on Kids is skin care for a teen.
  "skincare-set": ["teen"],
  // The popular Kids adds of 11-22, by each box's age: Little People and Tickle Me Elmo are for toddlers, the PAW Patrol
  // vehicle and the hatching egg for preschool and up, Kanoodle (7+) for school-age kids and teens.
  playset: ["0-2", "3-5"], plush: ["0-2", "3-5"], "vehicle-toy": ["3-5", "6-8"], "hatching-toy": ["3-5", "6-8"], puzzle: ["6-8", "9-12", "teen"],
  "backyard-play": ["3-5"],
  "kids-pajamas": ["0-2", "3-5", "6-8"], "duck-call": ["6-8", "9-12"],
  // The owner's Louisiana adds (11-22 PM), by their sizes: Big Kids deck boots, youth chinos, the toddler-to-youth cheer
  // dress and Happy tee, the youth 4-20 Saints jersey, and a baby wash set.
  boots: ["6-8", "9-12"], pants: ["6-8", "9-12"], dress: ["3-5", "6-8"], tee: ["3-5", "6-8", "9-12"], jersey: ["6-8", "9-12", "teen"], "baby-care": ["0-2"],
  // The owner's 11-23 Kids keeps, by each box's age (Desktop owner-keeps-1123.json): Bluey figures 3+, NERF 8+, Jibbitz
  // 5+, Thinking Putty 3+, Kinetic Sand 3+, the fishing kit and the Owala bottle 4+.
  figures: ["3-5", "6-8"], blaster: ["6-8", "9-12"], "shoe-charms": ["6-8", "9-12"], putty: ["3-5", "6-8", "9-12"],
  "sensory-sand": ["3-5", "6-8"], fishing: ["3-5", "6-8", "9-12"], "water-bottle": ["3-5", "6-8"],
};
const AGE_BY_NAME: [RegExp, QuizAge[]][] = [
  [/baby'?s 1st/i, ["0-2"]],
  [/infant bucket swing/i, ["0-2"]],
  [/paint with water|sticker book/i, ["3-5", "6-8"]],
  [/aqua puffs/i, ["3-5", "6-8"]],
  [/easel|club chair/i, ["3-5"]],
  [/hammock chair/i, ["6-8", "9-12"]],
  [/tracing pad/i, ["6-8"]],
  [/karaoke machine/i, ["6-8", "9-12"]],
  [/instant print/i, ["6-8", "9-12"]],
  [/flying disc/i, ["6-8", "9-12", "teen"]],
  [/telescope/i, ["9-12", "teen"]],
  [/highwaykick/i, ["0-2", "3-5"]],
  [/e2 plus/i, ["9-12", "teen"]],
  [/self-balancing scooter$/i, ["9-12", "teen"]],
  [/nex playground/i, ["6-8", "9-12"]],
  [/nintendo switch with/i, ["6-8", "9-12", "teen"]],
  [/doorbell house|ramp racer/i, ["0-2", "3-5"]],
  [/shopping cart/i, ["3-5"]],
  // The owner's 11-23 Kids keeps whose box age differs from their type's: Ms. Rachel phone 12 months+, Spike the hedgehog
  // 18 months+, Green Toys dump truck 12 months+, Polly Pocket 4+, Play-Doh Noodle Party 3+.
  [/ms\. rachel talk with me phone/i, ["0-2", "3-5"]],
  [/spike the fine motor hedgehog/i, ["0-2", "3-5"]],
  [/green toys dump truck/i, ["0-2", "3-5"]],
  [/polly pocket/i, ["3-5", "6-8"]],
  [/play-doh kitchen creations noodle/i, ["3-5", "6-8"]],
];
export function quizAges(pick: Pick<CatalogPick, "name" | "type">): QuizAge[] {
  for (const [re, ages] of AGE_BY_NAME) if (re.test(pick.name)) return ages;
  return AGE_BY_TYPE[pick.type ?? ""] ?? [];
}

// ---------------------------------------------------------------------------------------------------------------
// Answers, chips and the result

export interface QuizAnswers { who?: QuizWho; age?: QuizAge; budget?: QuizBudget; into?: QuizInto }

/** The answers in a link's query, each checked against its options (an unknown value reads as unanswered). */
export function readQuiz(params: URLSearchParams): QuizAnswers {
  const who = QUIZ_WHO.find((x) => x.id === params.get("who"))?.id;
  const age = who === "kids" ? QUIZ_AGES.find((x) => x.id === params.get("age"))?.id : undefined;
  const budget = QUIZ_BUDGETS.find((x) => x.id === params.get("budget"))?.id;
  const intoIds = who ? [...(who === "kids" ? KIDS_INTO : ADULT_INTO), ANY].map((x) => x.id) : [];
  const into = intoIds.find((x) => x === params.get("into"));
  return { ...(who ? { who } : {}), ...(age ? { age } : {}), ...(budget ? { budget } : {}), ...(into ? { into } : {}) };
}

/** Which question is next: who, age (Kids), budget, into, or the result. */
export function quizStep(a: QuizAnswers): "who" | "age" | "budget" | "into" | "result" {
  if (!a.who) return "who";
  if (a.who === "kids" && !a.age) return "age";
  if (!a.budget) return "budget";
  if (!a.into) return "into";
  return "result";
}

const dollars = (p: CatalogPick) => Math.max(1, Math.round(p.price ?? 0));
/** Whether a pick's shown price sits in a budget band (the swipe deck reads it too). */
export const quizInBudget = (p: CatalogPick, b: QuizBudget) => inBudget(p, b);
const inBudget = (p: CatalogPick, b: QuizBudget) => {
  const band = QUIZ_BUDGETS.find((x) => x.id === b)!;
  return !!p.price && p.price > 0 && dollars(p) >= band.min && dollars(p) <= band.max;
};

/** The picks for a person (and a kid's age), before budget and interest. */
export function quizPool<T extends CatalogPick>(pool: readonly T[], a: Pick<QuizAnswers, "who" | "age">): T[] {
  if (!a.who) return [];
  return pool.filter((p) => a.who !== "kids" || !a.age || quizAges(p).includes(a.age));
}

const matches = (p: CatalogPick, who: QuizWho, into: QuizInto) => into === "any" || quizTags(p, who).includes(into);

/** The budgets worth offering: those with at least QUIZ_MIN picks for this person (and age). */
export function quizBudgets(pool: readonly CatalogPick[], a: Pick<QuizAnswers, "who" | "age">) {
  const people = quizPool(pool, a);
  return QUIZ_BUDGETS.filter((b) => people.filter((p) => inBudget(p, b.id)).length >= QUIZ_MIN);
}

/** The interest chips worth offering: each with at least QUIZ_MIN picks for the answers so far, then "Anything". */
export function quizIntoChips(pool: readonly CatalogPick[], a: QuizAnswers): { id: QuizInto; label: string; count: number }[] {
  if (!a.who || !a.budget) return [];
  const fit = quizPool(pool, a).filter((p) => inBudget(p, a.budget!));
  const chips = (a.who === "kids" ? KIDS_INTO : ADULT_INTO).map((c) => ({ ...c, count: fit.filter((p) => matches(p, a.who!, c.id)).length }));
  return [...chips.filter((c) => c.count >= QUIZ_MIN), { ...ANY, count: fit.length }];
}

/** Rank: the owner's Top 10 first (in her order), then clicks, then the price that sits best in the budget. */
function rank(picks: CatalogPick[], budget: QuizBudget): CatalogPick[] {
  const top = new Map(TOP10_SLOTS.map((s, i) => [s.href, i] as const));
  const band = QUIZ_BUDGETS.find((x) => x.id === budget)!;
  // "Best fit" in a band is its middle; in "$100 and up", the nearer to $100 the better.
  const mid = Number.isFinite(band.max) ? (band.min + band.max) / 2 : band.min;
  const key = (p: CatalogPick): [number, number, number] => [top.get(p.href) ?? 99, EARN_RANKS[p.href] ?? 1e6, Math.abs(dollars(p) - mid)];
  return [...picks].sort((x, y) => {
    const a = key(x), b = key(y);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}

/** At most PER_BRAND of a brand: a third of one brand waits until every other pick is placed. */
function brandSpread(picks: CatalogPick[]): CatalogPick[] {
  const seen = new Map<string, number>();
  const first: CatalogPick[] = [];
  const later: CatalogPick[] = [];
  for (const p of picks) {
    const b = (p.brand || p.name.split(" ")[0]).toLowerCase();
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    (n <= PER_BRAND ? first : later).push(p);
  }
  return [...first, ...later];
}

/** The quiz's order for a list already filtered (Top 10, clicks, price fit; at most two of a brand): the swipe deck's order too. */
export function quizRanked<T extends CatalogPick>(picks: readonly T[], budget: QuizBudget): T[] {
  return brandSpread(rank([...picks], budget)) as T[];
}

export interface QuizResult { picks: CatalogPick[]; widened: boolean }

/**
 * The quiz's answer: up to QUIZ_MAX picks for who (and age) + into, within the budget. Fewer than QUIZ_MIN (a shared link
 * whose chip no longer fits) and the budget widens to the neighbouring bands, nearest first, with `widened` set so the
 * page says so; never an empty list while the person has any pick for that interest (or, last, any pick at all).
 */
export function giftQuiz(pool: readonly CatalogPick[], a: Required<Pick<QuizAnswers, "who" | "budget" | "into">> & Pick<QuizAnswers, "age">): QuizResult {
  const people = quizPool(pool, a).filter((p) => p.price && p.price > 0);
  const wanted = people.filter((p) => matches(p, a.who, a.into));
  const exact = wanted.filter((p) => inBudget(p, a.budget));
  if (exact.length >= QUIZ_MIN) return { picks: brandSpread(rank(exact, a.budget)).slice(0, QUIZ_MAX), widened: false };
  const at = QUIZ_BUDGETS.findIndex((b) => b.id === a.budget);
  const order = QUIZ_BUDGETS.map((b, i) => ({ b, d: Math.abs(i - at) })).sort((x, y) => x.d - y.d).map((x) => x.b.id);
  const picked: CatalogPick[] = [];
  for (const id of order) {
    picked.push(...rank(wanted.filter((p) => inBudget(p, id)), a.budget));
    if (picked.length >= QUIZ_MIN) break;
  }
  const list = picked.length > 0 ? picked : rank(people, a.budget);
  return { picks: brandSpread(list).slice(0, QUIZ_MAX), widened: true };
}

/** "for her", "for him", "for kids 6 to 8". */
export function quizForWords(a: Pick<QuizAnswers, "who" | "age">): string {
  const w = QUIZ_WHO.find((x) => x.id === a.who);
  if (!w) return "";
  const age = a.who === "kids" ? QUIZ_AGES.find((x) => x.id === a.age) : undefined;
  return age ? (age.id === "teen" ? "teens" : `kids ${age.label}`) : w.forWords;
}
