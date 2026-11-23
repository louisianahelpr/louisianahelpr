/**
 * Questions shoppers ask, answered from each page's own data (owner pop-up 2026-11-22 9:40 PM: "Q&A + updated date +
 * byline", so AI assistants and search engines that read the page can quote it). One short Q&A per page near its end,
 * on Her, Him, Kids, the 25 Days sponsors page, the three deals days and the Holiday Hub, with an "Updated" day (the
 * day the page's data last changed, src/content/guideUpdated.json, scripts/guide-updated.mjs) and a one-line byline.
 *
 * Every answer names real rows from the page (picks with the price the card shows, deals still on, sponsors, lights
 * and events not over), so it can never say something the page does not. Plain words: no hype, no "y'all", no
 * affiliate wording, nothing addressed to an AI. Prices are the card's ("~$24", "from $41"), and only where the card
 * shows one today (pickPriceShown.mjs).
 *
 * Plain dependency-light ESM: api/share.ts (the pre-JS body and its FAQPage JSON-LD) and the page's lazy GuideQa
 * section both call it, so the raw HTML and the page say the same thing. Never imported by the guide route's first
 * chunk (the /gift-guides/:slug budget). Types: guideQa.d.mts. Guard: src/test/guideAiSearch1122.test.tsx.
 */

import { pickPriceShown, shownDollars } from "./pickPriceShown.mjs";
import { TWENTY_FIVE_DAYS } from "./seoBodies.mjs";
import { DEAL_EVENTS, RETITLE_AFTER, dealEnds, dealsIn, liveDeals } from "../content/giftGuideDeals.mjs";
import { filterEvents, filterLights } from "../content/holidayHub/holidayHub.mjs";

/** The pages that carry a Q&A (each one's key in guideUpdated.json). */
export const QA_PAGES = ["her", "him", "kids", "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday", "holidays"];

export const QA_TITLE = "Common questions";

/** Who picks, in "we" words (owner 2026-11-22 10:22 PM: "Don't say Lexi our founder, just say we"). */
export const QA_BYLINE = {
  gifts: "We picked every gift on this list.",
  other: "We put this list together.",
};

/** The catalog guides' person words. */
const WHO = { her: "her", him: "him", kids: "kids" };

/** How many rows an answer names at most. */
const NAMED = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ymd = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").map(Number) : null);

/** "Nov 22, 2026" for "2026-11-22", or "" for anything else. */
export function shortDate(day) {
  const p = ymd(day);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}` : "";
}

/** "Nov 22" (no year). */
const monthDay = (day) => {
  const p = ymd(day);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}` : "";
};

/** "Friday, November 27, 2026". */
const longDate = (day) => {
  const p = ymd(day);
  if (!p) return "";
  const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return `${WEEKDAYS[wd]}, ${LONG_MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}`;
};

/** "Updated Nov 22, 2026", or "" when the day is missing. */
export function updatedLine(day) {
  const d = shortDate(day);
  return d ? `Updated ${d}` : "";
}

/** "A, B and C". */
function list(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The price a card shows ("~$24" or "from $41"), or "" when it shows none today. */
function priceText(p, today) {
  if (!pickPriceShown(p.price, p.priceAt, today)) return "";
  const d = shownDollars(p.price);
  return p.priceFrom ? `from $${d}` : `~$${d}`;
}

const named = (p, today) => {
  const price = priceText(p, today);
  return price ? `${p.name} (${price})` : p.name;
};

/**
 * A catalog pick (src/content/giftGuideCatalog.ts CatalogPick) as the Q&A reads it: the page and the pre-JS data
 * (src/prerender/seoData.ts) both map through here, so both answer from the same rows.
 */
export function toQaPick(p) {
  const badges = Array.isArray(p.badges) ? p.badges : [];
  return {
    name: p.name,
    ...(typeof p.price === "number" ? { price: p.price } : {}),
    ...(p.priceAt ? { priceAt: p.priceAt } : {}),
    ...(p.priceFrom ? { priceFrom: true } : {}),
    ...(badges.includes("louisiana-made") || badges.includes("shop-louisiana") ? { la: true } : {}),
    ...(p.brand ? { brand: p.brand } : {}),
  };
}

/**
 * Her, Him, Kids and the 25 Days sponsors page. `picks`: every pick in the guide's order, each
 * { name, price?, priceAt?, priceFrom?, la?, brand? } (la: the Louisiana-made or Shop Louisiana badge).
 */
export function catalogGuideQa(slug, picks, today) {
  const rows = (Array.isArray(picks) ? picks : []).filter((p) => p && typeof p.name === "string" && p.name);
  const priced = rows.filter((p) => pickPriceShown(p.price, p.priceAt, today));
  const dollars = (p) => shownDollars(p.price);
  const qa = [];
  if (slug === "25-days-sponsors") {
    const brands = [...new Set(rows.map((p) => (p.brand ?? "").trim()).filter(Boolean))];
    if (brands.length === 0) return [];
    qa.push({
      q: `What is ${TWENTY_FIVE_DAYS.name}?`,
      a: `A holiday giveaway from Louisiana Helpr that runs from ${longDate(TWENTY_FIVE_DAYS.startDate).replace(/, \d{4}$/, "")} to ${longDate(TWENTY_FIVE_DAYS.endDate)}. The ${plural(brands.length, "business or brand", "businesses and brands")} on this page are its sponsors.`,
    });
    const more = brands.length - NAMED;
    qa.push({
      q: `Which businesses sponsor ${TWENTY_FIVE_DAYS.name}?`,
      a: `Sponsors include ${list(brands.slice(0, NAMED))}${more > 0 ? `, plus ${more} more on this page` : ""}.`,
    });
    const under = priced.filter((p) => !p.priceFrom && dollars(p) <= 25);
    if (under.length) qa.push({ q: "Are there sponsor gifts under $25?", a: `Yes. A few: ${list(under.slice(0, NAMED).map((p) => named(p, today)))}.` });
    qa.push({ q: "Where can I shop the sponsors?", a: "Each sponsor on this page links to its own shop or website." });
    return qa;
  }
  const who = WHO[slug];
  if (!who) return [];
  const band = (lo, hi) => priced.filter((p) => dollars(p) > lo && dollars(p) <= hi);
  const under25 = band(0, 25);
  if (under25.length) {
    qa.push({
      q: `What are good gifts for ${who} under $25?`,
      a: `This guide has ${plural(under25.length, "gift", "gifts")} under $25. ${under25.length > NAMED ? "A few: " : ""}${list(under25.slice(0, NAMED).map((p) => named(p, today)))}.`,
    });
  }
  const to50 = band(25, 50);
  if (to50.length) {
    qa.push({
      q: `What are good gifts for ${who} under $50?`,
      a: `Besides the under-$25 picks, this guide has ${plural(to50.length, "gift", "gifts")} from $26 to $50. ${to50.length > NAMED ? "A few: " : ""}${list(to50.slice(0, NAMED).map((p) => named(p, today)))}.`,
    });
  }
  const la = rows.filter((p) => p.la);
  if (la.length) {
    qa.push({
      q: `Are there Louisiana gifts for ${who} in this guide?`,
      a: `Yes. These come from Louisiana makers or Louisiana shops: ${list(la.slice(0, NAMED).map((p) => named(p, today)))}.`,
    });
  }
  if (priced.length) {
    // The oldest shown check day, as the list's own "Prices as of" note says (PickPrice.tsx PricesAsOf).
    const oldest = priced.map((p) => p.priceAt).sort()[0];
    qa.push({
      q: "How current are the prices?",
      a: `Prices are as of ${shortDate(oldest)}, rounded to the dollar. Prices change, so the store's page has today's price.`,
    });
  }
  return qa;
}

/** "Black Friday: up to 50% off" -> "up to 50% off" (the day's name is already the question's). */
const dealWords = (deal) => String(deal ?? "").replace(/^[^:]{0,40}\b(?:Friday|Monday|Cyber|Week)\b[^:]{0,20}:\s+/i, "").trim();

/**
 * A deals day (Black Friday, Cyber Monday). `deals`: the deals file's rows ({ event, brand, deal, ends?, code? }); only
 * the day's Top deals cards that still show on `today` are named (liveDeals with `listed.storeCodes`, the page's own
 * rule: through their end day, a code's end counting, or Dec 1 with none). `listed`: the day page's other two sections
 * on `today`, its Discount codes cards and store Sales (giftGuideDealCounts.ts dealDayParts; the pre-JS body reads them
 * from seo-data's dealParts), so "on this page" counts exactly what the page's three sections and the guides menu
 * count (guide train p 11-23: the Q&A said "19 deals right now" beside the menu's 61, which also counts the codes and
 * sales).
 */
export function dealsDayQa(slug, deals, today, listed) {
  const day = DEAL_EVENTS.find((e) => e.id === slug && e.kind === "deals");
  if (!day) return [];
  const live = dealsIn(liveDeals(Array.isArray(deals) ? deals : [], today, listed?.storeCodes ?? []), slug);
  const codes = Math.max(0, Number(listed?.codes) || 0);
  const sales = Math.max(0, Number(listed?.sales) || 0);
  const total = live.length + codes + sales;
  const qa = [{ q: `When is ${day.title} 2026?`, a: `${day.title} is ${longDate(day.day)}.` }];
  if (total === 0) {
    qa.push({ q: `What ${day.title} deals are on this page?`, a: `The ${day.title} deals on this page have ended.` });
    return qa;
  }
  const parts = [
    live.length ? plural(live.length, "top deal", "top deals") : "",
    codes ? plural(codes, "discount code", "discount codes") : "",
    sales ? plural(sales, "sale", "sales") : "",
  ].filter(Boolean);
  const lines = live.slice(0, NAMED).map((d) => (dealWords(d.deal) ? `${d.brand} (${dealWords(d.deal)})` : d.brand));
  const top = live.length === 0 ? "" : live.length === 1 ? ` The top deal is ${lines[0]}.` : ` The top deals ${live.length > NAMED ? "include" : "are"} ${list(lines)}.`;
  qa.push({
    q: `What ${day.title} deals are on this page?`,
    a: `${parts.length > 1 ? `${total} right now: ${list(parts)}.` : `${parts[0]} right now.`}${top}`,
  });
  if (live.length === 0) return qa;
  const ending = live
    .map((d) => ({ brand: d.brand, ends: dealEnds(d, listed?.storeCodes ?? []) }))
    .filter((d) => d.ends)
    .sort((a, b) => (a.ends < b.ends ? -1 : a.ends > b.ends ? 1 : 0));
  qa.push({
    q: `When do the ${day.title} top deals end?`,
    a: ending.length
      ? `It depends on the store. ${list(ending.slice(0, 3).map((d) => `${d.brand}'s ends ${monthDay(d.ends)}`))}. A deal with no end date stays listed through ${monthDay(RETITLE_AFTER)}.`
      : `None of these stores gave an end date, so each deal stays listed through ${monthDay(RETITLE_AFTER)}.`,
  });
  return qa;
}

/**
 * A deals day's Discount codes and Sales counts on `today` from seo-data's dealParts rows ([first day, codes, sales], one
 * per change; src/prerender/seoData.ts): the last row starting on or before `today`, or zeros before the first.
 */
export function dealPartsOn(rows, today) {
  let at = null;
  for (const r of Array.isArray(rows) ? rows : []) if (Array.isArray(r) && r[0] <= today) at = r;
  return at ? { codes: Number(at[1]) || 0, sales: Number(at[2]) || 0 } : { codes: 0, sales: 0 };
}

/** Small Business Saturday. `shops`: { name, town, category, ships } (giftGuideSmallBiz.json); `categories`: their order. */
export function smallBizQa(shops, categories) {
  const day = DEAL_EVENTS.find((e) => e.kind === "small-biz");
  const rows = (Array.isArray(shops) ? shops : []).filter((s) => s && s.name);
  const qa = [{ q: `When is ${day.title} 2026?`, a: `${day.title} is ${longDate(day.day)}.` }];
  if (rows.length === 0) return qa;
  const more = rows.length - NAMED;
  qa.push({
    q: "Which Louisiana small businesses are on this page?",
    // Guide train p 11-23: the guides menu's number also counts the approved Featured local businesses listed after the
    // sponsors (a live read the pre-JS body cannot make), so this names what its number counts: the sponsors.
    a: `The ${plural(rows.length, "Louisiana business", "Louisiana businesses")} that sponsor ${TWENTY_FIVE_DAYS.name}, including ${list(rows.slice(0, NAMED).map((s) => (s.town ? `${s.name} (${s.town})` : s.name)))}${more > 0 ? `, plus ${more} more` : ""}. Any Featured local businesses are listed after them.`,
  });
  const ships = rows.filter((s) => s.ships === "ships").length;
  qa.push({
    q: "Can I order from these shops online?",
    a: ships === rows.length ? "Yes, every sponsor ships." : ships === 0 ? "The sponsors sell locally, in their own towns." : `${ships} of the sponsors ship. The other ${rows.length - ships} sell locally, in their own towns.`,
  });
  const order = Array.isArray(categories) ? categories : [];
  const counts = order.map((c) => [c, rows.filter((s) => s.category === c).length]).filter(([, n]) => n > 0);
  if (counts.length) qa.push({ q: "What kinds of businesses are listed?", a: `By kind, the sponsors are ${list(counts.map(([c, n]) => `${c} (${n})`))}.` });
  return qa;
}

/** The Holiday Hub (/holidays): lights not over, and events with a confirmed date still ahead or on. */
export function holidayHubQa(lights, events, today) {
  const ls = filterLights(Array.isArray(lights) ? lights : [], {}, today);
  const place = (i) => (i.city ? `${i.name} (${i.city})` : i.name);
  const qa = [];
  if (ls.length) {
    qa.push({
      q: "Where can I see Christmas lights in Louisiana?",
      a: `This page lists ${plural(ls.length, "light display", "light displays")} across Louisiana, including ${list(ls.slice(0, NAMED).map(place))}.`,
    });
    const free = ls.filter((l) => l.cost === "free");
    if (free.length) qa.push({ q: "Are there free Christmas lights in Louisiana?", a: `Yes, ${free.length} of them are free, including ${list(free.slice(0, 3).map(place))}.` });
    const drive = ls.filter((l) => l.format === "drive-through" || l.format === "both");
    if (drive.length) qa.push({ q: "Where are drive-through Christmas lights in Louisiana?", a: `${list(drive.slice(0, NAMED).map(place))}.` });
  }
  const evs = filterEvents(Array.isArray(events) ? events : [], {}, today)
    .filter((e) => !e.tba && e.start && e.dates)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (evs.length) {
    qa.push({
      q: "What holiday events are coming up in Louisiana?",
      a: `On now or coming up: ${list(evs.slice(0, NAMED).map((e) => `${e.name}${e.city ? ` in ${e.city}` : ""} (${e.dates.replace(/, \d{4}\b/g, "")})`))}.`,
    });
  }
  return qa.slice(0, 5);
}

/** FAQPage JSON-LD for a page's Q&A (the same words the page shows), or null with none. */
export function faqPageLd(qa) {
  if (!Array.isArray(qa) || qa.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The pre-JS section (api/share.ts puts it at the end of the page's <main>), or "" with no Q&A. */
export function qaSectionHtml(qa, updated, byline) {
  if (!Array.isArray(qa) || qa.length === 0) return "";
  const items = qa.map(({ q, a }) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join("");
  const line = [updatedLine(updated), byline].filter(Boolean).map(esc).join(" · ");
  return `<section id="guide-qa" aria-labelledby="guide-qa-title" data-guide-qa=""><h2 id="guide-qa-title">${esc(QA_TITLE)}</h2><dl>${items}</dl>${line ? `<p>${line}</p>` : ""}</section>`;
}

/** A page body (seoBodies.mjs page()) with the section added at the end of its <main>. */
export function withQaSection(body, section) {
  if (!section) return body;
  const at = body.lastIndexOf("</main>");
  return at < 0 ? body + section : body.slice(0, at) + section + body.slice(at);
}
