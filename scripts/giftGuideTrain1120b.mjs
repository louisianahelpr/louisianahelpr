/**
 * TRAIN 1120b (lead 44, 2026-11-20): the last pass scripts/gift-guide-picks.mjs makes over the finished pages, from
 * scripts/gift-guide-train-1120b.json:
 *   - the re-audit's fixes (~/Desktop/Gift-guide-picks/_audit-full-1120b-p1/p2/p3.json, every High and Medium):
 *     cuts, keep-N, type caps per section, moves (to another guide or section), photo swaps and name fixes;
 *   - the rates the earning Louisiana files hold (Goldbelly 12%, KREWE 16%, Toups 10%...) on the rows that lost them;
 *   - the national 25 Days sponsors (owner 11-20 ~8:35 AM): ONE normal spot each, in a best-fit section (never a cover,
 *     the Top 10 or a guide's first section row), with the sponsor badge; every other copy outside the sponsors guide
 *     and the store pages leaves;
 *   - the Walmart deals box: no house brands, furniture or obscure marketplace singles;
 *   - sales the sidebar lists (Georgia Boot 20% off, Nov 20-25).
 * It works on the final page lists, so what it does is exactly what ships. Each rule that names an item it cannot find
 * is reported (a stale rule never fails silently); `optional` rules may find nothing.
 * Guard: src/test/giftGuideTrain1120b.test.ts.
 */

/** Letters and digits only, lower case ("Café Du Monde" -> "cafedumonde"). */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** Whether a pick matches a rule: its name (or brand + name) holds the rule's fragment, or equals it with `exact`. */
export const matches = (p, rule) => {
  const m = fold(rule.match);
  if (!m) return false;
  const n = fold(p.name);
  return rule.exact ? n === m : n.includes(m) || fold(`${p.brand ?? ""} ${p.name}`).includes(m);
};
const inSection = (p, rule) => !rule.section || fold(p.section).includes(fold(rule.section));

/**
 * Inserts `pick` at the end of its section on `list` (after the section's last pick), or at the end of the page.
 * A guide whose picks carry no section takes it as is.
 */
export function placeInSection(list, pick, sectionTitle) {
  if (!sectionTitle) return [...list, pick];
  const want = fold(sectionTitle);
  const at = list.reduce((last, p, i) => (fold(p.section).includes(want) ? i : last), -1);
  if (at < 0) return [...list, pick];
  const host = list[at];
  const placed = { ...pick, section: host.section, ...(host.sectionId ? { sectionId: host.sectionId } : {}) };
  return [...list.slice(0, at + 1), placed, ...list.slice(at + 1)];
}

/** A sponsor brand's picks: its brand field, or a name that starts with the brand (first word of a "Brand (Maker)" name). */
const sponsorKey = (brand) => fold(String(brand).replace(/\s*\(.*\)\s*$/, "").replace(/\s*\/.*$/, ""));
export const isBrandPick = (p, brand) => {
  const k = sponsorKey(brand);
  if (k.length < 3) return false;
  return fold(p.brand) === k || fold(p.brand).startsWith(k) || fold(p.name).startsWith(k);
};

/**
 * Applies the train to `pageList` ({ slug: picks[] }) and `deals` ({ storeSlug: deal sections[] }) in place; returns a
 * report { counts, missing: [rule descriptions that found nothing] }.
 * `ctx`: { sponsorsGuide: "25-days-sponsors", readJson(file) for the earning files, sales: the sidebar's sales array }.
 */
export function applyTrain1120b(pageList, deals, spec, ctx) {
  const counts = { cut: 0, keep: 0, typeCap: 0, move: 0, image: 0, rename: 0, rate: 0, sponsorsPlaced: 0, sponsorCopiesOut: 0, dealsOut: 0, dealItemsOut: 0, sales: 0, adds: 0 };
  const missing = [];
  const say = (kind, rule) => missing.push(`${kind}: ${rule.guide ?? ""} ${rule.section ? `[${rule.section}] ` : ""}${rule.match ?? rule.brand ?? ""}`);
  const page = (slug) => pageList[slug] ?? [];
  const isPeopleGuide = (slug) => !slug.startsWith("store-") && slug !== ctx.sponsorsGuide;

  // Moves first (their targets' cuts must not take the moved pick), then cuts.
  for (const r of spec.moves ?? []) {
    const from = page(r.guide);
    const i = from.findIndex((p) => matches(p, r) && inSection(p, { section: r.fromSection }));
    if (i < 0) { say("move", r); continue; }
    const p = { ...from[i], ...(r.set ?? {}) };
    pageList[r.guide] = from.filter((_, j) => j !== i);
    const to = page(r.to);
    // A move into a page without sections drops the old section fields; into a section, placeInSection sets them.
    const { section: _s, sectionId: _id, ...bare } = p;
    pageList[r.to] = placeInSection(to, r.section ? bare : (to.some((x) => x.section) ? p : bare), r.section);
    counts.move += 1;
  }
  for (const r of spec.cuts ?? []) {
    const list = page(r.guide);
    const hit = list.filter((p) => matches(p, r) && inSection(p, r));
    if (!hit.length) { if (!r.optional) say("cut", r); continue; }
    const out = new Set(r.all ? hit : hit.slice(0, 1));
    pageList[r.guide] = list.filter((p) => !out.has(p));
    counts.cut += out.size;
  }
  for (const r of spec.keep ?? []) {
    const list = page(r.guide);
    const hit = list.filter((p) => matches(p, r) && inSection(p, r));
    if (!hit.length) { say("keep", r); continue; }
    const out = new Set(hit.slice(r.keep));
    pageList[r.guide] = list.filter((p) => !out.has(p));
    counts.keep += out.size;
  }
  for (const r of spec.typeCaps ?? []) {
    const list = page(r.guide);
    // Owner picks and sponsors keep their place: the lowest-ranked other picks of the type go first.
    const hit = list.filter((p) => p.type === r.type && inSection(p, r));
    if (!hit.length) { say("typeCap", { ...r, match: r.type }); continue; }
    const ranked = [...hit.filter((p) => p.ownerPick || p.sponsor), ...hit.filter((p) => !p.ownerPick && !p.sponsor)];
    const out = new Set(ranked.slice(r.max));
    pageList[r.guide] = list.filter((p) => !out.has(p));
    counts.typeCap += out.size;
  }
  for (const r of spec.images ?? []) {
    const list = page(r.guide);
    const i = list.findIndex((p) => matches(p, r));
    if (i < 0) { say("image", r); continue; }
    list[i] = { ...list[i], image: r.image };
    counts.image += 1;
  }
  for (const r of spec.renames ?? []) {
    let n = 0;
    for (const slug of Object.keys(pageList)) {
      pageList[slug] = pageList[slug].map((p) => {
        if (!String(p.name).includes(r.match)) return p;
        n += 1;
        return { ...p, name: String(p.name).split(r.strip).join("").replace(/\s{2,}/g, " ").trim() };
      });
    }
    if (!n) say("rename", r);
    counts.rename += n;
  }

  // Rates the earning Louisiana files hold, on rows that carry none (audit p2: "commission None" on Goldbelly/KREWE/Toups).
  const rates = new Map();
  for (const f of spec.commissionFrom ?? []) {
    let rows = [];
    try { rows = ctx.readJson(f) ?? []; } catch { rows = []; /* mid-write: no rates this run */ }
    for (const r of Array.isArray(rows) ? rows : []) if (r && typeof r.href === "string" && typeof r.commission === "number" && r.commission > 0) rates.set(r.href, r.commission);
  }
  for (const slug of Object.keys(pageList)) {
    pageList[slug] = pageList[slug].map((p) => {
      if (p.commission != null || !rates.has(p.href)) return p;
      counts.rate += 1;
      return { ...p, commission: rates.get(p.href) };
    });
  }

  for (const r of spec.adds ?? []) {
    if (Object.values(pageList).some((l) => l.some((p) => p.href === r.row.href && isPeopleGuide(r.guide)))) { say("add (already placed)", { ...r, match: r.row.name }); continue; }
    pageList[r.guide] = placeInSection(page(r.guide), { ...r.row }, r.section);
    counts.adds += 1;
  }

  // National 25 Days sponsors: one spot each.
  const sponsorsList = page(ctx.sponsorsGuide);
  for (const s of spec.nationalSponsors ?? []) {
    let keep = null;
    if (s.keepMatch) {
      const i = page(s.guide).findIndex((p) => matches(p, { match: s.keepMatch }));
      if (i < 0) { say("sponsor keep", { ...s, match: s.keepMatch }); continue; }
      keep = page(s.guide)[i];
      page(s.guide)[i] = { ...keep, sponsor: true, commission: keep.commission ?? 0 };
      keep = page(s.guide)[i];
    }
    // Every other copy of this sponsor on a guide (not its own spot, the sponsors guide or a store page) leaves.
    for (const slug of Object.keys(pageList)) {
      if (!isPeopleGuide(slug)) continue;
      const before = pageList[slug].length;
      pageList[slug] = pageList[slug].filter((p) => p === keep || !isBrandPick(p, s.brand));
      counts.sponsorCopiesOut += before - pageList[slug].length;
    }
    if (keep) { counts.sponsorsPlaced += 1; continue; }
    let base = null;
    if (s.fromSponsorsGuide) {
      const src = sponsorsList.find((p) => matches(p, { match: s.fromSponsorsGuide }));
      if (!src) { say("sponsor row", { ...s, match: s.fromSponsorsGuide }); continue; }
      const { section: _s, sectionId: _i, from: _f, ...rest } = src;
      base = rest;
    } else base = { ...s.row, brand: s.brand.replace(/\s*\(.*\)\s*$/, "").replace(/\s*\/.*$/, "") };
    const pick = { ...base, ...(s.set ?? {}), brand: base.brand ?? s.brand, line: s.line || base.line || "", sponsor: true, commission: 0 };
    pageList[s.guide] = placeInSection(page(s.guide), pick, s.section);
    counts.sponsorsPlaced += 1;
  }

  // The Walmart deals box.
  const w = spec.walmartDeals;
  if (w && Array.isArray(deals[w.store])) {
    const before = deals[w.store].length;
    deals[w.store] = deals[w.store]
      .filter((d) => !(w.dropTitles ?? []).includes(d.title))
      .filter((d) => !(w.dropMavelySingles && !d.items && /(^|\.)mavely\.app\.link$/.test(hostOf(d.href))))
      .map((d) => {
        const rx = w.keepItems?.[d.title];
        if (!rx || !Array.isArray(d.items)) return d;
        const re = new RegExp(rx, "i");
        const items = d.items.filter((it) => re.test(it.name));
        counts.dealItemsOut += d.items.length - items.length;
        return { ...d, items };
      })
      .filter((d) => !Array.isArray(d.items) || d.items.length > 0);
    counts.dealsOut += before - deals[w.store].length;
    // The sidebar's Sales were read from these deals earlier: a dropped deal leaves them too.
    if (Array.isArray(ctx.sales)) {
      const kept = new Set(deals[w.store].map((d) => d.href));
      for (let i = ctx.sales.length - 1; i >= 0; i -= 1) if (ctx.sales[i].slug === w.store && !kept.has(ctx.sales[i].href)) ctx.sales.splice(i, 1);
    }
  }

  for (const s of spec.sales ?? []) {
    if (Array.isArray(ctx.sales) && !ctx.sales.some((x) => x.href === s.href)) {
      const { why: _w, ...sale } = s;
      ctx.sales.push(sale);
      counts.sales += 1;
    }
  }
  return { counts, missing };
}

function hostOf(u) {
  try { return new URL(u).hostname; } catch { return ""; /* not a URL: no host */ }
}
