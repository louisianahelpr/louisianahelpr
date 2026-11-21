/**
 * OWNER 11-20 phone fixes (scripts/gift-guide-owner-1120d.json): fills the spots the owner's removals freed and adds
 * Dad / Him / Grandpa gifts under $25. The removals are rules (OWNER_REMOVED and ownerStyleOff in giftGuideRules.mjs),
 * so a row here that a rule would take off is refused, never placed. A row already on its page is skipped (no repeat).
 * Each row that cannot be placed is reported. Guard: src/test/giftGuideOwner1120d.test.ts.
 */
import { placeInSection } from "./giftGuideTrain1120b.mjs";
import { OWNER_REMOVED, ownerStyleOff } from "./giftGuideRules.mjs";

export function applyOwner1120d(pageList, spec) {
  const counts = { adds: 0, already: 0, refused: 0 };
  const missing = [];
  for (const a of spec.adds ?? []) {
    const list = pageList[a.guide];
    if (!list) { missing.push(`${a.guide}: no page for ${a.row.name}`); continue; }
    if (list.some((p) => p.href === a.row.href)) { counts.already += 1; continue; }
    const fromKey = { ...a.row, from: a.section.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
    if (OWNER_REMOVED(a.row) || ownerStyleOff(a.guide, fromKey)) { counts.refused += 1; missing.push(`${a.guide}: ${a.row.name} breaks an owner rule`); continue; }
    if (!list.some((p) => String(p.section ?? "") === a.section)) { missing.push(`${a.guide}: no section ${a.section} for ${a.row.name}`); continue; }
    pageList[a.guide] = placeInSection(list, { ...a.row }, a.section);
    counts.adds += 1;
  }
  return { counts, missing };
}
