/**
 * FOR HER + FOR HIM, SORTED BY INTEREST (owner decision by pop-up, 2026-11-20 ~6:50 PM; src/content/giftGuidePeople.mjs).
 * scripts/gift-guide-picks.mjs runs this LAST on the finished pages (after the train passes, the late price fill and the
 * budget caps), so every rule those passes apply to the old Mom, Dad, Her, Him and Siblings lists has already run:
 *   1. the pool: For Her takes the Her, Mom and Siblings (sister, big sister, sister-in-law) picks, For Him the Him, Dad
 *      and Siblings (brother, brother-in-law) picks; the Mom and Dad pages and the Siblings section are gone after;
 *   2. scripts/gift-guide-people-1120.json: `cuts` (taste), `moves` (a pick that fits a people guide best leaves the guide
 *      it was on) and `adds` (a pick a store page already shows, copied with its link, photo and checked price);
 *   3. the taste rules (owner 11-20): no Lilly Pulitzer, Michael Kors or Muck boots for her (XTRATUF over Muck), no
 *      L.L.Bean slippers (UGG over L.L.Bean), her cups never plain black; his picks in classic colors only (never pink,
 *      mint or neon) and never a women's-style shoe (platform, lift, wedge);
 *   4. the sections: Under $25 first (a checked non-Amazon price of $25 or less; never an Amazon price), then each pick's
 *      interest section; each section at most PEOPLE_SECTION_CAP picks and PEOPLE_TYPE_MAX of one gift type, sorted by
 *      commission (highest first, unknown last);
 *   5. the tags: each pick's `rels`, the relationship chips it shows under (a romantic pick only for a partner; an
 *      in-law page leaves out boots and anything too young or trendy; a pick named for one person only for them).
 * Guard: src/test/giftGuidePeople1120.test.ts.
 */
import { PEOPLE_GUIDES, PEOPLE_SECTION_CAP, PEOPLE_TYPE_MAX } from "../src/content/giftGuidePeople.mjs";

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const rate = (p) => (typeof p.commission === "number" ? p.commission : -1);
const text = (p) => `${p.brand ?? ""} ${p.name ?? ""}`;
const isAmazon = (p) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\/|^https:\/\/amzn\.to\//.test(String(p.href ?? ""));
/** A checked non-Amazon price of $25 or less (owner 11-18: never an Amazon price). */
export const under25 = (p) => typeof p.price === "number" && p.price > 0 && p.price <= 25 && !isAmazon(p);

// ---------------------------------------------------------------------------------------------------------------
// Taste (owner 11-20)

/** Her taste: blocked brands, Muck boots (XTRATUF over Muck), L.L.Bean slippers (UGG over them), plain black cups. */
const HER_OUT = [
  { why: "Lilly Pulitzer is blocked (owner 11-20)", test: (p) => /\blilly pulitzer\b/i.test(text(p)) },
  { why: "Michael Kors bag out (owner 11-20)", test: (p) => /\bmichael kors\b/i.test(text(p)) },
  { why: "XTRATUF over Muck for women (owner 11-20)", test: (p) => /\bmuck\b/i.test(text(p)) && (p.type === "boots" || /\bboots?\b/i.test(p.name)) },
  { why: "UGG over L.L.Bean slippers (owner 11-20)", test: (p) => /\bl\.?\s?l\.?\s?bean\b/i.test(text(p)) && /\b(moccasins?|slippers?)\b/i.test(p.name) },
  { why: "women's cups in cute colors, never plain black (owner 11-20)", test: (p) => /\b(tumbler|bottle|rambler|quencher|iceflow|cup|mug)\b/i.test(p.name) && /\b(black|charcoal|graphite|matte black)\b/i.test(`${p.name} ${p.href}`) },
];
/** Colors a men's pick never wears (owner 11-20: classic colors only, navy, grey, white, black, olive, khaki, burgundy). */
export const MEN_OFF_COLOR = /\b(pink|blush|mint|neon|lavender|lilac|pastel|coral|seafoam|peach|aqua|turquoise|lime|yellow|fuchsia|magenta|teal|orange|sky blue|light blue|baby blue|rose|plum|mauve|berry|(?<!(olive|hunter|forest|army|moss|dark|hammertone) )green)\b/i;
/** A women's-style shoe (owner 11-20: the HEYDUDE Austin Lift on Dad). */
const WOMENS_SHOE = /\b(platform|lift|wedge|heels?|mules?)\b/i;
/** The color words a link or photo carries (?color=..., /pink/, _mint_) as plain words. */
const colorWords = (p) => {
  const bits = [];
  for (const u of [p.href, p.image]) {
    try {
      const url = new URL(String(u));
      for (const [k, v] of url.searchParams) if (/colou?r|variant_name|swatch/i.test(k)) bits.push(v);
      bits.push(decodeURIComponent(url.pathname).replace(/[-_/.]+/g, " "));
    } catch { /* no URL: the name alone is read */ }
  }
  return bits.join(" ");
};
/**
 * The brands Louisiana men wear (owner 11-20 evening, by the lead: "Columbia PFG, Simms, Huk, Carhartt, Southern Marsh,
 * Local Boy Outfitters, YETI, Costa"; with the 11-19 vibe list: Southern Tide, Duck Head, Smathers & Branson,
 * Johnnie-O, Peter Millar, Barbour, Orvis, L.L.Bean, XTRATUF, Muck, HEYDUDE, Ariat, Justin). A men's clothing or shoe
 * pick from any other brand leaves For Him; LA_MEN_FIRST brands lead Classic Style.
 */
export const LA_MEN_FIRST = /^(columbia( pfg)?|simms|huk|carhartt|southern marsh|local boy( outfitters)?|yeti|costa)$/i;
const LA_MEN_OK = /^(columbia( pfg)?|simms|huk|carhartt|southern marsh|local boy( outfitters)?|yeti|costa|southern tide|duck head|smathers (and|&) branson|duck head x smathers (and|&) branson|johnnie-?o|peter millar|barbour|orvis|l\.?l\.? ?bean|xtratuf|muck( boot)?( company)?|heydude|ariat|justin|patagonia|ugg|bombas|lululemon|ray-ban|oakley|georgia boot)$/i;
const MENS_WEAR = new Set(["sweatshirt", "pants", "jacket", "shirt", "shoes", "hat", "boots", "slippers", "vest"]);
const HIM_OUT = [
  { why: "men's picks in classic colors only (owner 11-20)", test: (p) => MEN_OFF_COLOR.test(p.name) || MEN_OFF_COLOR.test(colorWords(p)) },
  { why: "no women's-style shoes on men's guides (owner 11-20)", test: (p) => /\b(shoes?|slippers?|boots?|sneakers?|clogs?|slides?|loafers?)\b/i.test(`${p.type ?? ""} ${p.name}`) && WOMENS_SHOE.test(p.name) },
  { why: "no women's items on men's guides", test: (p) => /\bwomen'?s\b/i.test(p.name) },
  { why: "Classic Style: brands Louisiana men wear (owner 11-20)", test: (p) => MENS_WEAR.has(String(p.type ?? "")) && !LA_MEN_OK.test(String(p.brand ?? "").trim()) && !LA_MEN_OK.test(String(p.name ?? "").split(/\s+/).slice(0, 2).join(" ")) },
];

// ---------------------------------------------------------------------------------------------------------------
// Interest sections

const BEAUTY_BRANDS = /^(bobbi brown|lancome|estee lauder|clarins|kiehl'?s|elemis|sol de janeiro|glossier|rare beauty|tarte|mac( cosmetics)?|laneige|saie|charlotte tilbury|olaplex|k18|summer fridays|rhode|omnilux|olive (and|&) june|timeless skin care|sky (and|&) sol|idra wellness|arey|oyu botanica|kitsch|shark|supergoop!?|therabody|dyson|t3)$/i;
const HER_TYPES = {
  "cozy-and-loungewear": ["pajamas", "robe", "slippers", "sweatshirt", "throw-blanket", "socks", "loungewear", "sleep mask", "clog"],
  "beauty-and-self-care": ["skincare", "makeup", "fragrance", "haircare", "hair-care", "hair-tool", "beauty-device", "body-care", "gift-set", "nail", "bath", "massage", "pillowcase"],
  "home-and-candles": ["candle", "pillow", "drinkware", "stationery", "tablet", "kitchen-appliance", "cookware", "home-fragrance", "decor", "frame", "mug"],
  "style-and-accessories": ["bag", "jewelry", "shoes", "boots", "hat", "jacket", "shirt", "eyewear", "wallet", "luggage", "hair-accessory", "watch", "scarf", "outdoor"],
};
const HER_WORDS = [
  ["beauty-and-self-care", /\b(serum|lotion|balm|cream|lip|perfume|parfum|mist|hair|dryer|airwrap|flexstyle|facial|cosmetic|glow|tint|bronz\w*|flawless|mani|nail|led .*mask|skin|bath|spa)\b/i],
  ["cozy-and-loungewear", /\b(pajamas?|pj|robe|slippers?|lounge|sweatshirt|hoodie|crewneck|cardigan|throw|blanket|sherpa|fleece|cozy|socks?|tasman|tazz|disquette|align|scuba|jogger|sweatpants?|sleep mask|towel wrap|evelina)\b/i],
  ["home-and-candles", /\b(candle|pillow|mug|tumbler|bottle|rambler|journal|kindle|towel|diffuser|vase|tray|frame|kitchen|dutch oven|planner|wallflowers|stationery|advent)\b/i],
  ["style-and-accessories", /\b(tote|bag|pouch|case|wallet|wristlet|crossbody|earrings?|necklace|ring|bracelet|hoops?|boots?|sneakers?|flats?|clogs?|hat|cap|beanie|jacket|tank|tee|dress|cami|sunglasses|weekender|watch|scarf|paddle)\b/i],
];
const HIM_TYPES = {
  outdoors: ["boots", "cooler", "outdoor", "fishing", "hunting", "knife", "multitool", "flashlight", "garden", "drinkware"],
  "grilling-and-kitchen": ["grill", "griddle", "smoker", "cookware", "kitchen-appliance", "thermometer", "barware", "coffee"],
  "tech-and-gadgets": ["headphones", "speaker", "tech-accessory", "gaming", "tablet", "camera", "smartwatch", "tools", "massager", "fan and heater"],
  "classic-style": ["sweatshirt", "pants", "jacket", "shirt", "belt", "wallet", "shoes", "slippers", "hat", "grooming", "underwear", "bag", "watch", "eyewear", "cologne", "fragrance", "socks"],
};
const HIM_WORDS = [
  ["tech-and-gadgets", /\b(leatherman|multi-?tool|airfly|bluetooth|transmitter|rangefinder|airpods|headphones?|earbuds?|speaker|bose|sonos|jbl|beats|garmin|apple watch|smart ?watch|kindle|ipad|charger|anker|power bank|airtag|gaming|playstation|xbox|nintendo|controller|drone|camera|theragun|massage gun|leaf blower|worx|drill|dewalt|milwaukee|ryobi|turboblade|bedjet)\b/i],
  ["grilling-and-kitchen", /\b(grill|griddle|smok\w*|bbq|traeger|blackstone|weber|meater|thermometer|thermapen|thermoworks|cast iron|lodge|skillet|ninja|knife set|cutting board|seasoning|rub|whiskey|bourbon glass|decanter|cocktail|pizza oven|ooni|air fryer|coffee|burger press|fire ?pit|solo stove)\b/i],
  ["outdoors", /\b(yeti|cooler|fish\w*|hunt\w*|camo|xtratuf|muck|huk|simms|costa|aftco|pfg|polarized|knife|bubba|duck(?! head)|mossy oak|tackle|flashlight|headlamp|kayak|boat|tie-?downs?|ratchet|rambler|tumbler|roadie|hopper|deck boot|rod|reel|outdoor|upland|deer)\b/i],
];

/** A pick's interest section on a people guide (its gift type first, then the words in its brand and name). */
export function interestOf(guide, p) {
  const t = String(p.type ?? "").toLowerCase();
  if (guide === "her") {
    // A beauty brand's pick is beauty, whatever type the import guessed (Bobbi Brown's Pot Rouge read as "cookware"),
    // except its candle (Sol de Janeiro's) and its tools (Shark's styler stays beauty; its fan is no Her pick).
    if (BEAUTY_BRANDS.test(String(p.brand ?? "").trim()) && t !== "candle") return "beauty-and-self-care";
    // A silk pillowcase is a beauty-sleep gift, not decor.
    if (/\bpillowcase\b/i.test(p.name)) return "beauty-and-self-care";
    for (const [id, types] of Object.entries(HER_TYPES)) if (types.includes(t)) return id;
    for (const [id, words] of HER_WORDS) if (words.test(text(p))) return id;
    return "style-and-accessories";
  }
  // What Louisiana men wear is Classic Style (owner 11-20: Huk, Costa, Columbia PFG, Simms, Southern Marsh ...), even a
  // fishing shirt or polarized sunglasses; then his words (a Thermapen is a grilling gift), then the gift type.
  if ((MENS_WEAR.has(t) || ["belt", "wallet", "underwear", "socks"].includes(t)) && !/\b(cooler|boots?)\b/i.test(p.name)) return "classic-style";
  for (const [id, words] of HIM_WORDS) if (words.test(text(p))) return id;
  for (const [id, types] of Object.entries(HIM_TYPES)) if (types.includes(t)) return id;
  return "classic-style";
}

// ---------------------------------------------------------------------------------------------------------------
// Relationship tags

/** A romantic pick: a partner's page only. */
const ROMANTIC = /\b(lingerie|bralette|negligee|boudoir|teddy|couples?|his (and|&) hers|date night|anniversary|massage oil)\b/i;
/** Too young or trendy for an in-law (owner 11-20: "no boots for grandmas or in-laws"). */
const TOO_YOUNG = /\b(boots?|claw clip|scrunchies?|crop(ped)?|bodysuit|cami|tank( top)?|lip (oil|tint|gloss|plump)|juicy tubes|y2k|pickleball|gaming|playstation|xbox|nintendo|controller|squish\w*|jellycat|bag charm|stoney clover|tennis dress|hoodie|samba|gazelle|veja|sneakers?|oversized)\b/i;
/** A pick named for one person ("Mom Rules Needlepoint Pillow", "Mom of the Year Tee") shows only on that page. */
const NAMED_FOR = [["mom", /\b(mom|moms|mama|mother)\b/i], ["dad", /\b(dad|dads|papa|father)\b/i], ["wife", /\bwife\b/i], ["husband", /\b(husband|hubby)\b/i]];

/** The relationship pages a pick shows on (`rels`), in the guide's chip order. */
export function relsOf(g, p) {
  const named = NAMED_FOR.filter(([, re]) => re.test(p.name)).map(([slug]) => slug).filter((slug) => g.rels.some((r) => r.slug === slug));
  if (named.length) return named;
  return g.rels.filter((r) => {
    if (ROMANTIC.test(text(p)) && !r.partner) return false;
    if (r.mature && (p.type === "boots" || p.tiktok === true || TOO_YOUNG.test(`${p.name} ${p.type ?? ""}`))) return false;
    return true;
  }).map((r) => r.slug);
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Rebuilds pageList.her and pageList.him in place (the Mom and Dad pages and the Siblings section leave). Returns the
 * counts and every spec rule that found nothing (`missing`, printed by the import, never dropped silently).
 */
export function applyPeople(pageList, spec = {}) {
  const counts = { her: {}, him: {}, cut: [], moved: 0, added: 0, overflow: [] };
  const missing = [];
  const storeRow = (href) => Object.entries(pageList).filter(([s]) => s.startsWith("store-")).flatMap(([, l]) => l).find((p) => p.href === href);
  const shownElsewhere = (href, except) => Object.entries(pageList).some(([s, l]) => !s.startsWith("store-") && !except.includes(s) && l.some((p) => p.href === href));
  for (const g of PEOPLE_GUIDES) {
    const own = [g.slug, ...g.sources.filter((s) => pageList[s] && s !== g.slug)];
    let pool = own.flatMap((s) => (pageList[s] ?? []).map((p) => ({ ...p, from: p.from ?? s })));
    for (const s of own) if (s !== g.slug) delete pageList[s];
    // The Siblings section of Family: its sister and brother picks join For Her and For Him.
    if (pageList.family) {
      pool.push(...pageList.family.filter((p) => g.sources.includes(p.from)));
      pageList.family = pageList.family.filter((p) => !g.sources.includes(p.from));
    }
    // Moves: a pick on another guide that fits this one best.
    for (const m of (spec.moves ?? []).filter((x) => x.to === g.slug)) {
      const list = pageList[m.guide] ?? [];
      const at = list.findIndex((p) => p.href === m.href);
      if (at === -1) { missing.push(`move ${m.guide} -> ${g.slug}: ${m.href} (${m.why ?? ""})`); continue; }
      const [p] = list.splice(at, 1);
      const { section: _s, sectionId: _i, ...bare } = p;
      pool.push({ ...bare, ...(m.type ? { type: m.type } : {}), from: m.from ?? g.slug });
      counts.moved += 1;
    }
    // Adds: a pick a store page already shows (its link, photo and checked price), on no other guide.
    for (const a of (spec.adds ?? []).filter((x) => x.guide === g.slug)) {
      const row = storeRow(a.href);
      if (!row || pool.some((p) => p.href === a.href) || shownElsewhere(a.href, [g.slug])) { missing.push(`add ${g.slug}: ${a.href} (${row ? "already on a guide" : "on no store page"})`); continue; }
      const { section: _s, sectionId: _i, ...bare } = row;
      pool.push({ ...bare, ...(a.commission != null && typeof bare.commission !== "number" ? { commission: a.commission } : {}), ...(a.type ? { type: a.type } : {}), from: a.from ?? g.slug });
      counts.added += 1;
    }
    // One row per link and per name.
    const seen = new Set();
    pool = pool.filter((p) => { const k = [p.href, fold(p.name)]; if (k.some((x) => seen.has(x))) return false; k.forEach((x) => seen.add(x)); return true; });
    // Taste.
    const rules = [...(g.slug === "her" ? HER_OUT : HIM_OUT), ...(spec.cuts ?? []).filter((c) => c.guide === g.slug).map((c) => ({ why: c.why, test: (p) => fold(p.name).includes(fold(c.match)) }))];
    for (const c of (spec.cuts ?? []).filter((x) => x.guide === g.slug)) if (!pool.some((p) => fold(p.name).includes(fold(c.match)))) missing.push(`cut ${g.slug}: ${c.match}`);
    pool = pool.filter((p) => {
      const r = rules.find((x) => x.test(p));
      if (r) counts.cut.push(`${g.slug}: ${p.name} (${r.why})`);
      return !r;
    });
    // Sections: Under $25 first, then each pick's interest.
    // A silk pillowcase is no decorative pillow, and a fire pit no grill: their own gift types for the type cap.
    pool = pool.map((p) => (/\bpillowcase\b/i.test(p.name) && p.type === "pillow" ? { ...p, type: "pillowcase" } : /\bfire ?pit\b/i.test(p.name) ? { ...p, type: "fire-pit" } : /\b(thermometer|thermapen)\b/i.test(p.name) ? { ...p, type: "thermometer" } : p));
    const ranked = pool.map((p, i) => ({ p, i })).sort((x, y) => rate(y.p) - rate(x.p) || x.i - y.i).map((x) => x.p);
    const bins = new Map(g.sections.map((s) => [s.id, []]));
    const fits = (list, p) => list.length < PEOPLE_SECTION_CAP && (!p.type || p.type === "other" || list.filter((x) => x.type === p.type).length < PEOPLE_TYPE_MAX);
    const left = [];
    // The owner's keeps (spec.keeps: the Dyson Airwrap in For Her, Mom filter) take their section first, past the type cap.
    const keeps = (spec.keeps ?? []).filter((k) => k.guide === g.slug);
    for (const k of keeps) if (!ranked.some((p) => fold(p.name).includes(fold(k.match)))) missing.push(`keep ${g.slug}: ${k.match}`);
    // A 25 Days sponsor's one spot and a joined Creator Connections campaign keep their place too (train 1120b/c rules).
    const keepOf = (p) => keeps.find((k) => fold(p.name).includes(fold(k.match))) ?? (p.sponsor === true || typeof p.campaignEnds === "string" ? { match: p.name } : undefined);
    for (const p of ranked.filter(keepOf)) bins.get(keepOf(p).section ?? interestOf(g.slug, p)).push({ ...p, keptRels: keepOf(p).rels });
    // His Classic Style leads with the brands Louisiana men wear (owner 11-20), each group by commission.
    if (g.slug === "him") ranked.sort((x, y) => Number(interestOf("him", y) === "classic-style" && LA_MEN_FIRST.test(String(y.brand ?? "").trim())) - Number(interestOf("him", x) === "classic-style" && LA_MEN_FIRST.test(String(x.brand ?? "").trim())));
    for (const p of ranked.filter((x) => !keepOf(x))) {
      if (under25(p) && fits(bins.get("under-25"), p)) bins.get("under-25").push(p);
      else left.push(p);
    }
    for (const p of left) {
      const id = interestOf(g.slug, p);
      if (fits(bins.get(id), p)) bins.get(id).push(p);
      else counts.overflow.push(`${g.slug}/${id}: ${p.name}`);
    }
    pageList[g.slug] = g.sections.flatMap((s) => bins.get(s.id).map((p) => {
      const { pinned: _p, keptRels, ...rest } = p;
      return { ...rest, section: s.title, sectionId: s.id, rels: keptRels ? [...new Set([...keptRels, ...relsOf(g, p)])] : relsOf(g, p) };
    }));
    counts[g.slug] = Object.fromEntries(g.sections.map((s) => [s.id, bins.get(s.id).length]));
    counts[g.slug].rels = Object.fromEntries(g.rels.map((r) => [r.slug, pageList[g.slug].filter((p) => p.rels.includes(r.slug)).length]));
  }
  return { counts, missing };
}
