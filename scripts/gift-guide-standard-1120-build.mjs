/**
 * Builds scripts/gift-guide-standard-1120.json from the verified plan (owner standard 11-20,
 * ~/.lh-shots/gg-standard-wf/APPLY-PLAN.json): per guide, the sections in order with each kept pick (name, href and
 * its shopper reason), and the picks the plan cuts. A cut the plan marks needsOwnerOk is NOT a cut here (the owner
 * decides); pendingNewItems are never added. Run once per plan revision: node scripts/gift-guide-standard-1120-build.mjs [plan.json]
 */
import { LA_LINE } from "./giftGuideRules.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const src = process.argv[2] ?? `${homedir()}/.lh-shots/gg-standard-wf/APPLY-PLAN.json`;
const plan = JSON.parse(readFileSync(src, "utf8"));
const idOf = (t) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// A plan reason never ships when it breaks a standing rule: a price in the words (prices come only from the checked
// price field, and Amazon shows none), or Louisiana wording on a national guide. That pick keeps the line it had.
const LOUISIANA_GUIDE = /^louisiana-|^shop-small-louisiana$/;
const lineOk = (slug, why) => Boolean(why) && !/\$\s?\d/.test(why) && (LOUISIANA_GUIDE.test(slug) || !LA_LINE.test(why));
const guides = {};
for (const [slug, g] of Object.entries(plan)) {
  if (slug.startsWith("_") || !g || !Array.isArray(g.sections)) continue;
  guides[slug] = {
    sections: g.sections.map((s) => ({ id: idOf(s.title), title: s.title, picks: s.keep.map((k) => ({ name: k.name, href: k.href ?? "", ...(lineOk(slug, k.why) ? { line: k.why } : {}) })) })),
    cut: (g.cut ?? []).filter((c) => !c.needsOwnerOk).map((c) => ({ name: c.name, href: c.href ?? "" })),
    ownerCall: (g.cut ?? []).filter((c) => c.needsOwnerOk).map((c) => ({ name: c.name, href: c.href ?? "" })),
  };
}
// Owner decisions 2026-11-20 9:12 PM (her pop-up answers, relayed by the lead), applied on top of the plan:
//  1) Her splurges: five leave; the freed spots take back five mid-price picks the plan had cut (already in sources).
//  2) Louisiana-brand picks leave the non-Louisiana guides and live only in a Louisiana guide.
// The 25 new items and both women's Muck picks are still undecided and stay exactly as they are.
const OWNER_1120_NIGHT = {
  cut: {
    her: [/^Printfresh Eco Satin Soho Pajama Set/i, /^Southern Tide Textured Knit Lounge Pant/i, /^Southern Tide Textured Knit Lounge Quarter Zip/i, /^Olive & June Gel Mani System/i, /^lululemon Define Cropped Jacket Nulu/i],
    him: [/^Southern Marsh Marshlux Augusta Quarter-Zip/i, /^Southern Marsh FieldTec Bozeman Vest/i],
    kids: [/^Southern Marsh Youth Regatta Stretch Chino/i],
    "coffee-lover": [/^Community Coffee/i],
    "home-and-kitchen": [/^Geometry Greetings From Louisiana Tea Towel/i],
  },
  // [guide, section title, name pattern]: a cut pick that comes back
  back: [
    ["her", "Cozy nights at home", /^Sol de Janeiro Cheirosa 62.? Candle/i],
    ["her", "Cozy nights at home", /^Brooklinen Mulberry Silk Pillowcase/i],
    ["her", "Cozy nights at home", /^Le Creuset Mugs Set Of 4/i],
    ["her", "Cozy nights at home", /^Rifle Paper Co\. Embroidered Journal/i],
    ["her", "Out the door", /^Theo Grace Oval Monogram Signet Ring/i],
  ],
  // [from guide, to guide, section title, name pattern]: a Louisiana-brand pick moves to a Louisiana guide
  move: [
    ["him", "shop-small-louisiana", "Louisiana brands to wear and give", /^Southern Marsh Marshlux Augusta Quarter-Zip/i],
    ["him", "shop-small-louisiana", "Louisiana brands to wear and give", /^Southern Marsh FieldTec Bozeman Vest/i],
    ["kids", "shop-small-louisiana", "Louisiana brands to wear and give", /^Southern Marsh Youth Regatta Stretch Chino/i],
    ["home-and-kitchen", "shop-small-louisiana", "Food, candles and home", /^Geometry Greetings From Louisiana Tea Towel/i],
  ],
};
const ownerLog = [];
const section = (slug, title) => guides[slug].sections.find((s) => s.title === title);
for (const [from, to, title, re] of OWNER_1120_NIGHT.move) {
  const pick = guides[from].sections.flatMap((s) => s.picks).find((p) => re.test(p.name));
  if (!pick || !section(to, title)) { ownerLog.push(`move not possible: ${re} ${from} -> ${to}`); continue; }
  if (!section(to, title).picks.some((p) => re.test(p.name))) section(to, title).picks.push({ ...pick });
}
for (const [slug, res] of Object.entries(OWNER_1120_NIGHT.cut)) for (const re of res) {
  let hit = false;
  for (const s of guides[slug].sections) for (const p of s.picks.filter((x) => re.test(x.name))) { s.picks.splice(s.picks.indexOf(p), 1); guides[slug].cut.push({ name: p.name, href: p.href }); hit = true; }
  if (!hit) ownerLog.push(`owner cut not in the plan's keeps: ${slug} ${re}`);
}
for (const [slug, title, re] of OWNER_1120_NIGHT.back) {
  const i = guides[slug].cut.findIndex((c) => re.test(c.name));
  if (i < 0 || !section(slug, title)) { ownerLog.push(`take-back not in the plan's cuts: ${slug} ${re}`); continue; }
  const [c] = guides[slug].cut.splice(i, 1);
  section(slug, title).picks.push({ name: c.name, href: c.href });
}
if (ownerLog.length) console.log(ownerLog.join("\n"));
writeFileSync(new URL("./gift-guide-standard-1120.json", import.meta.url), `${JSON.stringify({ source: "APPLY-PLAN.json (gg-standard-wf, 2026-11-20) + owner decisions 11-20 9:12 PM", guides }, null, 1)}\n`);
console.log(`gift-guide-standard-1120: ${Object.keys(guides).length} guides, ${Object.values(guides).reduce((n, g) => n + g.sections.reduce((m, s) => m + s.picks.length, 0), 0)} kept, ${Object.values(guides).reduce((n, g) => n + g.cut.length, 0)} cut, ${Object.values(guides).reduce((n, g) => n + g.ownerCall.length, 0)} owner calls left in place`);
