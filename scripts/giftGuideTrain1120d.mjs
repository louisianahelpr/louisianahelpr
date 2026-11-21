/**
 * TRAIN 1120d (holiday design audit A, 2026-11-20; ~/.lh-shots/holiday-audit-1120/A-findings.md): the last pass
 * scripts/gift-guide-picks.mjs makes over the finished pages, after the budget caps. From
 * scripts/gift-guide-train-1120d.json it:
 *   1. re-types picks whose gift type contradicts their name (typeFix: a dress filed as "pants", a card game as
 *      "throw-blanket", Play-Doh as "skincare"), so the type caps see them; the explicit `retype` rules after;
 *   2. moves, edits (`sets`), cuts and adds picks (an add without a rate or store takes its brand's from the pages);
 *   3. Splurge holds only splurges: its under-$100 section leaves (a checked price under the budget guide's cap moves
 *      there, the rest leave);
 *   4. PAGE caps (owner 11-19 "max 2 of the same TYPE", which the import enforced only per section, while a shopper
 *      reads the whole page): on each `pageCaps.guides` page at most `max` picks of one gift type (per-guide and
 *      per-type overrides, exempt types), and at most `brandTypeMax` of one brand's same gift type (three identical
 *      needlepoint belts). Sponsors stay, the owner's picks claim their places first (as the import does), then by commission;
 *   5. THIN SECTIONS (owner 11-19 "fold small sections into a sibling", lead 11-20: under 10 picks): a section under
 *      `sectionMin` folds into its adjacent sibling (the smaller neighbour, so the 25 cap cuts least; `folds` name a
 *      sibling where adjacency reads wrong), titles joined; a guide left with one section reads as a plain list. Every
 *      old section id and old guide slug that pointed at a folded section points at the new one (SECTION_ANCHORS and
 *      the returned `aliases`, which the page reads for an old #section link);
 *   6. a section never holds more than `sectionCap` picks.
 * Every rule that finds nothing is reported. Guard: src/test/giftGuideTrain1120d.test.ts.
 */
import { fold, matches, placeInSection } from "./giftGuideTrain1120b.mjs";
import { typeMax } from "./giftGuideSort.mjs";

/**
 * Name -> gift type, for a pick whose type contradicts its name. Each rule: [name pattern, the right type, types that
 * are already fine for a name like that]. First matching rule wins. Read by the guard over every shown pick.
 */
export const TYPE_FIXES = [
  [/\bplay-?doh\b/i, "toy", ["toy", "art-supplies"]],
  [/\b(baby carrier|bouncer)\b/i, "baby-gear", ["baby-gear"]],
  [/\b(romper|smocked bubble|diaper cover|zipper footie|footie)\b/i, "baby-clothes", ["baby-clothes", "pajamas", "baby"]],
  [/\b(pajamas?|pj set|pjs)\b/i, "pajamas", ["pajamas", "robe", "baby-clothes"]],
  [/\b(dress|dress set)\b/i, "dress", ["dress", "costume"]],
  [/\b(card game|board game|party game|core game|throw throw burrito|shut the box|poker set|memo game|dominoes)\b/i, "game", ["game", "board-game"]],
  [/\b(shampoo|conditioner)\b/i, "hair-care", ["hair-care", "gift-set"]],
  [/\bstand mixer\b/i, "kitchen-appliance", ["kitchen-appliance", "appliance"]],
  [/\b(dutch oven|cocotte|cast iron skillet|baking pan|cookware set)\b/i, "cookware", ["cookware"]],
  [/\bmagna-?tiles\b/i, "building-toy", ["building-toy"]],
  [/\bmaileg\b/i, "toy", ["toy", "plush", "doll"]],
  [/\bcash register\b/i, "toy", ["toy", "doll"]],
  [/\bornament\b/i, "ornament", ["ornament", "decor"]],
  [/\b(sleep mask|silk eye mask)\b/i, "sleep-mask", ["sleep-mask"]],
  [/\b(pot rouge|lip gloss|lipstick|bronzing powder|bronzer|liquid blush)\b/i, "makeup", ["makeup", "lip", "gift-set", "skincare"]],
  [/\b(le pliage\b.*\bbag|tote|crossbody|wristlet|vanity case|toiletry bag)\b/i, "bag", ["bag", "luggage", "wallet"]],
  [/\b(tank top|racerback tank|align tank|ribbed tank|slim strap cami)\b/i, "shirt", ["shirt"]],
  [/\b(clogs?|sneakers?|slingback flat|point iii flat|ballet flats?|mary jane flats)\b/i, "shoes", ["shoes", "slippers", "boots"]],
  [/\b(passport case|key fob|key ?chain|key ring)\b/i, "accessory", ["accessory", "wallet", "jewelry"]],
  [/\b(chino|jogger|lounge pant)\b/i, "pants", ["pants"]],
];
/** Spelling twins the caps read as one type. */
const TYPE_ALIAS = { haircare: "hair-care", "fragrance mist": "fragrance" };
/** The right gift type for a pick, or null when its type already fits its name. */
export function typeFix(p) {
  if (p.type == null) return null;
  const t = TYPE_ALIAS[p.type] ?? p.type;
  for (const [re, type, ok] of TYPE_FIXES) if (re.test(p.name)) return ok.includes(t) || t === type ? (t !== p.type ? t : null) : type;
  return t !== p.type ? t : null;
}

const rateOf = (p) => (typeof p.commission === "number" ? p.commission : -1);
const isStore = (slug) => slug.startsWith("store-");
/** Gift types a brand may repeat on a page (each card a different card or plan). */
export const BRAND_TYPE_FREE = new Set(["gift-card", "subscription"]);

/** The most common value of `key` among the pages' picks of this brand (an add's rate and store). */
function brandTwin(pageList, brand, key) {
  const n = new Map();
  for (const l of Object.values(pageList)) for (const p of l) if (fold(p.brand) === fold(brand) && p[key] != null && p[key] !== "") n.set(p[key], (n.get(p[key]) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Section runs of a page, in order: [{ id, title, picks }]. */
const runsOf = (list) => {
  const out = [];
  for (const p of list) {
    const id = p.sectionId ?? "";
    const last = out[out.length - 1];
    if (last && last.id === id) last.picks.push(p);
    else out.push({ id, title: p.section ?? "", picks: [p] });
  }
  return out;
};
const joinTitles = (parts0) => {
  const parts = parts0.filter((t, k, all) => (t !== "Top picks" || all.length === 1) && all.indexOf(t) === k).flatMap((t) => t.split(/, | & /));
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
};

/**
 * Keeps at most `cap` of `list` by the cap rank (sponsors, this train's own adds and moves (`keep`, hand-picked for a
 * gap such as a budget), the owner's picks, then rate, then place, as the import's fill); returns the cut.
 */
function overCap(list0, cap, keep = new Set()) {
  // A 25 Days sponsor holds its one spot and takes none of the cap's places.
  const list = list0.filter((p) => !p.sponsor);
  if (list.length <= cap) return [];
  // Creator Connections campaign adds (train 1120c, `campaignEnds`) hold their one spot too.
  const kept = (p) => Number(keep.has(p.href) || Boolean(p.campaignEnds));
  const ranked = list.map((p, i) => ({ p, i })).sort((a, b) => Number(Boolean(b.p.sponsor)) - Number(Boolean(a.p.sponsor)) || kept(b.p) - kept(a.p) || Number(Boolean(b.p.ownerPick)) - Number(Boolean(a.p.ownerPick)) || rateOf(b.p) - rateOf(a.p) || a.i - b.i);
  return ranked.slice(cap).filter((x) => !x.p.sponsor).map((x) => x.p);
}

/**
 * Applies the train to `pageList` in place. `ctx`: { sponsorsGuide, anchors (SECTION_ANCHORS, updated in place),
 * fixedOrder: slugs whose lists keep their own order (no type cap) }. Returns { counts, missing, aliases } where
 * aliases is { guide: { oldSectionId: newSectionId } }.
 */
export function applyTrain1120d(pageList, spec, ctx) {
  const counts = { retyped: 0, moved: 0, set: 0, cut: 0, added: 0, splurgeMoved: 0, splurgeOut: 0, pageTypeOut: 0, brandTypeOut: 0, folded: 0, sectionCapOut: 0 };
  const missing = [];
  const say = (kind, r) => missing.push(`${kind}: ${r.guide ?? ""} ${r.match ?? r.row?.name ?? ""}`);
  const page = (slug) => pageList[slug] ?? [];
  const guides = () => Object.keys(pageList).filter((s) => !isStore(s) && s !== ctx.sponsorsGuide);
  const fixed = new Set(ctx.fixedOrder ?? []);
  const keep = new Set();
  // A move or add with no section joins the page's first section (never the end of the last: a pick placed by rate
  // among every row would split the sections).
  const firstSection = (slug) => page(slug).find((p) => p.section)?.section;

  // 1. Types.
  for (const slug of Object.keys(pageList)) {
    pageList[slug] = pageList[slug].map((p) => {
      const t = typeFix(p);
      if (!t) return p;
      counts.retyped += 1;
      return { ...p, type: t };
    });
  }
  for (const r of spec.retype ?? []) {
    let n = 0;
    for (const slug of Object.keys(pageList)) pageList[slug] = pageList[slug].map((p) => (matches(p, r) ? (n += 1, { ...p, type: r.type }) : p));
    if (!n) say("retype", r);
    counts.retyped += n;
  }

  // 2. Moves, edits, cuts, adds.
  for (const r of spec.moves ?? []) {
    const from = page(r.guide);
    const i = from.findIndex((p) => matches(p, r));
    if (i < 0) { if (!r.optional) say("move", r); continue; }
    const p = { ...from[i], ...(r.set ?? {}) };
    pageList[r.guide] = from.filter((_, j) => j !== i);
    pageList[r.to] = placeInSection(page(r.to), p, r.section ?? firstSection(r.to));
    keep.add(p.href);
    counts.moved += 1;
  }
  for (const r of spec.sets ?? []) {
    const list = page(r.guide);
    const i = list.findIndex((p) => matches(p, r));
    if (i < 0) { if (!r.optional) say("set", r); continue; }
    list[i] = { ...list[i], ...r.set };
    counts.set += 1;
  }
  for (const r of spec.cuts ?? []) {
    let n = 0;
    for (const slug of r.guide === "*" ? guides() : [r.guide]) {
      const before = page(slug).length;
      const hit = page(slug).filter((p) => matches(p, r) && (!r.section || p.sectionId === r.section));
      const out = new Set(r.all || r.guide === "*" ? hit : hit.slice(0, 1));
      pageList[slug] = page(slug).filter((p) => !out.has(p));
      n += before - pageList[slug].length;
    }
    if (!n && !r.optional) say("cut", r);
    counts.cut += n;
  }
  for (const r of spec.adds ?? []) {
    // One product, one guide (owner 11-19): the same link, or the same name on another link.
    if (guides().some((s) => page(s).some((p) => p.href === r.row.href || fold(p.name) === fold(r.row.name)))) { say("add (already on a guide)", r); continue; }
    if (!page(r.guide).length) { say("add (no guide)", r); continue; }
    const row = { ...r.row };
    if (row.commission == null) row.commission = brandTwin(pageList, row.brand, "commission") ?? null;
    if (!row.store) { const s = brandTwin(pageList, row.brand, "store"); if (s) row.store = s; }
    pageList[r.guide] = placeInSection(page(r.guide), row, r.section ?? firstSection(r.guide));
    keep.add(row.href);
    counts.added += 1;
  }

  // 3. Splurge holds only splurges.
  const aliases = {};
  const sp = spec.splurge;
  if (sp && page(sp.guide).length) {
    const drop = page(sp.guide).filter((p) => p.sectionId === sp.dropSection);
    if (!drop.length) say("splurge", { guide: sp.guide, match: sp.dropSection });
    pageList[sp.guide] = page(sp.guide).filter((p) => p.sectionId !== sp.dropSection);
    // Old links to the dropped section (/gift-guides/under-100) open the guide's top.
    for (const k of Object.keys(ctx.anchors ?? {})) if (ctx.parentOf?.(k) === sp.guide && ctx.anchors[k] === sp.dropSection) delete ctx.anchors[k];
    aliases[sp.guide] = { [sp.dropSection]: "" };
    for (const p of drop) {
      const to = sp.moveTo;
      const room = page(to.guide).filter((x) => x.sectionId === to.section).length < (spec.sectionCap ?? 25);
      const onAGuide = guides().some((s) => s !== sp.guide && page(s).some((x) => x.href === p.href));
      if (typeof p.price === "number" && p.price <= to.max && room && !onAGuide) {
        const title = page(to.guide).find((x) => x.sectionId === to.section)?.section;
        pageList[to.guide] = placeInSection(page(to.guide), { ...p, from: to.section }, title);
        counts.splurgeMoved += 1;
      } else counts.splurgeOut += 1;
    }
  }

  // 4. Page caps.
  const pc = spec.pageCaps;
  for (const slug of pc ? Object.keys(pc.guides) : []) {
    if (!page(slug).length) { say("pageCaps", { guide: slug }); continue; }
    const g = pc.guides[slug];
    const exempt = new Set([...(pc.exemptTypes ?? []), ...(g.exemptTypes ?? [])]);
    const out = new Set();
    const byType = new Map();
    for (const p of page(slug)) { if (fixed.has(p.from)) continue; const t = p.type ?? "other"; byType.set(t, [...(byType.get(t) ?? []), p]); }
    for (const [t, list] of byType) {
      if (exempt.has(t)) continue;
      const max = pc.typeMax?.[t] ?? g.max ?? pc.max;
      for (const p of overCap(list, max, keep)) out.add(p);
    }
    counts.pageTypeOut += out.size;
    const brandMax = g.brandTypeMax ?? pc.brandTypeMax;
    const byBrandType = new Map();
    for (const p of page(slug)) {
      if (out.has(p) || fixed.has(p.from) || !p.brand || BRAND_TYPE_FREE.has(p.type ?? "")) continue;
      const k = `${fold(p.brand)}|${p.type ?? "other"}`;
      byBrandType.set(k, [...(byBrandType.get(k) ?? []), p]);
    }
    for (const list of byBrandType.values()) for (const p of overCap(list, brandMax, keep)) { out.add(p); counts.brandTypeOut += 1; }
    pageList[slug] = page(slug).filter((p) => !out.has(p));
  }

  // A section's picks past its per-section type caps (scripts/giftGuideSort.mjs typeMax, the old guides' own caps; the
  // owner's picks hold their places and ours give way to them).
  const sectionTypeOut = (r) => {
    const byType = new Map();
    for (const p of r.picks) if (!fixed.has(p.from)) byType.set(p.type ?? "other", [...(byType.get(p.type ?? "other") ?? []), p]);
    const out = new Set();
    for (const [ty, list] of byType) {
      const tmax = Math.max(typeMax(r.id, ty), ...list.map((p) => typeMax(p.from ?? r.id, ty)));
      const mine = list.filter((p) => p.ownerPick).length;
      for (const p of overCap(list.filter((x) => !x.ownerPick), Math.max(0, tmax - mine), keep)) out.add(p);
    }
    return out;
  };

  // 5. Thin sections fold into a sibling.
  const min = spec.sectionMin ?? 10;
  const cap = spec.sectionCap ?? 25;
  for (const slug of guides()) {
    let runs = runsOf(page(slug));
    if (runs.length < 2 || runs.some((r) => !r.id)) continue;
    const named = (spec.folds ?? []).filter((f) => f.guide === slug);
    const map = {};
    const join = (i, j) => {
      const [a, b] = i < j ? [runs[i], runs[j]] : [runs[j], runs[i]];
      const keep = runs[j];
      const id = keep.id === "top-picks" ? runs[i].id : keep.id;
      const merged = { id, title: joinTitles([a.title, b.title]), picks: [...a.picks, ...b.picks], parts: [a.id, b.id] };
      for (const old of [a.id, b.id]) if (old !== id) map[old] = id;
      runs.splice(Math.max(i, j), 1);
      runs.splice(Math.min(i, j), 1, merged);
      counts.folded += 1;
    };
    for (const f of named) {
      const i = runs.findIndex((r) => r.id === f.section);
      const j = runs.findIndex((r) => r.id === f.into);
      if (i < 0 || j < 0) { if (!f.optional) say("fold", { guide: slug, match: `${f.section} -> ${f.into}` }); continue; }
      if (runs[i].picks.length >= min && !f.always) continue;
      // Non-adjacent: the section moves next to its sibling first.
      const moving = runs.splice(i, 1)[0];
      const at = runs.findIndex((r) => r.id === f.into);
      runs.splice(at + 1, 0, moving);
      join(at + 1, at);
    }
    for (let guard = 0; guard < 50 && runs.length > 1; guard++) {
      const i = runs.findIndex((r) => r.picks.length < min);
      if (i < 0) break;
      const prev = runs[i - 1];
      const next = runs[i + 1];
      join(i, !next ? i - 1 : !prev ? i + 1 : prev.picks.length < next.picks.length ? i - 1 : i + 1);
    }
    for (const f of named) {
      const r = runs.find((x) => x.id === (map[f.section] ?? f.section));
      if (r && f.title) r.title = f.title;
    }
    // A joined section: best-paying first, the page's caps again, at most `cap`.
    runs = runs.map((r) => {
      if (!r.parts) return r;
      const sorted = r.picks.map((p, k) => ({ p, k })).sort((x, y) => Number(fixed.has(y.p.from)) - Number(fixed.has(x.p.from)) || rateOf(y.p) - rateOf(x.p) || x.k - y.k).map((x) => x.p);
      return { ...r, picks: sorted };
    });
    for (const r of runs) {
      // A joined section keeps the import's per-section type caps (scripts/giftGuideSort.mjs typeMax, the old guides'
      // own caps; the owner's picks hold their places and ours give way to them).
      if (r.parts) {
        const out = sectionTypeOut(r);
        counts.sectionCapOut += out.size;
        r.picks = r.picks.filter((p) => !out.has(p));
      }
      const out = new Set(overCap(r.picks, cap - r.picks.filter((p) => p.sponsor).length, keep));
      counts.sectionCapOut += out.size;
      r.picks = r.picks.filter((p) => !out.has(p));
    }
    if (!Object.keys(map).length) continue;
    const final = (id) => { let x = id; for (let k = 0; k < 20 && map[x]; k++) x = map[x]; return x; };
    // The old guide slugs that open a section of this guide (SECTION_ANCHORS is keyed by old slug, its ids are per guide).
    const mine = Object.keys(ctx.anchors ?? {}).filter((k) => ctx.parentOf?.(k) === slug);
    if (runs.length === 1) {
      // One list left: no heading; every old link opens the guide's top.
      pageList[slug] = runs[0].picks.map(({ section: _s, sectionId: _i, ...p }) => p);
      for (const k of mine) delete ctx.anchors[k];
      aliases[slug] = Object.fromEntries([...Object.keys(map), runs[0].id].map((k) => [k, ""]));
    } else {
      pageList[slug] = runs.flatMap((r) => r.picks.map((p) => ({ ...p, section: r.title, sectionId: r.id })));
      for (const k of mine) ctx.anchors[k] = final(ctx.anchors[k]);
      aliases[slug] = Object.fromEntries(Object.keys(map).map((k) => [k, final(k)]));
    }
  }

  // 6. No section over the cap (sections no fold touched).
  for (const slug of guides()) {
    const out = new Set();
    for (const r of runsOf(page(slug))) {
      if (!r.id) continue;
      // The retypes of step 1 can put a third of a type in a section no fold touched (Life Moments > Baby held 3
      // "baby-gear" once the carrier and bouncers stopped reading as skincare): every section keeps its type caps.
      if (!fixed.has(slug)) for (const p of sectionTypeOut(r)) out.add(p);
      for (const p of overCap(r.picks.filter((x) => !out.has(x)), cap - r.picks.filter((x) => x.sponsor).length, keep)) out.add(p);
    }
    counts.sectionCapOut += out.size;
    if (out.size) pageList[slug] = page(slug).filter((p) => !out.has(p));
  }
  // 7. Sections by use (owner 11-20, ~/.lh-shots/gg-reference-1120/STANDARD.md: "a very rounded price guide and it has
  // aesthetic items"): a guide named in `byUse` is re-cut into sections named for when the gift is used, holding only
  // the picks its rule names (each with one short plain reason); every other pick of ours leaves the page. Sponsors
  // and the owner's own picks are never dropped: one no section names joins the first section. The old sections' ids
  // (and the old guide slugs that opened them) open the guide's top.
  for (const u of spec.byUse ?? []) {
    const list = page(u.guide);
    if (!list.length) { say("byUse (no guide)", u); continue; }
    const used = new Set();
    const oldIds = [...new Set(list.map((p) => p.sectionId).filter(Boolean))];
    const out = [];
    for (const sec of u.sections) {
      const picks = [];
      for (const r of sec.picks) {
        const p = list.find((x) => !used.has(x) && matches(x, r));
        if (!p) { if (!r.optional) say("byUse", { guide: u.guide, match: r.match }); continue; }
        used.add(p);
        picks.push({ ...p, ...(r.line ? { line: r.line } : {}), ...(r.set ?? {}), section: sec.title, sectionId: sec.id });
      }
      out.push(picks);
    }
    for (const p of list) if (!used.has(p) && (p.sponsor || p.ownerPick)) out[0].push({ ...p, section: u.sections[0].title, sectionId: u.sections[0].id });
    counts.byUseOut = (counts.byUseOut ?? 0) + list.length - out.flat().length;
    pageList[u.guide] = out.flatMap((picks) => picks.map((p, k) => ({ p, k })).sort((x, y) => rateOf(y.p) - rateOf(x.p) || x.k - y.k).map((x) => x.p));
    for (const k of Object.keys(ctx.anchors ?? {})) if (ctx.parentOf?.(k) === u.guide) delete ctx.anchors[k];
    const ids = new Set(u.sections.map((x) => x.id));
    aliases[u.guide] = { ...Object.fromEntries(Object.keys(aliases[u.guide] ?? {}).map((k) => [k, ""])), ...Object.fromEntries(oldIds.filter((k) => !ids.has(k)).map((k) => [k, ""])) };
  }
  return { counts, missing, aliases };
}
