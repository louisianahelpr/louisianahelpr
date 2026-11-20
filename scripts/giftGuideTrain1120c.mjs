/**
 * TRAIN 1120c (lead 44, 2026-11-20): the pass scripts/gift-guide-picks.mjs makes after train 1120b, from
 * scripts/gift-guide-train-1120c.json. It reuses train 1120b's rules (adds, moves, cuts, keep, type caps, images,
 * renames, store fills; scripts/giftGuideTrain1120b.mjs) and adds:
 *   - brandCodes: a brand's discount code on every one of its cards, with the code's last day (`codeEnds`; the card
 *     hides the chip after it): XTRATUF XT25, Nov 20-29;
 *   - priceCap: a pick with a checked price over the cap leaves every guide (owner 11-20: "drop any item over $500"),
 *     except the named keeps (the Dyson Airwrap on Mom);
 *   - type caps after the adds: an add over a section's cap of one gift type keeps its spot, the lowest-paying other
 *     pick of the type leaves.
 * Each rule that finds nothing is reported. Guard: src/test/giftGuideTrain1120c.test.ts.
 */
import { applyTrain1120b, fold } from "./giftGuideTrain1120b.mjs";
import { typeMax } from "./giftGuideSort.mjs";

/** Lists with their own order (scripts/gift-guide-picks.mjs SORT_FIXED): no type cap. */
const SORT_FIXED_1120C = new Set(["subscriptions", "gift-cards", "gift-wrap-and-cards", "mail-carrier-and-delivery-drivers"]);

export function applyTrain1120c(pageList, deals, spec, ctx) {
  const t = applyTrain1120b(pageList, deals, spec, ctx);
  const say = (s) => t.missing.push(s);
  t.counts.codes = 0;
  for (const c of spec.brandCodes ?? []) {
    let n = 0;
    for (const slug of Object.keys(pageList)) {
      pageList[slug] = pageList[slug].map((p) => {
        if (fold(p.brand) !== fold(c.brand)) return p;
        n += 1;
        return { ...p, code: c.code, ...(c.ends ? { codeEnds: c.ends } : {}) };
      });
    }
    if (!n) say(`brandCode: ${c.brand}`);
    t.counts.codes += n;
  }
  // A section still holds at most spec.sectionCap picks (owner 11-19: "25 max per SECTION"): the adds push a full one
  // over, so its lowest-paying other picks leave (sections read best-paying first; sponsors and this train's adds stay).
  t.counts.sectionCapOut = 0;
  if (spec.sectionCap) {
    const added = new Set((spec.adds ?? []).map((a) => a.row?.href));
    for (const slug of Object.keys(pageList)) {
      if (slug.startsWith("store-") || slug === ctx.sponsorsGuide) continue;
      const bySection = new Map();
      for (const p of pageList[slug]) bySection.set(p.section ?? "", [...(bySection.get(p.section ?? "") ?? []), p]);
      const out = new Set();
      for (const list of bySection.values()) {
        const over = list.length - spec.sectionCap;
        if (over <= 0) continue;
        const cuttable = list.filter((p) => !p.sponsor && !added.has(p.href));
        for (const p of cuttable.slice(-over)) out.add(p);
      }
      pageList[slug] = pageList[slug].filter((p) => !out.has(p));
      t.counts.sectionCapOut += out.size;
    }
  }
  // The type caps still hold after the adds (owner 11-19 type variety; scripts/giftGuideSort.mjs typeMax, read per
  // section as src/test/giftGuideSort1119e.test.ts reads it): an add that takes a section past its cap of one gift type
  // keeps its spot and the lowest-paying other pick of that type leaves. Owner picks and sponsors never leave, and the
  // owner's own picks are not held to the cap (her picks beat our rules).
  t.counts.typeCapOut = 0;
  {
    const added = new Set((spec.adds ?? []).map((a) => a.row?.href));
    const fixed = (s) => SORT_FIXED_1120C.has(s ?? "");
    const rate = (p) => (typeof p.commission === "number" ? p.commission : -1);
    for (const slug of Object.keys(pageList)) {
      if (slug.startsWith("store-") || slug === ctx.sponsorsGuide || fixed(slug)) continue;
      const bySection = new Map();
      for (const p of pageList[slug]) {
        if (fixed(p.from)) continue;
        const k = p.sectionId && p.sectionId !== "top-picks" ? p.sectionId : slug;
        bySection.set(k, [...(bySection.get(k) ?? []), p]);
      }
      const out = new Set();
      for (const [key, list] of bySection) {
        const byType = new Map();
        for (const p of list) byType.set(p.type ?? "other", [...(byType.get(p.type ?? "other") ?? []), p]);
        for (const [type, ofType] of byType) {
          const cap = Math.max(typeMax(key, type), ...ofType.map((p) => typeMax(p.from ?? key, type)));
          const mine = ofType.filter((p) => p.ownerPick).length;
          const over = ofType.length - Math.max(cap, mine);
          if (over <= 0) continue;
          const keepFirst = (p) => (added.has(p.href) ? 1 : 0);
          const cuttable = ofType.filter((p) => !p.ownerPick && !p.sponsor)
            .sort((a, b) => keepFirst(a) - keepFirst(b) || rate(a) - rate(b));
          for (const p of cuttable.slice(0, over)) out.add(p);
        }
      }
      pageList[slug] = pageList[slug].filter((p) => !out.has(p));
      t.counts.typeCapOut += out.size;
    }
  }
  t.counts.overCap = 0;
  const cap = spec.priceCap;
  if (cap) {
    const keep = (p) => (cap.keep ?? []).some((k) => fold(p.name).includes(fold(k)));
    for (const slug of Object.keys(pageList)) {
      const before = pageList[slug].length;
      pageList[slug] = pageList[slug].filter((p) => !(typeof p.price === "number" && p.price > cap.max) || keep(p));
      t.counts.overCap += before - pageList[slug].length;
    }
  }
  return t;
}
