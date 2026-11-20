/**
 * TRAIN 1120c (lead 44, 2026-11-20): the pass scripts/gift-guide-picks.mjs makes after train 1120b, from
 * scripts/gift-guide-train-1120c.json. It reuses train 1120b's rules (adds, moves, cuts, keep, type caps, images,
 * renames, store fills; scripts/giftGuideTrain1120b.mjs) and adds:
 *   - brandCodes: a brand's discount code on every one of its cards, with the code's last day (`codeEnds`; the card
 *     hides the chip after it): XTRATUF XT25, Nov 20-29;
 *   - priceCap: a pick with a checked price over the cap leaves every guide (owner 11-20: "drop any item over $500"),
 *     except the named keeps (the Dyson Airwrap on Mom).
 * Each rule that finds nothing is reported. Guard: src/test/giftGuideTrain1120c.test.ts.
 */
import { applyTrain1120b, fold } from "./giftGuideTrain1120b.mjs";

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
