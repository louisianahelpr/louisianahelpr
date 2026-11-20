/**
 * FOLLOW-UP TRAIN 1120 (owner 2026-11-19 ~11:45 PM to 11-20 ~2:45 AM, FOLLOWUP-OWNER-1119.md from "MORE GUIDE MERGES"):
 * the rows and rules scripts/gift-guide-picks.mjs applies on top of the big batch, read from ~/Desktop/Gift-guide-picks:
 *   - the three full audits (_audit-full-1120-p1/p2/p3.json) and the guide QA (_guide-qa-fixes-1120.json): each finding's
 *     fix becomes a cut (cut, remove, replace_link, a broken photo), a store-page cut (the same item and photo on a
 *     guide and a store page: the store-page copy goes), a move (move_to) or a rename (brand first, or the name the
 *     finding gives). Findings name the big batch's guides and sections; the import maps them onto the merged guides;
 *   - the 0% swaps (_zero-commission-swaps-1120.json): each 0% item leaves its guide and its earning add takes the place;
 *     every gift card is out (owner 11-20 ~12:20 AM: "REMOVE ALL 0% gift cards");
 *   - the earning Louisiana picks (_louisiana-earning-1120.json) and the Louisiana Goldbelly links (_goldbelly-1120.json,
 *     owner ~1:10 AM: "Goldbelly = Louisiana spots only"), placed on their guides BEFORE the 0% items leave, so no
 *     Louisiana section drops under 8 (audit p2);
 *   - no 0% pick anywhere except a 25 Days sponsor's (owner ~12:05 AM), and no gift card except a sponsor's.
 * Guard: src/test/giftGuideFollowUp1120.test.ts.
 */

/** A gift card (an e-gift card, a gift certificate counts only when it is no sponsor's: see followUpOut). */
export const GIFT_CARD = /\b(e-?gift\s*cards?|gift\s*cards?|gift\s*certificates?)\b/i;

/** A membership gift (Sam's Club, Walmart+, Prime, Audible, Kindle Unlimited, Game Pass): paid by bounty, kept by the owner. */
export const MEMBERSHIP = /\b(membership|walmart\+|kindle unlimited|game pass)\b/i;

/** The audit files, in order. */
export const AUDIT_FILES_1120 = ["_audit-full-1120-p1.json", "_audit-full-1120-p2.json", "_audit-full-1120-p3.json", "_guide-qa-fixes-1120.json"];

/** Every finding of the four files, normalized ({ guide, section, item, href, fix, problem, move_to }). */
export function readAudits1120(readJson) {
  const rows = [];
  for (const f of AUDIT_FILES_1120) {
    let v = null;
    try { v = readJson(f); } catch { continue; /* mid-write: read on the next run */ }
    const list = Array.isArray(v) ? v : Array.isArray(v?.findings) ? v.findings : [];
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      rows.push({ file: f, guide: String(r.guide ?? ""), section: String(r.section ?? ""), item: String(r.item ?? ""), href: String(r.href ?? ""),
        fix: String(r.fix ?? "").toLowerCase(), problem: String(r.problem ?? ""), move_to: typeof r.move_to === "string" ? r.move_to : "" });
    }
  }
  return rows;
}

/** A section name that names no section ("(guide)", "Top picks" is a real one). */
const noSection = (s) => !s || /^\((guide|section|single list|untitled)\)$/i.test(s) || s === "top-picks";

/** The store page a "same item/image also on: store-x" finding names (the copy that goes), else "". */
export const storeCopyOf = (problem) => /same item\/image also on: (store-[a-z0-9-]+)/i.exec(problem)?.[1] ?? "";

/**
 * A move's target: "guide", "guide: Section", "guide#Section", or a bare section title on the finding's own guide.
 * Returns { guide, section }.
 */
export const moveTarget = (from, moveTo) => {
  const t = String(moveTo ?? "").trim();
  if (!t) return null;
  const m = /^([a-z0-9-]+)\s*(?:#|:)\s*(.+)$/.exec(t);
  if (m) return { guide: m[1], section: m[2].trim() };
  if (/^[a-z0-9-]+$/.test(t)) return { guide: t, section: "" };
  return { guide: from, section: t };
};

/** The name a rename finding asks for: the one it spells out, else the brand put first; null when it names neither. */
export const renameOf = (row, currentName, brand) => {
  const named = /(?:should be|use|rename to)\s+"([^"]+)"/i.exec(row.problem)?.[1];
  if (named) return named;
  const b = /(?:start with|lead with|missing) brand:?\s*\(?"([^"]+)"/i.exec(row.problem)?.[1] ?? "";
  if (!b) return null;
  return brandFirst(currentName, b);
};

/** Stores and networks that are no maker: never put first on a name. */
const RETAILER = /^(amazon|walmart|target|shopmy|tractor supply|maisonette|nordstrom|macy'?s|dillard'?s|kohl'?s|best buy|sam'?s club|bass pro shops|ulta( beauty)?|sephora|anthropologie|free people|madewell|zappos|rei|wayfair|crate (&|and) barrel|tiktok shop|mavely|goldbelly|at home|old navy|jcpenney|tj maxx|marshalls|dick'?s sporting goods|bloomingdale'?s|saks|urban outfitters)$/i;
const fold = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/**
 * A name with its maker first (QA: 344 names did not lead with their brand): "Pecan Pralines 12 Count Tin" by Aunt Sally's
 * reads "Aunt Sally's Pecan Pralines 12 Count Tin". A name that already holds the brand anywhere, a store brand and a
 * name that would read the brand twice are left as they are.
 */
export const brandFirst = (name, brand) => {
  const n = String(name ?? "").trim();
  const b = String(brand ?? "").trim();
  if (!n || !b || RETAILER.test(b) || b.length > 40 || /affiliate|program/i.test(b)) return n;
  if (fold(n).startsWith(fold(b)) || fold(n).includes(fold(b))) return n;
  // "Yeti" by "YETI": the brand's own casing, once.
  return `${b} ${n}`;
};

/**
 * The audit findings as import actions. `oldSlug(guide, section)` maps a finding's guide and section (the big batch's
 * names) onto an old guide slug the merged guides know; `isStore(slug)` tells a store page.
 *   cuts: [{ slug, href, item }]   storeCuts: ["store|href"]   moves: [{ href, from, to }]   renames: Map(href -> finding)
 */
export function auditActions1120(rows, oldSlug) {
  const out = { cuts: [], storeCuts: new Set(), moves: [], renames: new Map(), counts: { cut: 0, storeCut: 0, move: 0, rename: 0, skipped: 0 } };
  for (const r of rows) {
    const copy = storeCopyOf(r.problem);
    // "Store pages also pull people-guide items by design (not dupes)" (audit p2 notes, FOLLOWUP-OWNER-1119.md): a guide
    // item that is also on its store page stays in both places (the store page keeps its 10-15).
    if (copy) { out.counts.skipped += 1; continue; }
    // Owner 11-20 ~12:50 AM ("It's ok there's 6 over 500"): the QA's over-$500 removals are not made (the one-griddle rule
    // keeps one Weber griddle in the import).
    if (/\$500/.test(r.problem) && ["remove", "cut"].includes(r.fix)) { out.counts.skipped += 1; continue; }
    // The sponsors featured on the Louisiana guides are expected there (audit p3): no cut.
    if (/sponsor/i.test(r.problem) && /expected|just add the sponsor badge/i.test(r.problem)) { out.counts.skipped += 1; continue; }
    const from = oldSlug(r.guide, noSection(r.section) ? "" : r.section);
    if (r.fix === "rename") {
      if (r.href) { out.renames.set(r.href, r); out.counts.rename += 1; } else out.counts.skipped += 1;
      continue;
    }
    if (!r.href || !from) { out.counts.skipped += 1; continue; }
    if (r.fix === "move") {
      const t = moveTarget(r.guide, r.move_to);
      const to = t ? oldSlug(t.guide, t.section) : null;
      if (!to) { out.counts.skipped += 1; continue; }
      out.moves.push({ href: r.href, from, to });
      out.counts.move += 1;
      continue;
    }
    // "Commission None" is an affiliate link whose rate is not on file, not a 0% link (the 0% swaps file's own rule), and
    // the memberships (Sam's Club, Walmart+, Prime, Audible) stay: the owner kept them (OWNER_KEEP) and they pay a bounty.
    if ((r.fix === "replace_link" && /commission (none|null)\b/i.test(r.problem)) || MEMBERSHIP.test(r.item)) { out.counts.skipped += 1; continue; }
    // A broken or foreign photo, a 0% link, a cut or a removal: the item leaves (the sort fills its place).
    if (["cut", "remove", "replace_link", "replace_image"].includes(r.fix)) {
      out.cuts.push({ slug: from, href: r.href, item: r.item });
      out.counts.cut += 1;
      continue;
    }
    out.counts.skipped += 1;
  }
  return out;
}

/** Photos found for rows that came without one (_image-fill-1120.json: link -> the product page's og:image, read 11-20). */
const imageFill = (readJson) => {
  try { return readJson("_image-fill-1120.json") ?? {}; } catch { return {}; /* mid-write: no fills this run */ }
};
const withImage = (row, fills) => (row.image ? row : fills[row.href] ? { ...row, image: fills[row.href] } : row);

/** The 0% swaps file: { cuts: [{ guide, section, href, item }], adds: [{ guide, section, row }] }. */
export function zeroSwaps1120(readJson) {
  const fills = imageFill(readJson);
  let v = null;
  try { v = readJson("_zero-commission-swaps-1120.json"); } catch { return { cuts: [], adds: [] }; /* mid-write */ }
  const cuts = [];
  const adds = [];
  for (const s of Array.isArray(v?.swaps) ? v.swaps : []) {
    if (!s || typeof s.remove_href !== "string") continue;
    cuts.push({ guide: String(s.guide ?? ""), section: String(s.section ?? ""), href: s.remove_href, item: String(s.remove_item ?? "") });
    // An add already on the site elsewhere ("already_on") is not placed twice: the item lives in one place.
    const a = s.add;
    if (a && typeof a.href === "string" && typeof a.name === "string" && !(Array.isArray(a.already_on) && a.already_on.length)) adds.push({ guide: String(s.guide ?? ""), section: String(s.section ?? ""), row: withImage(a, fills) });
  }
  for (const g of Array.isArray(v?.gift_cards_no_commission_equivalent) ? v.gift_cards_no_commission_equivalent : []) {
    if (g && typeof g.remove_href === "string") cuts.push({ guide: String(g.guide ?? ""), section: String(g.section ?? ""), href: g.remove_href, item: String(g.remove_item ?? "") });
  }
  return { cuts, adds };
}

/** Goldbelly's sections on Louisiana Food Gifts -> the old guide each one fills. */
const GOLDBELLY_SECTION = { "king cakes": "louisiana-sweets-and-bakeries", "sweets & pralines": "louisiana-sweets-and-bakeries", "savory & meals": "louisiana-kitchen" };

/** The earning Louisiana rows to place ({ guide, section, row }), Goldbelly by its section. */
export function louisianaAdds1120(readJson) {
  const out = [];
  const fills = imageFill(readJson);
  for (const f of ["_louisiana-earning-1120.json", "_goldbelly-1120.json"]) {
    let v = null;
    try { v = readJson(f); } catch { continue; /* mid-write */ }
    for (const r of Array.isArray(v) ? v : []) {
      if (!r || typeof r.href !== "string" || typeof r.name !== "string") continue;
      const g = f === "_goldbelly-1120.json" ? GOLDBELLY_SECTION[String(r.section ?? "").toLowerCase()] ?? "louisiana-sweets-and-bakeries" : String(r.guide ?? "");
      out.push({ guide: g, section: f === "_goldbelly-1120.json" ? "" : String(r.section ?? ""), row: withImage({ ...r, guide: g }, fills), file: f });
    }
  }
  return out;
}

/** The two sponsor sections on Shop Small Louisiana (owner 11-20 ~12:40 AM: every confirmed Louisiana sponsor featured). */
export const SPONSOR_SECTIONS_1120 = [
  { id: "sponsors-shops-and-makers", title: "25 Days Sponsors: Shops & Makers", categories: ["Food & Sweets", "Home & Decor", "Art & Gifts", "Fashion & Accessories"] },
  { id: "sponsors-experiences-and-services", title: "25 Days Sponsors: Kids, Experiences & Services", categories: ["Kids", "Beauty & Wellness", "Experiences & Tours", "Services"] },
];

/**
 * The Louisiana-located franchise sponsors (lead by recommendation 11-20, on the owner's "make sure our Louisiana sponsors
 * are in that group"): not on Shop Small (independent businesses only), but on Louisiana by Region in their region, with
 * the sponsor badge. City Sightseeing New Orleans: its site and photo read 11-20. HOTWORX (Baton Rouge, Denham Springs):
 * the sponsors guide's own link and photo. The Mary Kay consultant has no photo yet (no row without a photo).
 */
export const FRANCHISE_SPONSORS_1120 = [
  { name: "City Sightseeing New Orleans Hop-On Hop-Off Tour", brand: "City Sightseeing New Orleans", region: "new-orleans", href: "https://citysightseeingneworleans.com/",
    image: "https://citysightseeingneworleans.com/wp-content/uploads/2023/10/CS-NewOrleans-Social-Graphic-for-Website-1200X630.jpg", line: "Hop-on hop-off bus tours around New Orleans, a day out to give." },
  { name: "HOTWORX 1 Month Membership", brand: "HOTWORX", region: "baton-rouge", href: "https://www.hotworx.net/", fromSponsorsGuide: true,
    line: "Infrared sauna workouts at the Baton Rouge and Denham Springs studios." },
];

/**
 * Whether a pick leaves every guide (the follow-up's hard rules): a gift card, or a 0% link, unless it is a 25 Days
 * sponsor's (owner 11-20 ~12:40 AM: sponsors are featured at 0%) or one of the owner's named keeps.
 */
export const followUpOut = (p, { sponsor, kept }) => {
  if (sponsor(p) || kept(p) || MEMBERSHIP.test(String(p.name ?? ""))) return "";
  if (GIFT_CARD.test(String(p.name ?? ""))) return "gift card";
  if (p.commission === 0) return "0%";
  return "";
};
