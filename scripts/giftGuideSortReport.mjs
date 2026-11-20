/**
 * The COMMISSION INVENTORY (owner 11-19 ~6:40 PM: "reevaluate all ideas once we have all links and commissions known"):
 * every product the sort pass placed or held, its brand, store, rate, the guides it is on, the other stores and rates on
 * file, the guide popularity rank and the unknown-rate list. Written by scripts/gift-guide-picks.mjs when GIFT_SORT_REPORT
 * names the output file.
 */
import { commissionOf } from "./giftGuideSort.mjs";

const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const host = (h) => { try { return new URL(h).hostname.replace(/^www\./, ""); } catch { return ""; } };
const compact = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

export const commissionInventory = ({ pool, ranks, ctx, counts, generatedAt }) => {
  const rankOf = new Map(ranks.map((s, i) => [s, i + 1]));
  const views = ctx.popularity?.pageviews ?? {};
  const rows = pool.map((e) => {
    const c = commissionOf(e.p, ctx.rateData, ctx.today);
    const best = ctx.rateData.otherRates.get(compact(e.p.brand));
    const others = [ctx.otherRates.get(e.p.href) ?? ctx.otherRates.get(e.p.swappedFrom ?? ""), best ? Object.entries(best).map(([k, v]) => `${k} ${v}${typeof v === "number" ? "%" : ""}`).join(", ") : ""].filter(Boolean).join("; ");
    const on = [...e.on].sort((a, b) => (rankOf.get(a) ?? 999) - (rankOf.get(b) ?? 999));
    return { e, c, others, on, bestRank: on.length ? Math.min(...on.map((s) => rankOf.get(s) ?? 999)) : 9999 };
  });
  const placed = rows.filter((r) => r.on.length).sort((a, b) => (b.c.pct ?? -1) - (a.c.pct ?? -1) || a.bestRank - b.bestRank || a.e.p.name.localeCompare(b.e.p.name));
  const held = rows.filter((r) => !r.on.length);
  const unknown = placed.filter((r) => r.c.pct === null);
  const lines = [];
  lines.push("# Gift guide commission inventory", "");
  lines.push(`Generated ${generatedAt} by scripts/gift-guide-picks.mjs (the 1119e sort pass). Every number below is read from the link files at that time; re-run the importer with GIFT_SORT_REPORT set to refresh it.`, "");
  lines.push("## How rates are read", "");
  lines.push("- ShopMy: the pin's rate in _shopmy-mylinks-1119.tsv, else commission_pct in the link files.");
  lines.push("- Amazon: the Associates category base rate (1% grocery/health/video games, 3% toys/home/beauty/sports/pet/tools, 4% clothing/shoes/electronics, 4.5% kitchen/books, 10% luxury beauty), or a JOINED Creator Connections campaign's total (base + bonus) while it runs.");
  lines.push("- Walmart: Walmart's category table (14% apparel/shoes/jewelry, 4.2% home/beauty, 3.5% tools, 2.8% toys/electronics/kitchen/sports, 0% grocery).");
  lines.push("- CJ, Awin, Rakuten: the program rate in Affiliate-approvals-1117.md. Later: the best-rates table in the link library.");
  lines.push("- A plain shop link (Louisiana shops, sponsors, brand sites) earns nothing: 0%. Unknown = no rate on file.", "");
  lines.push("## Summary", "");
  lines.push(`- Products on guides: ${placed.length}. Held (not on any guide): ${held.length}.`);
  lines.push(`- Unknown rate on a guide: ${unknown.length}.`);
  lines.push(`- Creator Connections: ${counts.ccCampaigns} of ${counts.ccOf} joined campaigns placed; ${counts.swapped} guide links swapped to a campaign ASIN.`);
  lines.push(`- Owner picks not on any guide: ${counts.ownerHeld.length}.`, "");
  lines.push("## Guide popularity (placement order)", "");
  lines.push("Ranked by Vercel Web Analytics pageviews per guide (production, 2026-11-05 to 2026-11-20 UTC, read 2026-11-19), then by search demand for guides with equal or no views. The most popular guides took their candidates first.", "");
  lines.push("| Rank | Guide | Pageviews |", "|---|---|---|");
  ranks.forEach((s, i) => lines.push(`| ${i + 1} | ${s} | ${views[s] ?? 0} |`));
  lines.push("", "## Item popularity", "");
  lines.push("Each item's popularity score adds: a trending flag (30), its ShopMy clicks (3 each, up to 30, from _shopmy-mylinks-1119.tsv), a recognizable brand (15) and an owner pick (5). Within a guide the order is commission, high to low; popularity breaks ties.", "");
  lines.push("## Every product on a guide (by rate, high to low)", "");
  lines.push("| Product | Brand | Store / link | Rate | Rate source | Guides (by popularity) | Other stores and rates | Type |", "|---|---|---|---|---|---|---|---|");
  for (const r of placed) lines.push(`| ${cell(r.e.p.name)} | ${cell(r.e.p.brand)} | ${cell(r.e.p.store?.replace(/^store-/, "") ?? host(r.e.p.href))} (${host(r.e.p.href)}) | ${r.c.pct === null ? "unknown" : `${r.c.pct}%`} | ${cell(r.c.source)}${r.e.p.swappedFrom ? ` (swapped from ${r.e.p.swappedFrom}, ${r.e.p.swappedFromPct ?? "?"}%)` : ""} | ${r.on.map((s) => `${s} (#${rankOf.get(s)})`).join(", ")} | ${cell(r.others)} | ${r.e.p.type} |`);
  lines.push("", "## Unknown-rate list (on a guide, no rate on file)", "");
  if (!unknown.length) lines.push("None.");
  for (const r of unknown) lines.push(`- ${cell(r.e.p.name)} (${cell(r.e.p.brand)}), ${r.e.p.href}, on ${r.on.join(", ")}`);
  lines.push("", "## Held products (not on any guide), by rate", "");
  lines.push("Held because a guide was full (25), its type or brand cap was reached, a judgment cut, or no fitting guide had room.", "");
  lines.push("| Product | Brand | Rate | Candidate guides | Source |", "|---|---|---|---|---|");
  for (const r of held.sort((a, b) => (b.c.pct ?? -1) - (a.c.pct ?? -1))) lines.push(`| ${cell(r.e.p.name)} | ${cell(r.e.p.brand)} | ${r.c.pct === null ? "unknown" : `${r.c.pct}%`} | ${[...r.e.guides].join(", ")} | ${r.e.source} |`);
  return `${lines.join("\n")}\n`;
};
