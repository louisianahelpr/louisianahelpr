/**
 * HOLIDAY AUDIT B (2026-11-20): the last pass scripts/gift-guide-picks.mjs makes over the finished pages, from
 * scripts/gift-guide-holiday-b-1120.json, fixing ~/.lh-shots/holiday-audit-1120/B-findings.md (the non-people guides,
 * By Budget's Stocking Stuffers and Advent sections, Deals & codes and every store page):
 *   - the audit's cuts, moves, photo swaps, name and type fixes and adds (train 1120b's rule shapes, reused);
 *   - SHOPPER LINES ONLY (B #1, #2 High): a card's subtitle never carries a researcher's note (a commission rate, "got
 *     clicks", "verify", "image borrowed from another creator pin", "existing pick") or an Amazon star rating / review
 *     count (Amazon Associates: ratings only from the live API). A note-style line (a lowercase fragment) is blanked;
 *   - DROPPED SPONSORS (owner 11-20: R&R Wedding Co. dropped): every card, name-only mention and link leaves;
 *   - SPONSOR CARDS ARE GIFTS (B #14, #16 High): a sponsor card whose photo is the business's logo, flyer or headshot
 *     takes the product photo in `sponsorPhotos` (the shop's own site), else leaves its cards and is named on the page;
 *   - EVERY SPONSOR ON THE SPONSORS GUIDE (B #3, #13 High): each brand on the 25 Days lineup (src/content/sponsorPage.ts)
 *     has a card there (its own, or a copy of its spot on another guide) or is named there, in three sections;
 *   - DEALS (B #69): no blocked or off-rule retailer (Gilt, Rue La La, Groupon...) in any deals box, sale or code.
 * Each rule that finds nothing is reported (a stale rule never fails silently). Guard: src/test/giftGuideHolidayB1120.test.ts.
 */
import { applyTrain1120b, fold, isBrandPick } from "./giftGuideTrain1120b.mjs";
import { SECTION_MIN } from "../src/content/giftGuideMerges.mjs";
import { typeMax } from "./giftGuideSort.mjs";

/** A researcher's note, never shopper copy: a rate, a click count, a to-do, a photo source, an affiliate network. */
export const NOTE_WORDS = new RegExp([
  String.raw`\b(best|highest|top|better|good)\b[\w' -]{0,24}\brates?\b`, String.raw`\bhighest[- ]paying\b`, String.raw`\bcommissions?\b`,
  String.raw`\bgot (a |some )?clicks?\b`, String.raw`\bclicks?\b`, String.raw`\bverify\b`, String.raw`\beyeball\b`, String.raw`\bborrowed\b`,
  String.raw`\bexisting pick\b`, String.raw`\bcreator pin\b`, String.raw`\btodo\b`, String.raw`\btbd\b`, String.raw`\bplaceholder\b`,
  String.raw`\bgoldbelly\s*\d`, String.raw`\(\s*\d+(\.\d+)?\s*%\s*\)`, String.raw`\b\d+(\.\d+)?\s*%\s*(rate|commission|cut|payout)\b`,
  String.raw`\b(second|another) colorway\b`, String.raw`\bcolorway\/fit\b`, String.raw`\b(shopmy|mavely|awin|rakuten)\b`, String.raw`\baffiliate\b`,
].join("|"), "i");
/** An Amazon-style star rating or review count ("4.8 stars on 4,700+ ratings"). */
export const RATING_WORDS = /\b\d(\.\d)?\s*(out of 5\s*)?stars?\b|\b[\d,]+\+?\s*(ratings?|reviews?)\b|\bstar ratings?\b/i;

/**
 * A card's subtitle as a shopper reads it: each ";"-part that is a note goes, a rating clause goes, and a line left as a
 * lowercase fragment ("men's wallet gift", "got clicks") is blanked. Real copy keeps its words.
 */
export function shopperLine(line) {
  const raw = String(line ?? "").trim();
  if (!raw) return "";
  let s = raw.replace(/,?\s*\d(\.\d)?\s*(out of 5\s*)?stars?(\s+(on|from|with)\s+[\d,]+\+?\s*(ratings?|reviews?))?/gi, "");
  s = s.replace(/,?\s*[\d,]+\+?\s*(ratings?|reviews?)\b/gi, "").trim();
  const all = s.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  const parts = all.filter((x) => !NOTE_WORDS.test(x) && !RATING_WORDS.test(x));
  if (!parts.length || /^[a-z#]/.test(parts[0])) return "";
  // Nothing dropped: the copy stays exactly as written (its own semicolons included).
  if (parts.length === all.length) return s === raw ? raw : s.replace(/\s+([,.])/g, "$1");
  // A line that lost a part ends as a sentence ("Natchitoches institution; Goldbelly 12%" -> "Natchitoches institution.").
  const out = parts.join("; ").replace(/\s{2,}/g, " ").trim();
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/**
 * A raw retailer name, cleaned (B #12): a leading store domain ("splendid.com SPLENDID - "), a trailing store
 * ("... - Samsclub.com"), and a brand said twice ("Parachute Home Parachute Cloud Robe" -> "Parachute Cloud Robe").
 */
export function cleanName(name, brand) {
  let n = String(name ?? "").trim();
  // "materialkitchen.com MATERIAL - Serve Platter" -> "Material Serve Platter" (the brand kept, title case).
  n = n.replace(/^[a-z0-9-]+\.(com|net|co|us)\s+([A-Z0-9&'. ]+?)\s+-\s+/i, (_m, _tld, b) => `${b.toLowerCase().replace(/\b[a-z]/g, (x) => x.toUpperCase())} `);
  n = n.replace(/\s+-\s+[A-Za-z0-9-]+\.(com|net)$/i, "");
  const b = String(brand ?? "").trim();
  if (b && n.toLowerCase().startsWith(`${b.toLowerCase()} `)) {
    const rest = n.slice(b.length + 1);
    const [head, ...tail] = b.split(/\s+/);
    // Only a company suffix is dropped ("Parachute Home", "Muck Boot", "Quay Australia"), never a brand's own words
    // ("Rare Beauty Rare Beginnings", "Sol de Janeiro Sol Passport" keep their brand).
    if (tail.length && tail.every((w) => COMPANY_WORDS.has(w.toLowerCase())) && fold(rest.split(/\s+/)[0]) === fold(head)) n = rest;
    // "Pokemon Pokémon TCG": a one-word brand said twice.
    else if (!tail.length && fold(rest.split(/\s+/)[0]) === fold(head)) n = rest;
  }
  return n;
}
/** The words a company name adds to the brand itself ("Fable Pets", "Turtlebox Audio", "kate spade new york"). */
const COMPANY_WORDS = new Set(["home", "pets", "pet", "products", "audio", "frames", "cosmetics", "boot", "boots", "company", "co.", "co", "inc", "inc.", "australia", "kitchen", "us", "fragrance", "new", "york", "1913", "papers", "&", "prints", "meat", "pies", "creole", "pralines", "optics", "supply"]);

const LOGO_PATH = /\/gift-guides\/(small-biz|sponsors)\//;

/**
 * Whether a sponsor brand (as the lineup names it, or its `alias` fragments: "Manta Sleep" -> "Manta") is the brand of
 * pick `p`: its brand, the start of its name, or (a fragment of 6+ letters) anywhere in its name.
 */
const sponsorOf = (brand, alias = {}) => {
  const frags = (alias[brand] ?? [brand]).map(fold).filter(Boolean);
  return (p) => frags.some((f) => isBrandPick(p, f) || fold(p.brand).startsWith(f) || fold(p.name).startsWith(f) || (f.length >= 6 && fold(p.name).includes(f)));
};

/**
 * Applies the pass to `pageList` and `deals` in place (and to ctx.sales, ctx.dealCodes and ctx.nameOnly); returns
 * { counts, missing }. `ctx`: train 1120b's ctx plus { nameOnly: [{ guide, brand }], dealCodes: [], lineup: [brand],
 * blockedBrand(row) }.
 */
export function applyHolidayB1120(pageList, deals, spec, ctx) {
  const t = applyTrain1120b(pageList, deals, spec, ctx);
  const say = (s) => t.missing.push(s);
  const c = t.counts;
  const page = (slug) => pageList[slug] ?? [];
  const nameOnly = ctx.nameOnly ?? [];
  const addNameOnly = (guide, brand) => { if (!nameOnly.some((x) => x.guide === guide && fold(x.brand) === fold(brand))) nameOnly.push({ guide, brand }); };

  // Dropped sponsors: every card, mention and link.
  c.droppedOut = 0;
  for (const d of spec.droppedSponsors ?? []) {
    const hit = (p) => fold(p.brand).startsWith(fold(d.brand)) || fold(p.name).startsWith(fold(d.brand)) || (d.hosts ?? []).some((h) => String(p.href ?? "").includes(h));
    let n = 0;
    for (const slug of Object.keys(pageList)) {
      const before = page(slug).length;
      pageList[slug] = page(slug).filter((p) => !hit(p));
      n += before - pageList[slug].length;
    }
    for (let i = nameOnly.length - 1; i >= 0; i -= 1) if (fold(nameOnly[i].brand).startsWith(fold(d.brand))) { nameOnly.splice(i, 1); n += 1; }
    // Nothing left to drop is the goal (the sources drop it too: gift-guide-small-biz.mjs, gift-guide-sponsor-logos.mjs).
    c.droppedOut += n;
  }

  // Sponsor cards are gifts: a logo, flyer or headshot photo takes the shop's product photo, or the card leaves.
  c.sponsorPhotos = 0;
  c.logoCardsOut = 0;
  const photos = Object.entries(spec.sponsorPhotos ?? {});
  const logoNames = (spec.logoCards ?? []).map((x) => fold(x));
  const photoFor = (p) => photos.find(([k]) => fold(p.brand).startsWith(fold(k)) || fold(p.name).startsWith(fold(k)))?.[1];
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-")) continue;
    pageList[slug] = page(slug).flatMap((p) => {
      const isLogo = LOGO_PATH.test(String(p.image ?? "")) || logoNames.some((k) => fold(p.name).startsWith(k));
      if (!isLogo) return [p];
      const ph = photoFor(p);
      if (ph) {
        c.sponsorPhotos += 1;
        // The product's own page only on the card's own host (a checked sponsor site); else the card keeps its link.
        const { href, ...rest } = ph;
        return [{ ...p, ...rest, ...(href && hostOf(href) === hostOf(p.href) ? { href } : {}) }];
      }
      c.logoCardsOut += 1;
      addNameOnly(slug, p.brand || p.name);
      return [];
    });
  }

  // Every lineup sponsor on the sponsors guide: its card, a copy of its spot elsewhere, or its name.
  c.sponsorCards = 0;
  c.sponsorNamed = 0;
  const SG = ctx.sponsorsGuide;
  const groups = spec.sponsorGroups ?? {};
  const groupOf = (brand) => {
    for (const [title, g] of Object.entries(groups)) if ((g.brands ?? []).some((b) => fold(brand).startsWith(fold(b)) || fold(b).startsWith(fold(brand)))) return title;
    return spec.sponsorDefaultGroup;
  };
  const dropped = (brand) => (spec.droppedSponsors ?? []).some((d) => fold(brand).startsWith(fold(d.brand)));
  const cards = [];
  const sgList = page(SG);
  for (const brand of ctx.lineup ?? []) {
    if (dropped(brand)) continue;
    const mine = sgList.filter(sponsorOf(brand, spec.lineupAlias));
    let pick = mine[0];
    // A sponsor in `sponsorNameOnly` is named here, never carded twice (Hilma's probiotic keeps its one guide spot).
    const nameOnly = (spec.sponsorNameOnly ?? []).some((d) => fold(brand).startsWith(fold(d.brand)));
    if (!pick && !nameOnly) {
      const copy = Object.entries(pageList).filter(([s]) => s !== SG && !s.startsWith("store-")).flatMap(([, l]) => l)
        .find((p) => p.sponsor && p.image && !LOGO_PATH.test(p.image) && sponsorOf(brand, spec.lineupAlias)(p));
      if (copy) { const { section: _s, sectionId: _i, from: _f, ...rest } = copy; pick = rest; }
    }
    if (!pick) { addNameOnly(SG, brand); c.sponsorNamed += 1; continue; }
    const title = groupOf(brand);
    cards.push(...(mine.length ? mine : [pick]).map((p) => ({ ...p, sponsor: true, section: title, sectionId: groups[title]?.id ?? "sponsors" })));
  }
  // The sponsors guide's own cards that name no lineup brand (an event's host: The Strand's shows) keep their place.
  const left = sgList.filter((p) => !cards.some((x) => x.href === p.href && x.name === p.name)).map((p) => {
    const title = groupOf(p.brand || p.name);
    return { ...p, section: title, sectionId: groups[title]?.id ?? "sponsors" };
  });
  const order = Object.keys(groups);
  const all = [...cards, ...left].filter((p, i, a) => a.findIndex((x) => x.href === p.href && x.name === p.name) === i);
  pageList[SG] = order.flatMap((title) => all.filter((p) => p.section === title));
  c.sponsorCards = pageList[SG].length;
  for (const r of spec.sponsorLines ?? []) {
    const i = pageList[SG].findIndex((p) => (r.brand ? fold(p.brand).startsWith(fold(r.brand)) : fold(p.name).includes(fold(r.match))));
    if (i < 0) { say(`sponsor line: ${r.match}`); continue; }
    pageList[SG][i] = { ...pageList[SG][i], ...(r.name ? { name: r.name } : {}), line: r.line };
  }
  // A name-only sponsor that now has a card on that page is not named twice.
  for (let i = nameOnly.length - 1; i >= 0; i -= 1) {
    const x = nameOnly[i];
    if (page(x.guide).some(sponsorOf(x.brand, spec.lineupAlias))) nameOnly.splice(i, 1);
  }
  // A business with several lineup rows (HOTWORX's two studios) is named once, by its `sponsorOneName` name.
  for (const x of nameOnly) {
    const one = (spec.sponsorOneName ?? []).find((d) => fold(x.brand).startsWith(fold(d.brand)));
    if (one) x.brand = one.brand;
  }
  // One name per business: "HOTWORX" covers "HOTWORX Baton Rouge"; "Grand Kyiv Ballet" covers its show's long name.
  for (let i = nameOnly.length - 1; i >= 0; i -= 1) {
    const x = nameOnly[i];
    if (nameOnly.some((y, j) => j !== i && y.guide === x.guide && fold(x.brand).startsWith(fold(y.brand)) && (fold(y.brand) !== fold(x.brand) || j < i))) nameOnly.splice(i, 1);
  }

  // Deals: no blocked or off-rule retailer in any deals box, sale or code.
  c.dealsOut = 0;
  const blocked = (store, title, href) => (spec.dealsBlocked ?? []).some((b) => fold(store).startsWith(fold(b)) || fold(title).includes(fold(b)) || String(href ?? "").toLowerCase().includes(`${fold(b)}.com`))
    || Boolean(ctx.blockedBrand?.({ brand: store, name: title }));
  for (const slug of Object.keys(deals)) {
    if (!Array.isArray(deals[slug])) continue;
    const before = deals[slug].length;
    deals[slug] = deals[slug].filter((d) => !blocked("", d.title, d.href));
    c.dealsOut += before - deals[slug].length;
  }
  for (const arr of [ctx.sales, ctx.dealCodes]) {
    if (!Array.isArray(arr)) continue;
    for (let i = arr.length - 1; i >= 0; i -= 1) if (blocked(arr[i].store, arr[i].offer ?? "", arr[i].href)) { arr.splice(i, 1); c.dealsOut += 1; }
  }

  // Thin sections merge into one (owner 11-20: thin sections are merged, never padded): B #19's one-kids-place section.
  c.sectionsMerged = 0;
  for (const m of spec.sectionMerges ?? []) {
    const from = new Set((m.sections ?? []).map(fold));
    const n = page(m.guide).filter((p) => from.has(fold(p.section))).length;
    pageList[m.guide] = page(m.guide).map((p) => (from.has(fold(p.section)) ? { ...p, section: m.title, sectionId: m.id } : p));
    if (!n) say(`section merge: ${m.guide} ${m.title}`);
    // The merged section reads as one run, where its first part sat.
    const list = page(m.guide);
    const at = list.findIndex((p) => p.sectionId === m.id);
    if (at >= 0) pageList[m.guide] = [...list.slice(0, at).filter((p) => p.sectionId !== m.id), ...list.filter((p) => p.sectionId === m.id), ...list.slice(at).filter((p) => p.sectionId !== m.id)];
    c.sectionsMerged += n;
  }

  // A section the cuts left under SECTION_MIN joins its smaller neighbour (owner 11-20: thin sections are merged, never
  // padded), under both names and the neighbour's id; a guide left with one section is a plain list. The joined section
  // lists by commission like any other, and an old slug's anchor follows its section.
  c.thinFolded = 0;
  for (const m of ctx.merges ?? []) {
    const inOrder = (list) => list.map((p, i) => [p, i]).sort(([a, i], [b, j]) => (ctx.sortFixed?.has(b.from ?? "") ? 1 : 0) - (ctx.sortFixed?.has(a.from ?? "") ? 1 : 0)
      || (typeof b.commission === "number" ? b.commission : -1) - (typeof a.commission === "number" ? a.commission : -1) || i - j).map(([p]) => p);
    for (let guard = 0; guard < 20; guard += 1) {
      const list = page(m.parent);
      const ids = [...new Set(list.map((p) => p.sectionId).filter(Boolean))];
      if (ids.length < 2) break;
      const size = (id) => list.filter((p) => p.sectionId === id).length;
      const i = ids.findIndex((id) => size(id) < SECTION_MIN);
      if (i === -1) break;
      const near = [ids[i + 1], ids[i - 1]].filter(Boolean).sort((a, b) => size(a) - size(b));
      const [thin, keep] = [ids[i], near[0]];
      const [first, second] = ids.indexOf(keep) < i ? [keep, thin] : [thin, keep];
      const titleOf = (id) => list.find((p) => p.sectionId === id)?.section ?? "";
      const parts = [titleOf(first), titleOf(second)].flatMap((x) => x.split(/, | & /)).filter((x) => x && x !== "Top picks");
      const title = parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
      const id = keep === "top-picks" ? thin : keep;
      const joined = inOrder(list.filter((p) => p.sectionId === thin || p.sectionId === keep)).map((p) => ({ ...p, section: title, sectionId: id }));
      const at = list.findIndex((p) => p.sectionId === first);
      const rest = (x) => x.filter((p) => p.sectionId !== thin && p.sectionId !== keep);
      pageList[m.parent] = [...rest(list.slice(0, at)), ...joined, ...rest(list.slice(at))];
      for (const sl of m.sections) if (ctx.anchors && (ctx.anchors[sl] === thin || ctx.anchors[sl] === keep)) ctx.anchors[sl] = id;
      c.thinFolded += 1;
    }
    const left = new Set(page(m.parent).map((p) => p.sectionId).filter(Boolean));
    if (left.size === 1 && !(ctx.keepSections ?? []).includes(m.parent)) {
      pageList[m.parent] = page(m.parent).map(({ section: _s, sectionId: _i, ...p }) => p);
      for (const sl of m.sections) if (ctx.anchors) delete ctx.anchors[sl];
    }
  }

  // Variety holds after the audit's adds, moves and joins: a list a shopper reads as one (a section, or a plain guide)
  // keeps at most its cap of one gift type (the cap of the old guides in it). The owner's picks and sponsors' spots
  // never leave; ours give way, lowest rate first.
  c.typeTrimmed = 0;
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === ctx.sponsorsGuide) continue;
    const list = page(slug);
    const key = (p) => (p.sectionId && p.sectionId !== "top-picks" ? p.sectionId : slug);
    const out = new Set();
    for (const k of new Set(list.map(key))) {
      const run = list.filter((p) => key(p) === k && !ctx.sortFixed?.has(p.from ?? ""));
      if (ctx.sortFixed?.has(k)) continue;
      for (const type of new Set(run.map((p) => p.type ?? "other"))) {
        const same = run.filter((p) => (p.type ?? "other") === type);
        const cap = Math.max(typeMax(k, type), ...same.map((p) => typeMax(p.from ?? k, type)));
        const held = same.filter((p) => p.ownerPick || p.sponsor);
        let room = Math.max(0, cap - held.length);
        for (const p of same) {
          if (p.ownerPick || p.sponsor) continue;
          if (room > 0) room -= 1;
          else out.add(p);
        }
      }
    }
    if (out.size) { pageList[slug] = list.filter((p) => !out.has(p)); c.typeTrimmed += out.size; }
  }

  // Names and lines a shopper reads.
  c.lines = 0;
  c.names = 0;
  for (const slug of Object.keys(pageList)) {
    pageList[slug] = page(slug).map((p) => {
      const line = shopperLine(p.line);
      const name = cleanName(p.name, p.brand);
      if (line !== String(p.line ?? "")) c.lines += 1;
      if (name !== p.name) c.names += 1;
      // A `set` of null clears a flag (B #62: the YETI dog bowl's louisianaFit).
      const { louisianaFit, ...rest } = p;
      const flag = louisianaFit === null ? {} : louisianaFit === undefined ? {} : { louisianaFit };
      return line === String(p.line ?? "") && name === p.name && louisianaFit !== null ? p : { ...rest, ...flag, name, line };
    });
  }
  return t;
}

function hostOf(u) {
  try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return ""; /* not a URL: no host */ }
}
