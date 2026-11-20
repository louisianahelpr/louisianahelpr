/**
 * Gift-guide sort pass helpers (owner 2026-11-19 evening, 1119e train). Pure functions, read by scripts/gift-guide-picks.mjs
 * and by the guards (src/test/giftGuideSort1119e.test.ts):
 *   - COMMISSION ("Organize all of our gift guides by highest commission at the top"): every pick's effective rate, hidden
 *     from shoppers. ShopMy pins: commission_pct from the link files; Amazon: the Associates category base rate, or an
 *     opted-in Creator Connections campaign's total while it runs; Walmart: Walmart's category table; CJ / Awin / Rakuten:
 *     the program rate (Affiliate-approvals-1117.md); Later: the best-rates table; a plain shop link earns 0; unknown = null.
 *   - TYPE ("don't have 7 cup choices in 1 guide"): every pick's gift type, at most TYPE_MAX of one type per guide.
 *   - PLACEMENT: guides ranked by measured pageviews, then search demand (scripts/gift-guide-popularity.json).
 */

/** Non-store guides hold at most this many picks (owner 11-19 ~6:50 PM: "Only do 25 per guide"). */
export const GUIDE_CAP = 25;
/** At most this many picks of one gift type on a guide (owner 11-19: "don't have 7 cup choices in 1 guide"). */
export const TYPE_MAX = 2;
/** A guide under this many picks takes crowd-pleasers from the held pool (the judgment reviews 11-19). */
export const THIN_TARGET = 10;
/** The kinds of gift anyone is glad to get, from a recognizable brand (crowd-pleaser fill). */
export const CROWD_TYPES = new Set(["drinkware", "throw-blanket", "massage", "headphones", "speaker", "socks", "slippers", "candle", "cooler", "flashlight", "tools", "wallet", "tech-accessory", "bag", "hat", "sweatshirt", "eyewear", "board-game", "watch"]);
/** A Creator Connections swap needs the campaign total to beat the current link's rate by this many points (owner 11-19). */
export const CC_SWAP_MARGIN = 3;

/**
 * Gift types, first match wins (the more specific words first). "other" is never capped.
 * Each regex reads `${name} ${brand}`.
 */
export const TYPE_RULES = [
  ["gift-card", /\b(gift ?cards?|e-?gift|gift certificate)\b/i],
  ["subscription", /\b(subscription|membership|free trial|registry)\b/i],
  ["advent-calendar", /\badvent\b/i],
  ["gift-wrap", /\b(wrapping paper|gift wrap|gift bags?|gift tags?|ribbon|tissue paper|gift boxes)\b/i],
  ["stethoscope", /\bstethoscopes?\b/i],
  ["badge-reel", /\bbadge (reels?|holders?)\b/i],
  ["scrubs", /\bscrubs?\b(?! (brush|daddy))|\bfigs\b/i],
  ["compression-socks", /\bcompression socks?\b/i],
  ["belt", /\b(belts?|belt buckle)\b(?! bag)/i],
  ["eyewear", /\b(sunglasses|eyewear|blue light glasses|reading glasses)\b/i],
  ["glassware", /\b(wine glass(es)?|champagne flutes?|coupes?|highball|rocks glass(es)?|whiskey glass(es)?|decanter|carafe|stemless)\b/i],
  ["can-cooler", /\b(can cooler|can insulator|koozie|colster|slim can)\b/i],
  ["drinkware", /\b(tumblers?|quencher|mugs?|water bottles?|bottle|cups?|flask|rambler|iceflow|freesip|thermos|travel mug|sippy|magnebottle)\b/i],
  ["candle", /\b(candles?|wax melts?|reed diffuser|room spray|home fragrance)\b/i],
  ["robe", /\brobes?\b/i],
  ["pajamas", /\b(pajamas?|pj set|pjs|sleep ?set|sleepwear|nightgown|sleep shirt|lounge set)\b/i],
  ["slippers", /\b(slippers?|scuffs?|tasman|tazz|house shoes?)\b/i],
  ["socks", /\bsocks?\b/i],
  ["boots", /\bboots?\b|\bxtratuf\b/i],
  ["throw-blanket", /\b(blankets?|throws?|quilt|comforter)\b/i],
  ["sweatshirt", /\b(hoodie|hoody|sweatshirt|pullover|crewneck|crew neck|quarter[- ]zip|1\/4[- ]zip|half[- ]zip|fleece|sweater|cardigan)\b/i],
  ["jacket", /\b(jacket|vest|coat|parka|puffer|shacket|anorak|rain shell|windbreaker|bomber)\b/i],
  ["shirt", /\b(t-?shirts?|tees?|polo|button[- ]down|shirts?|henley|tank top|top)\b/i],
  ["pants", /\b(leggings?|joggers?|pants?|shorts?|sweatpants|align|overalls|jeans|skirt|dress)\b/i],
  ["underwear", /\b(boxers?|briefs|bra|bralette|underwear|undies)\b/i],
  ["hat", /\b(hat|cap|beanie|trucker|visor|bucket hat)\b/i],
  ["gloves-scarf", /\b(gloves|mittens|scarf|scarves|ear warmers?|neck gaiter)\b/i],
  ["shoes", /\b(sneakers?|shoes?|clogs?|sandals?|loafers?|slides?|mules?|crocs|clifton|bondi|wally|wendy|birkenstock|moccasins?|heydude|hey dude|oofos|on cloud\w*|brooks|hoka)\b/i],
  ["luggage", /\b(luggage|carry-?on|suitcase|weekender|duffel|duffle|garment bag)\b/i],
  ["bag", /\b(tote|backpack|bags?|purse|crossbody|belt bag|sling|pouch|clutch|cosmetic case|makeup case|fanny pack|lunch box|lunchbox)\b/i],
  ["wallet", /\b(wallet|card ?holder|money clip|card case|key ?chain|keyring|key fob)\b/i],
  ["watch", /\b(watch|watches|smartwatch|fitbit)\b/i],
  ["jewelry", /\b(necklace|bracelet|earrings?|huggies?|studs?|ring|rings|pendant|charm|charms|anklet|bangle|cuff|jewelry|locket|chain)\b/i],
  ["fragrance", /\b(perfume|eau de|cologne|parfum|fragrance|body mist|perfume oil|cheirosa|scent)\b/i],
  ["hair-tool", /\b(airwrap|hair ?dryer|blow ?dryer|straightener|flat iron|curling|hot brush|flexstyle|supersonic|hair styler|air styler|curler|airstrait|wavy)\b/i],
  ["haircare", /\b(shampoo|conditioner|hair oil|hair mask|scalp|dry shampoo|hair serum|hair treatment|detangl\w*|hair perfume)\b/i],
  ["hair-accessory", /\b(scrunchies?|claw clips?|hair clips?|headbands?|hair ties?|hair towel|bonnet)\b/i],
  ["nails", /\b(nail polish|press-?on|manicure|nail kit|nail set|cuticle)\b/i],
  ["makeup", /\b(lip(stick|gloss| gloss| oil| liner| tint| balm| butter| mask| treatment| set| kit)?|mascara|blush|bronzer|palette|foundation|concealer|eyeliner|brow|highlighter|setting spray|makeup|gloss|primer|eyeshadow|lash)\b/i],
  ["grooming", /\b(razor|shaver|trimmer|beard|shave|norelco|aftershave|grooming)\b/i],
  ["skincare", /\b(creams?|serum|moistur\w*|cleans\w*|face mask|sheet masks?|sleeping mask|lip mask|toner|sunscreen|spf|retinol|eye patch(es)?|balm|lotion|body butter|skincare|skin care|exfoliat\w*|body wash|hand wash|hand soap|scrub|bum bum|essence|peel|facial|skin|soap|bath bomb|bath salts?|body oil|deodorant)\b/i],
  ["headphones", /\b(headphones?|earbuds?|airpods|buds|earphones?|beats (studio|solo|fit|flex)|quietcomfort|wh-1000)\b/i],
  ["speaker", /\b(speakers?|soundlink|boombox|soundbar|wonderboom|flip \d|clip \d|charge \d)\b/i],
  ["camera", /\b(cameras?|instax|polaroid|camp snap|kodak|gopro|film)\b/i],
  ["digital-frame", /\b(digital (photo )?frame|aura frame|skylight frame)\b/i],
  ["tablet", /\b(kindle|ipad|tablet|e-?reader|remarkable)\b/i],
  ["gaming", /\b(nintendo|switch 2|xbox|playstation|ps5|controller|gaming|video games?|steam deck|meta quest|vr headset)\b/i],
  ["smart-home", /\b(echo|alexa|smart (plug|bulb|display|speaker)|ring doorbell|nest|skylight|calendar display|google home|kasa)\b/i],
  ["tech-accessory", /\b(chargers?|power ?bank|charging|cables?|magsafe|phone case|airtags?|tracker|stand|dock|usb|hub|mouse|keyboard|webcam|ring light|ssd|adapter|laptop sleeve|tile)\b/i],
  ["massage", /\b(massage|theragun|massager|percussion|heating pad|foot spa|shiatsu|hypervolt|mini gun)\b/i],
  ["fitness", /\b(yoga|dumbbells?|kettlebells?|weights|resistance bands?|jump rope|foam roller|fitness|workout|exercise|gym bag)\b/i],
  ["pillow", /\b(pillows?|pillowcases?|eye mask|sleep mask)\b/i],
  ["bedding", /\b(sheet sets?|sheets|duvet|bedding)\b/i],
  ["towel", /\b(towels?|bath sheet)\b/i],
  ["grill", /\b(grills?|smoker|blackstone|traeger|pizza oven|ooni|fire pit|solo stove|bonfire|smokeless)\b/i],
  ["kitchen-appliance", /\b(air fryer|blender|creami|slushi|espresso|coffee maker|coffee machine|keurig|nespresso|toaster|instant pot|multi-?cooker|pressure cooker|stand mixer|hand mixer|kitchenaid|frother|food processor|chopper|griddle|waffle maker|ice maker|kettle|grinder|juicer|possiblecooker|foodi|prepi|dutch oven)\b/i],
  ["cookware", /\b(skillet|pans?|pots?|cookware|baking dish|casserole|sheet pan|wok|cast iron|bakeware|roaster|cocotte|braiser)\b/i],
  ["knife", /\b(knife|knives|cutting board|cheese board|charcuterie board|butcher block)\b/i],
  ["grill-tool", /\b(meater|meat thermometer|grill (tool|set|brush)|bbq tools?|spatula set|rub)\b/i],
  ["cooler", /\b(coolers?|roadie|tundra|hopper|ice chest|igloo)\b/i],
  ["tools", /\b(multi-?tool|leatherman|drill|wrench|tool ?set|tool ?kit|screwdrivers?|sockets?|pliers|tape measure|impact driver|toolbox|work light|saw|tool bag|tool belt|hammer|level)\b/i],
  ["flashlight", /\b(flashlight|headlamp|lantern|work light)\b/i],
  ["fishing", /\b(lures?|fishing|rods?|reels?|tackle|bait|bobbers?|crankbait|spinnerbait)\b/i],
  ["hunting", /\b(hunting|decoys?|duck calls?|game calls?|deer|blind|turkey call|trail cam)\b/i],
  ["golf", /\b(golf|putter|tees|divot)\b/i],
  ["board-game", /\b(board game|card game|games?|dominoes|cornhole|mah ?j(on)?gg?|uno|jenga|monopoly|catan|scrabble|chess|playing cards|trivia)\b/i],
  ["puzzle", /\b(puzzles?|jigsaw)\b/i],
  ["building-toy", /\b(lego|duplo|magna-?tiles|blocks|k'nex|building set|tegu|picasso tiles|marble run)\b/i],
  ["plush", /\b(plush|stuffed|jellycat|squishmallows?|teddy|soft toy|lovey)\b/i],
  ["doll", /\b(dolls?|barbie|american girl|figures?|playset|dollhouse|figurines?)\b/i],
  ["fidget", /\b(fidget|squish\w*|needoh|nee doh|pop it|slime|stress ball)\b/i],
  ["toy-vehicle", /\b(hot wheels|rc car|remote control|toy truck|monster truck|train set|matchbox)\b/i],
  ["ride-on", /\b(scooter|bike|balance bike|skateboard|ride-on|hoverboard|wagon)\b/i],
  ["toy", /\b(toys?|play-?doh|kit for kids|kids'? kit|science kit|stem kit|craft kit|bath toys|baby toys?|sensory|walkie|yoto|tonies|toniebox)\b/i],
  ["book", /\b(books?|novel|hardcover|paperback|cookbook|box set)\b/i],
  ["stationery", /\b(journal|planner|notebooks?|pens?|stationery|notepads?|stickers?|calendar|agenda|sticky notes|highlighters?)\b/i],
  ["art-supplies", /\b(paints?|markers|sketch\w*|colored pencils|watercolors?|art set|needlepoint|embroidery|knitting|crochet|diamond art|paint by number|cricut|sewing)\b/i],
  ["ornament", /\b(ornaments?)\b/i],
  ["decor", /\b(sign|prints?|wall art|vase|frames?|tray|coasters?|bookends|sculpture|wreath|door ?mat|poster|canvas|wall decor|garland|lamp|clock|mirror)\b/i],
  ["plant", /\b(plants?|succulents?|bonsai|terrarium|planters?|seeds?|bulbs|orchid|flowers?|bouquet)\b/i],
  ["garden", /\b(garden\w*|pruners?|hose|watering|bird feeder|bird ?house|raised bed|shovel|trowel)\b/i],
  ["pet", /\b(dogs?|cats?|pupp(y|ies)|kittens?|pets?|leash|collar|litter|chews?|catnip|horse|equine|saddle|bridle|aquarium|fish tank|bird cage)\b/i],
  ["coffee", /\b(coffee|k-?cups?|cold brew|tea|teas|matcha|latte|cafe du monde|chicory)\b/i],
  ["wine-bar", /\b(wine|cocktail|bar set|shaker|whiskey|bourbon|beer|corkscrew|aerator|ice mold|bitters|mixers?|margarita|daiquiri|hurricane mix)\b/i],
  ["food", /\b(chocolates?|candy|candies|pralines?|cookies?|popcorn|snacks?|sauce|seasoning|spices?|hot sauce|jerky|cheese|gumbo|king cake|beignets?|jam|honey|nuts|pecans|toffee|fudge|caramels?|bbq|cajun|creole|roux|jambalaya|etouffee|crawfish|boudin|cake|brownies|treats|gift basket|sampler|pantry|syrup)\b/i],
  ["auto", /\b(car|dash ?cam|tire|jump starter|auto|seat cover|truck|steering)\b/i],
  ["cleaning", /\b(vacuum|mop|robot vac|carpet cleaner|steam cleaner|little green|cleaner)\b/i],
  ["outdoor", /\b(hammock|camping|tent|camp chair|chair|kayak|paddle|life jacket|binoculars|tarp|sleeping bag|backpacking)\b/i],
  ["baby", /\b(baby|infant|onesie|bibs?|swaddle|teether|pacifier|stroller|carrier|rattle|crib|nursery|newborn|diaper|bottle warmer|sound machine|hatch)\b/i],
  ["music", /\b(vinyl|record player|turntable|guitar|ukulele|instrument|piano|keyboard piano|drum)\b/i],
  ["experience", /\b(tickets?|class|workshop|lessons?|tour|experience|spa day|massage session)\b/i],
  ["umbrella", /\b(umbrella)\b/i],
  ["desk", /\b(desk|standing desk|monitor stand|office chair|desk pad|desk organizer)\b/i],
  ["water-filter", /\b(water filter|filtration|pitcher filter|reverse osmosis)\b/i],
  ["bath", /\b(bath|shower|loofah|bathrobe)\b/i],
];
/** A pick's gift type (its name, then its brand). */
/** Words read in the singular too ("Shavers" is a shaver), so each rule names one form. */
const singular = (s) => s.replace(/\b([a-z]{3,}[^s\W])s\b/gi, "$1");
/** A beauty brand's set (gift set, trio, kit): a skincare set, whatever its first product is. */
const BEAUTY_SET = /\b(gift set|trio|duo|holiday set|discovery set|value set|kit|collection|set)\b/i;
const BEAUTY_BRAND = /\b(l'?occitane|sol de janeiro|laneige|glossier|rare beauty|summer fridays|glow recipe|tatcha|drunk elephant|clinique|kiehl'?s|est[eé]e lauder|lanc[oô]me|elemis|too faced|bobbi brown|smashbox|aveda|dr\.? ?jart|lab series|dermalogica|origins|benefit|tarte|charlotte tilbury|fresh|ouai|olaplex|kitsch|bubble|beekman 1802|burt'?s bees|e\.l\.f\.|elf|nars|dior beauty|byoma|cerave|la roche-posay|bioderma|hero cosmetics|cosrx|kiko|true botanicals|borghese|dhc|o boticario|badger|bath & body works|philosophy|necessaire|nécessaire|youth to the people)\b/i;
export const pickType = (p) => {
  const name = String(p?.name ?? "");
  const brand = String(p?.brand ?? "");
  let type = "other";
  for (const text of [name, `${name} ${brand}`]) {
    const hit = TYPE_RULES.find(([, re]) => re.test(text) || re.test(singular(text)));
    if (hit) { type = hit[0]; break; }
  }
  // A beauty brand's set is a skincare set, unless its kind is clearly something else (a shave set, a perfume, a candle).
  if (BEAUTY_BRAND.test(`${brand} ${name}`) && BEAUTY_SET.test(name) && !["grooming", "fragrance", "hair-tool", "candle", "drinkware", "bag", "robe", "pajamas", "nails", "makeup"].includes(type)) return "skincare";
  return type;
};

/**
 * A guide whose topic IS a type keeps more of it (Book Lover lists books; a kids' guide lists several kinds of toy). Every
 * other type there still caps at TYPE_MAX.
 */
const FOOD_GUIDES = ["louisiana-pantry", "louisiana-sweets-and-bakeries", "treats-and-food-gifts", "crawfish-season", "coffee-and-beignets", "louisiana-kitchen", "crawfish-boil-host", "mardi-gras", "louisiana-made", "new-orleans", "acadiana", "baton-rouge", "north-louisiana", "louisiana-small-businesses"];
const PET_GUIDES = ["dog-lover", "cat-person", "new-puppy", "new-kitten", "horse-lover", "fish-lover", "bird-lover", "vets-and-vet-techs"];
const KID_GUIDES = ["kids", "girls", "boys", "gender-neutral", ...["girls", "boys", "gender-neutral"].flatMap((g) => ["babies", "toddlers", "little-kids", "big-kids"].map((a) => `${g}-${a}`))];
const BABY_GUIDES = ["girls-babies", "boys-babies", "gender-neutral-babies", "new-mom", "mom-to-be", "new-dad", "new-grandparent"];
export const THEME_TYPES = {
  ...Object.fromEntries(FOOD_GUIDES.map((g) => [g, { food: 10, coffee: 4 }])),
  ...Object.fromEntries(PET_GUIDES.map((g) => [g, { pet: 12 }])),
  ...Object.fromEntries(KID_GUIDES.map((g) => [g, { toy: 4, "building-toy": 3, plush: 3, doll: 3 }])),
  ...Object.fromEntries(BABY_GUIDES.map((g) => [g, { baby: 6 }])),
  "gift-cards": { "gift-card": 25 }, subscriptions: { subscription: 25 }, "advent-calendars": { "advent-calendar": 25 },
  "gift-tags": { "gift-wrap": 25, other: 25 }, "gift-wrap-and-cards": { "gift-wrap": 12, stationery: 8 },
  "book-lover": { book: 8, stationery: 3 }, "coffee-lover": { coffee: 5 }, "wine-lover": { "wine-bar": 5, glassware: 3 },
  fishermen: { fishing: 4 }, hunters: { hunting: 4 }, golfer: { golf: 5 }, "grill-master": { grill: 3, "grill-tool": 3, food: 3 },
  gamer: { gaming: 5 }, "self-care-lover": { skincare: 4 }, "spa-days": { skincare: 4 }, "plant-lover": { plant: 5 }, gardener: { garden: 4, plant: 3 },
  crafter: { "art-supplies": 5 }, artist: { "art-supplies": 5 }, "music-lover": { music: 4 }, runner: { shoes: 3, fitness: 3 }, "gym-lover": { fitness: 4 },
  "stocking-stuffers": { food: 3 }, "25-days-sponsors": { other: 99 },
};
export const typeMax = (slug, type) => (type === "other" ? Infinity : THEME_TYPES[slug]?.[type] ?? TYPE_MAX);

const compact = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * AMAZON ASSOCIATES base rates (Affiliate-approvals-1117.md "Best rate per brand", read Nov 18): 1% grocery / health /
 * video games, 3% toys / home / beauty / sports / pet / tools, 4% clothing / shoes / electronics, 4.5% kitchen / books,
 * 10% luxury beauty.
 */
export const LUXURY_BEAUTY = /\b(kiehl'?s|lanc[oô]me|clinique|est[eé]e lauder|elemis|too faced|bobbi brown|smashbox|aveda|bumble and bumble|dr\.? ?jart|lab series|dermalogica|origins|la mer|tom ford|tatcha|drunk elephant|sunday riley|peter thomas roth|murad|first aid beauty|living proof|briogeo|ouai|true botanicals|borghese|laneige|sol de janeiro|glow recipe|summer fridays|benefit|tarte|charlotte tilbury|nars|urban decay|fresh|olaplex)\b/i;
const AMAZON_BY_TYPE = {
  food: 1, coffee: 1, "wine-bar": 1, gaming: 1, "gift-card": 0, subscription: null,
  skincare: 3, makeup: 3, fragrance: 3, haircare: 3, nails: 3, "hair-accessory": 3, grooming: 3, toy: 3, "building-toy": 3, plush: 3, doll: 3, fidget: 3, "toy-vehicle": 3, "ride-on": 3,
  "board-game": 3, puzzle: 3, pet: 3, tools: 3, flashlight: 3, fishing: 3, hunting: 3, golf: 3, fitness: 3, outdoor: 3, cooler: 3, decor: 3, ornament: 3, candle: 3, plant: 3, garden: 3,
  "throw-blanket": 3, pillow: 3, bedding: 3, towel: 3, bath: 3, cleaning: 3, baby: 3, "art-supplies": 3, "can-cooler": 3, auto: 3, massage: 3, "water-filter": 3, desk: 3, umbrella: 3,
  sweatshirt: 4, jacket: 4, shirt: 4, pants: 4, underwear: 4, hat: 4, "gloves-scarf": 4, socks: 4, "compression-socks": 4, scrubs: 4, pajamas: 4, robe: 4, slippers: 4, shoes: 4, boots: 4,
  bag: 4, luggage: 4, wallet: 4, watch: 4, jewelry: 4, eyewear: 4, headphones: 4, speaker: 4, camera: 4, tablet: 4, "tech-accessory": 4, "smart-home": 4, "digital-frame": 4, music: 4, stethoscope: 4, "badge-reel": 4,
  "kitchen-appliance": 4.5, cookware: 4.5, knife: 4.5, drinkware: 4.5, glassware: 4.5, grill: 4.5, "grill-tool": 4.5, book: 4.5, stationery: 4.5, "hair-tool": 4.5,
};
export const amazonBaseRate = (p) => {
  const type = pickType(p);
  if (["skincare", "makeup", "fragrance", "haircare"].includes(type) && LUXURY_BEAUTY.test(`${p.brand ?? ""} ${p.name}`)) return 10;
  const r = AMAZON_BY_TYPE[type];
  return r === undefined ? 3 : r;
};
/**
 * WALMART Creator rates (the same table on Later): apparel / shoes / jewelry 14%, home / beauty 4.2%, tools 3.5%, toys /
 * electronics / kitchen / sports 2.8%, grocery 0%.
 */
const WALMART_APPAREL = new Set(["sweatshirt", "jacket", "shirt", "pants", "underwear", "hat", "gloves-scarf", "socks", "pajamas", "robe", "slippers", "shoes", "boots", "jewelry", "bag", "wallet", "watch", "eyewear", "scrubs", "compression-socks"]);
const WALMART_HOME_BEAUTY = new Set(["skincare", "makeup", "fragrance", "haircare", "nails", "hair-accessory", "grooming", "candle", "decor", "ornament", "throw-blanket", "pillow", "bedding", "towel", "bath", "plant", "garden"]);
export const walmartRate = (p) => {
  const t = pickType(p);
  if (["food", "coffee", "wine-bar"].includes(t)) return 0;
  if (WALMART_APPAREL.has(t)) return 14;
  if (WALMART_HOME_BEAUTY.has(t)) return 4.2;
  if (["tools", "flashlight", "auto"].includes(t)) return 3.5;
  return 2.8;
};
/** CJ / Awin / Rakuten program rates by brand (Affiliate-approvals-1117.md, read 2026-11-19). */
export const NETWORK_RATES = {
  xtratuf: 15, georgiaboot: 12, freecountry: 10, durango: 6, durangoboots: 6, muck: 4, muckboot: 4, muckbootcompany: 4, soundcore: 7, ugreen: 8, monoprice: 10, marshall: 5, marshallheadphones: 5,
  oklahomajoes: 3, switchbot: 6, xsense: 9, nanit: 5, aiper: 8, clickandgrow: 10, singer: 6, dreampairs: 8, magnifique: 10, thefidgetcompany: 20, fidgetcompany: 20, imarku: 15, fortkit: 15,
  ecreamery: 10, baleaf: 10, rockbottomgolf: 4, tushbaby: null,
};
const CJ_HOSTS = /(^|\.)(anrdoezrs\.net|kqzyfj\.com|jdoqocy\.com|tkqlhce\.com|dpbolvw\.net|emjcd\.com)$/;
const AWIN_HOSTS = /(^|\.)awin1\.com$/;
const RAKUTEN_HOSTS = /(^|\.)(linksynergy\.com|click\.linksynergy\.com)$/;
export const asinOf = (href) => String(href ?? "").match(/amazon\.com\/(?:[^?]*\/)?dp\/([A-Z0-9]{10})/)?.[1] ?? null;
const pct = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)\s*%?/);
  return m ? Number(m[1]) : null;
};
export const pinIdOf = (href) => String(href ?? "").match(/go\.shopmy\.us\/p-(\d+)/)?.[1] ?? null;

/**
 * The rates data, read once: { pinRate: id -> pct, hrefRate: href -> pct, cc: asin -> campaign, laterRate: brandKey -> pct,
 * otherRates: brandKey -> { network: pct } , clicks: id -> n }.
 */
export const buildRateData = ({ shopmyTsv = "", rowsWithRate = [], campaigns = [], bestRates = {} } = {}) => {
  const pinRate = new Map();
  const clicks = new Map();
  for (const line of shopmyTsv.split("\n").slice(1)) {
    const [id, , , rate, , click] = line.split("\t");
    const n = /^p-(\d+)$/.exec(String(id ?? "").trim())?.[1];
    if (!n) continue;
    const r = pct(rate);
    if (r !== null) pinRate.set(n, r);
    const c = Number(String(click ?? "").replace(/[^0-9]/g, ""));
    if (c > 0) clicks.set(n, c);
  }
  const hrefRate = new Map();
  for (const r of rowsWithRate) {
    const v = pct(r.commission_pct);
    if (v === null) continue;
    for (const h of [r.href, r.affiliate_href]) if (typeof h === "string" && !hrefRate.has(h)) hrefRate.set(h, v);
  }
  const cc = new Map();
  for (const c of campaigns) {
    if (!c || c.opted_in === false) continue;
    for (const a of Array.isArray(c.asins) ? c.asins : []) cc.set(a, { id: c.campaign_id, brand: c.brand, total: Number(c.total_pct), bonus: Number(c.bonus_pct), ends: String(c.ends ?? ""), starts: String(c.starts ?? "") });
  }
  const laterRate = new Map();
  const otherRates = new Map();
  for (const [k, v] of Object.entries(bestRates ?? {})) {
    const all = v?.all ?? {};
    otherRates.set(k, all);
    const l = pct(all.Later);
    if (typeof all.Later === "number" && l !== null) laterRate.set(k, l);
  }
  return { pinRate, hrefRate, cc, laterRate, otherRates, clicks };
};
/** A campaign runs on `today` (YYYY-MM-DD): started and not yet ended. */
export const ccLive = (c, today) => Boolean(c) && (!c.starts || c.starts <= today) && (!c.ends || c.ends >= today);

/** A pick's effective commission: { pct: number | null, source }. */
export const commissionOf = (p, data, today) => {
  let host = "";
  try { host = new URL(p.href).hostname; } catch { return { pct: null, source: "bad link" }; }
  const brandK = compact(p.brand);
  if (/(^|\.)amazon\.com$|^amzn\.to$/.test(host)) {
    const c = data.cc.get(asinOf(p.href));
    if (c && ccLive(c, today)) return { pct: c.total, source: `Amazon Creator Connections (ends ${c.ends})` };
    return { pct: amazonBaseRate(p), source: "Amazon Associates base" };
  }
  if (host === "go.shopmy.us") {
    const id = pinIdOf(p.href);
    const r = (id && data.pinRate.get(id)) ?? data.hrefRate.get(p.href);
    return r === undefined || r === null ? { pct: null, source: "ShopMy (rate unknown)" } : { pct: r, source: "ShopMy" };
  }
  if (host === "shopmy.us") return { pct: data.hrefRate.get(p.href) ?? null, source: "ShopMy collection" };
  if (host === "mavely.app.link") {
    const r = data.hrefRate.get(p.href) ?? data.laterRate.get(brandK);
    return { pct: r ?? null, source: r === undefined ? "Later (rate unknown)" : "Later" };
  }
  if (host === "walmrt.us" || /(^|\.)walmart\.com$/.test(host)) return { pct: data.hrefRate.get(p.href) ?? walmartRate(p), source: "Walmart Creator" };
  if (CJ_HOSTS.test(host) || AWIN_HOSTS.test(host) || RAKUTEN_HOSTS.test(host)) {
    const net = CJ_HOSTS.test(host) ? "CJ" : AWIN_HOSTS.test(host) ? "Awin" : "Rakuten";
    const r = data.hrefRate.get(p.href) ?? NETWORK_RATES[brandK] ?? NETWORK_RATES[brandK.replace(/(us|usa|boots?)$/, "")];
    return { pct: r ?? null, source: r === undefined || r === null ? `${net} (rate unknown)` : net };
  }
  const r = data.hrefRate.get(p.href);
  if (r !== undefined) return { pct: r, source: "link file" };
  // A plain shop link (Louisiana shops, sponsors, brand sites): no affiliate program, earns nothing.
  return { pct: 0, source: "plain link (no program)" };
};

/**
 * Creator Connections swap: the campaign product of the same brand whose title carries every word of the pick's name
 * (sizes, colors and the brand left out), when the campaign is live and beats `current` by CC_SWAP_MARGIN.
 */
const STOP = new Set(["the", "and", "with", "for", "set", "gift", "mini", "size", "pack", "piece", "pieces", "women", "womens", "men", "mens", "unisex", "new", "edition", "holiday", "limited"]);
export const nameWords = (name, brand) => {
  const b = compact(brand);
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w) && w !== b && !b.includes(w) || false);
};
export const ccTwin = (p, products, data, today, current) => {
  const words = nameWords(p.name, p.brand);
  if (words.length < 2) return null;
  const b = compact(p.brand);
  if (!b) return null;
  let best = null;
  for (const x of products) {
    const c = data.cc.get(x.asin);
    if (!c || !ccLive(c, today)) continue;
    if (!compact(x.brand).startsWith(b.slice(0, 5)) && !b.startsWith(compact(x.brand).slice(0, 5))) continue;
    const title = String(x.title ?? "").toLowerCase();
    if (!words.every((w) => title.includes(w))) continue;
    if (c.total < (current ?? 0) + CC_SWAP_MARGIN) continue;
    if (!best || c.total > best.c.total) best = { x, c };
  }
  return best;
};

/**
 * A brand-link row no placement file names goes to the guides its ShopMy section points at (lead 11-19: "Import ALL brand
 * links"); every page rule and the judgment cuts still gate it there.
 */
export const SECTION_GUIDES = {
  women: ["her", "wife", "girlfriend", "sister", "best-friend"], beauty: ["self-care-lover", "her", "sister", "best-friend"], travel: ["traveler"],
  home: ["new-homeowner", "homebody", "hostess"], men: ["him", "boyfriend-or-husband", "brother"], kids: ["gender-neutral-little-kids", "gender-neutral-big-kids"],
  "stocking stuffers": ["stocking-stuffers", "under-25"], sneakers: ["her", "girls-teens"], louisiana: ["louisiana-made"], drinkware: ["coworkers", "under-50"],
  "home & garden": ["gardener", "new-homeowner"], "book lovers": ["book-lover"], baby: ["new-mom", "gender-neutral-babies"], tech: ["him", "college-student", "coworkers"],
  bags: ["traveler", "her"], coffee: ["coffee-lover"], "holiday gift sets": ["self-care-lover", "her"], "kids art": ["gender-neutral-big-kids", "gender-neutral-little-kids"],
  "teen beauty": ["girls-teens"], teen: ["gender-neutral-teens"], teens: ["gender-neutral-teens"], fragrance: ["her", "wife"], "recovery shoes": ["runner", "rns"],
  "beauty gift sets": ["self-care-lover", "mom"], shoes: ["her"], cookware: ["home-cook"], kitchen: ["home-cook", "newlyweds"], "dog lover": ["dog-lover"],
  fishing: ["fishermen"], "nurse gifts": ["rns", "nursing-students"], "crafty gifts": ["crafter"], "pets / dog lovers": ["dog-lover"], "louisiana cooking": ["louisiana-kitchen"],
  pajamas: ["homebody", "her"], "kids toys": ["gender-neutral-little-kids"], "pokémon cards": ["boys-big-kids", "gamer"], pets: ["dog-lover", "cat-person"],
  "self-care": ["self-care-lover"], "game night": ["couples", "white-elephant"], "new moms": ["new-mom"], "beauty & sleep": ["self-care-lover"], "beauty tech": ["self-care-lover"],
  "men's outdoors": ["hunters", "fishermen"], wallets: ["him", "dad"], boots: ["farmers"], speakers: ["music-lover"], stationery: ["coworkers"],
  "kids / toddlers": ["gender-neutral-toddlers"], "pets / dog stocking stuffers": ["dog-lover", "new-puppy"], golf: ["golfer"], headphones: ["music-lover"],
  candles: ["hostess", "homebody"], "stocking stuffers / beauty": ["stocking-stuffers"], "water bottles": ["gym-lover"], activewear: ["gym-lover"], "for him & her": ["couples"],
  "beauty / skincare": ["self-care-lover"], "beauty / makeup": ["her"], "tumblers & water bottles": ["coworkers"], "sweatshirts & hoodies": ["her"], "men's sweatshirts & hoodies": ["him"],
  loungewear: ["homebody"], outdoors: ["camper"], hostess: ["hostess"], grandparents: ["grandparents"], slippers: ["homebody"], games: ["couples"], sunglasses: ["beach-lover"],
  "kids shoes": ["gender-neutral-big-kids"], "stocking stuffers / cooks": ["home-cook"], "women / beach & pool": ["beach-lover"], "beauty / hair tools": ["self-care-lover"],
  "body lotions & creams": ["self-care-lover", "her"],
};
export const sectionGuides = (section) => SECTION_GUIDES[String(section ?? "").trim().toLowerCase()] ?? [];

/** Guide popularity rank (0 = most popular): measured pageviews, then the search-demand order, then the index order. */
export const guideRanks = (popularity, slugs) => {
  const views = popularity?.pageviews ?? {};
  const demand = popularity?.searchDemand ?? [];
  const at = (s) => { const i = demand.indexOf(s); return i < 0 ? 999 : i; };
  const order = [...slugs].map((s, i) => ({ s, v: views[s] ?? 0, d: at(s), i })).sort((a, b) => b.v - a.v || a.d - b.d || a.i - b.i);
  return new Map(order.map((x, i) => [x.s, i]));
};

/** Recognizable brands (owner: "brand recognizability" counts toward item popularity). */
export const KNOWN_BRAND = /^(yeti|stanley|owala|apple|dyson|lululemon|ugg|nike|adidas|hoka|sol de janeiro|laneige|rare beauty|glow recipe|summer fridays|kendra scott|barefoot dreams|slip|kiehl'?s|clinique|est[eé]e lauder|lanc[oô]me|ninja|sharkninja|shark|le creuset|our place|carhartt|xtratuf|huk|costa|columbia|patagonia|the north face|bose|beats|jbl|sony|lego|jellycat|squishmallows|crocs|heydude|birkenstock|theragun|therabody|kitsch|stoney clover( lane)?|baublebar|mejuri|gorjana|vuori|on|brooks|traeger|blackstone|solo stove|leatherman|garmin|ray-?ban|oakley|kindle|amazon|nintendo|polaroid|fujifilm|instax|skims|free people|anthropologie|madewell|j\.crew|hydro flask|bombas|cotopaxi|burt'?s bees|capri blue|voluspa|nest|boy smells|bath & body works|tatcha|charlotte tilbury|dior|too faced|bobbi brown|under armour|logitech|magna-tiles|melissa & doug|pokemon|pok[eé]mon|hape|calpak|b[eé]is|away|bellroy|ooni|weber|lodge|keurig|nespresso|kitchenaid|cuisinart|vitamix|breville|fellow|hatch|loveseat|tonies|yoto)$/i;
export const itemPopularity = (p, data, flags = {}) => {
  let n = 0;
  if (p.trending || flags.trending) n += 30;
  if (flags.bestSeller) n += 20;
  const id = pinIdOf(p.href);
  if (id) n += Math.min(30, (data.clicks.get(id) ?? 0) * 3);
  if (KNOWN_BRAND.test(String(p.brand ?? "").trim())) n += 15;
  if (p.ownerPick) n += 5;
  return n;
};

/** Commission high to low; unknown (null) last; ties by popularity, then the earlier slot. Stable. */
export const byCommission = (a, b) => {
  const ca = typeof a.commission === "number" ? a.commission : -1;
  const cb = typeof b.commission === "number" ? b.commission : -1;
  return cb - ca || (b._pop ?? 0) - (a._pop ?? 0) || (a._at ?? 0) - (b._at ?? 0);
};
