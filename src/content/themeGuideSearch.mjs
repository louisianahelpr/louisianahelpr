/**
 * Search words for the themed kids guides (owner 2026-11-25 1:15 AM: "Add the guides so they are seen in Google
 * searches and with other ai searches"). Before this, every theme's <title> was just its name ("Monster Jam gift guide
 * — Helpr"), its description named its three cheapest picks, and llms.txt said "hand-picked holiday gift ideas ... with
 * a link to shop each one" while Her, Him and Kids had keyword titles (src/content/guideSearch.mjs).
 *
 * Everything here is built from the theme's own picks, so a new theme (THEME_GUIDE_NAMES_1124 in giftGuideLive.mjs)
 * gets it with no edit: the count, the lowest and highest price a card shows, what the gifts are (clothes, plush,
 * trucks... read from the pick names by KINDS below, the most common first), and the stores that sell the priced ones.
 * One function for the head (giftGuidePageMeta.mjs, before and after JS), the visible intro (GuideQa.tsx and the
 * pre-JS body, seoBodies.mjs) and the llms.txt line (scripts/generate-llms-txt.mjs), so they cannot drift.
 * Plain words: no hype, no "y'all", no dates to act by, no emoji. Prices are the card's rounded dollars, and only where
 * the card shows one on `today` (pickPriceShown.mjs).
 * Plain dependency-light ESM: api/share.ts and the guide page both import it. Types: themeGuideSearch.d.mts.
 * Guard: src/test/themeGuideSearch1125.test.ts.
 */

import { pickPriceShown, shownDollars } from "../lib/pickPriceShown.mjs";

/** The longest <title> a theme gets, " — Helpr" included (Google cuts by width; past this the brand alone is cut). */
export const THEME_TITLE_MAX = 70;
/** The longest description Google shows before cutting it (as guideSearch.mjs MAX_DESCRIPTION). */
export const THEME_DESCRIPTION_MAX = 155;

/**
 * What a gift is, from words in its own name: [kind, words, unless]. First match wins (clothes before plush, so "Plush
 * Sleep Pants" are clothes; plush before room decor, so a "Plush Pillow Buddy" is plush, but a "Plush Throw" is room
 * decor). A name no kind matches is a toy. Gift wrap ("") is never named. A kind is named in the title only when at
 * least MIN_KIND gifts are of it.
 */
export const KINDS = [
  ["", /\b(wrapping paper|gift wrap|gift bags?|tissue paper)\b/i],
  ["clothes", /\b(pajamas?|pjs?|jammies|sleepwear|sleep pants|shirts?|t-shirts?|tees?|hoodies?|sweatshirts?|sweaters?|pullovers?|quarter-zip|zip-up|socks|hats?|caps?|beanies?|jackets?|coats?|dress(es)?|leggings|slippers?|shoes|sneakers|boots|clogs?|crocs|costumes?|gloves|mittens|pants|shorts|shortalls|trunks|rash guard|robes?|rompers?|onesies?|bodysuits?|swimsuits?|underwear|briefs|joggers|outfits?|jerseys?|apparel|tops?)\b/i, /\b(blankets?|throws?)\b/i],
  ["plush", /\b(plush(ies)?|stuffed|squishmallows?|pillow buddy)\b/i, /\b(blankets?|throws?)\b/i],
  ["room decor", /\b(blankets?|throws?|pillows?|pillowcases?|bedding|sheets?|sheet set|comforters?|duvet|lamps?|night ?lights?|decals?|posters?|rugs?|curtains?|ornaments?|stockings?|tree toppers?|wall art|hampers?|towels?|bath wrap)\b/i],
  ["school gear", /\b(backpacks?|lunch ?(box|bag)|water bottles?|tumblers?|cups?|pencils?)\b/i],
  ["books", /\b(books?|storybooks?)\b/i],
  ["games", /\b(games?|puzzles?|trading cards?|booster|card deck)\b/i],
  ["LEGO sets", /\b(lego|mega bloks|building (set|kit|blocks))\b/i],
  ["trucks", /\b(trucks?)\b/i],
  ["cars", /\b(die-?cast|cars?|vehicles?)\b/i],
];
const MIN_KIND = 3;

/** "A, B and C" (with "&" for the title). */
function joinWords(words, and = "and") {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} ${and} ${words[words.length - 1]}`;
}

/** A pick name cut at its first comma, dash or bracket for a description, or "" past 48 characters (never cut mid-name). */
function shortName(name) {
  const s = String(name ?? "").split(/,| - | – | \| | \(/)[0].trim();
  return s.length > 48 ? "" : s;
}

/** The kind of one pick name (KINDS), or "toys". */
export function giftKind(name) {
  const n = String(name ?? "");
  for (const [kind, re, unless] of KINDS) if (re.test(n) && !(unless && unless.test(n))) return kind;
  return "toys";
}

/**
 * The facts every line is built from. `picks`: the guide's picks as [{ name, price?, priceAt?, priceFrom?, store }]
 * (`store` is the store's shown name, "Walmart"); `count`: how many gifts the page lists (its unique links).
 */
export function themeGuideFacts(picks, count, today) {
  const rows = (Array.isArray(picks) ? picks : []).filter((p) => p && typeof p.name === "string" && p.name);
  const n = Number(count) || rows.length;
  const priced = rows.filter((p) => pickPriceShown(p.price, p.priceAt, today));
  const dollars = priced.map((p) => shownDollars(p.price));
  const min = dollars.length ? Math.min(...dollars) : null;
  const max = dollars.length ? Math.max(...dollars) : null;
  const top = priced.length ? priced.reduce((a, b) => (shownDollars(b.price) > shownDollars(a.price) ? b : a)) : null;
  const tally = (list) => [...list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kinds = tally(rows.map((p) => giftKind(p.name))).filter(([k, c]) => k && c >= MIN_KIND).map(([k]) => k);
  const stores = tally(priced.map((p) => String(p.store ?? "").trim()).filter((s) => s && !/^a /i.test(s))).map(([s]) => s);
  return {
    count: n,
    priced: priced.length,
    min,
    max,
    topName: top && !top.priceFrom ? shortName(top.name) : "",
    stocking: dollars.filter((d) => d < 10).length,
    kinds,
    stores,
  };
}

/**
 * A theme's title, description, card title and visible intro, or null with no picks. `name` is the theme's name
 * ("Monster Jam"); the rest as themeGuideFacts.
 */
export function themeGuideSearch(name, picks, count, today, { deals = false } = {}) {
  const f = themeGuideFacts(picks, count, today);
  if (!f.count) return null;
  const theme = String(name ?? "").trim();
  // A store deals guide (Sam's Club Black Friday, owner 11-25; giftGuideLive.mjs isDealTheme) says "deals", never "for kids".
  const gifts = deals ? "deals" : "gifts";
  // Title: the theme's own gift words, the most common kinds first, then stocking stuffers when it has any.
  const tail = f.stocking ? ["stocking stuffers"] : [];
  const titles = [3, 2, 1, 0].map((k) => {
    const words = [...f.kinds.slice(0, k), ...tail];
    return words.length ? `${theme} ${gifts} 2026: ${joinWords(words, "&")} — Helpr` : deals ? `${theme} deals 2026 — Helpr` : `${theme} Christmas gifts 2026 — Helpr`;
  });
  // A deals guide's title names its count of deals, not gift kinds (a sale list mixes TVs, mixers and lip balm).
  const dealTitles = [`${theme} deals 2026: ${f.count} gifts on sale — Helpr`, `${theme} deals 2026 — Helpr`];
  const title = (deals ? dealTitles : titles).find((t) => t.length <= THEME_TITLE_MAX) ?? (deals ? `${theme} deals 2026 — Helpr` : `${theme} Christmas gifts 2026 — Helpr`);
  // Description: count, price range (its priciest gift by name when it fits) and the stores that sell the priced gifts.
  const head = deals ? `${f.count} ${theme} deal${f.count === 1 ? "" : "s"}` : `${f.count} ${theme} Christmas gift idea${f.count === 1 ? "" : "s"} for kids`;
  const low = f.min === null ? "" : f.min < 10 && !deals ? `$${f.min} stocking stuffers` : `$${f.min}`;
  const ranges = f.min === null || f.max === null || f.max === f.min ? [""] : [
    ...(f.topName ? [`, from ${low} to the $${f.max} ${f.topName}`] : []),
    `, from ${low} to $${f.max}`,
  ];
  const shops = f.stores.length ? [`, with prices from ${f.stores.length > 3 ? `${f.stores.slice(0, 3).join(", ")} and more` : joinWords(f.stores)}`, ""] : [""];
  // The stores outrank the priciest gift's name ("where to buy" is the question asked most).
  const tries = shops.flatMap((s) => ranges.map((r) => `${head}${r}${s}.`));
  const description = tries.find((t) => t.length <= THEME_DESCRIPTION_MAX) ?? `${head}.`;
  // Intro: what the gifts are and what every card carries.
  const kindsSaid = [...f.kinds.slice(0, 4), ...tail];
  const what = kindsSaid.length ? `: ${joinWords(kindsSaid)}` : "";
  const range = f.min !== null && f.max !== null && f.max > f.min ? `, from $${f.min} to $${f.max}` : "";
  const every = deals
    ? "Every deal shows its Black Friday price, and each one links straight to the store's page."
    : f.priced === f.count ? "Every gift shows its price, and each one links straight to the store that sells it." : "Each gift links straight to the store that sells it.";
  const intro = deals ? `${theme} deals${what}${range}. ${every}` : `${theme} Christmas gifts for kids${what}${range}. ${every}`;
  return { title, description, ogTitle: title.replace(/ — Helpr$/, ""), intro };
}
