/**
 * Builds scripts/gift-guide-standard-1120.json from the verified plan (owner standard 11-20,
 * ~/.lh-shots/gg-standard-wf/APPLY-PLAN.json): per guide, the sections in order with each kept pick (name, href and
 * its shopper reason), and the picks the plan cuts. A cut the plan marks needsOwnerOk is NOT a cut here (the owner
 * decides); pendingNewItems are never added. Run once per plan revision: node scripts/gift-guide-standard-1120-build.mjs [plan.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const src = process.argv[2] ?? `${homedir()}/.lh-shots/gg-standard-wf/APPLY-PLAN.json`;
const plan = JSON.parse(readFileSync(src, "utf8"));
const idOf = (t) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const guides = {};
for (const [slug, g] of Object.entries(plan)) {
  if (slug.startsWith("_") || !g || !Array.isArray(g.sections)) continue;
  guides[slug] = {
    sections: g.sections.map((s) => ({ id: idOf(s.title), title: s.title, picks: s.keep.map((k) => ({ name: k.name, href: k.href ?? "", ...(k.why ? { line: k.why } : {}) })) })),
    cut: (g.cut ?? []).filter((c) => !c.needsOwnerOk).map((c) => ({ name: c.name, href: c.href ?? "" })),
    ownerCall: (g.cut ?? []).filter((c) => c.needsOwnerOk).map((c) => ({ name: c.name, href: c.href ?? "" })),
  };
}
writeFileSync(new URL("./gift-guide-standard-1120.json", import.meta.url), `${JSON.stringify({ source: "APPLY-PLAN.json (gg-standard-wf, 2026-11-20)", guides }, null, 1)}\n`);
console.log(`gift-guide-standard-1120: ${Object.keys(guides).length} guides, ${Object.values(guides).reduce((n, g) => n + g.sections.reduce((m, s) => m + s.picks.length, 0), 0)} kept, ${Object.values(guides).reduce((n, g) => n + g.cut.length, 0)} cut, ${Object.values(guides).reduce((n, g) => n + g.ownerCall.length, 0)} owner calls left in place`);
