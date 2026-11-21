/**
 * The owner's gift guide standard (2026-11-20): the verified plan (scripts/gift-guide-standard-1120.json, built from
 * the plan by scripts/gift-guide-standard-1120-build.mjs with her 9:12 PM decisions on top) is the LAST pass of the
 * picks build (scripts/giftGuideStandard1120.mjs). What must hold on every planned guide's generated list:
 *   - a pick the plan cut stays cut (the guard for a later pass or a re-added source putting it back);
 *   - a kept pick sits in the section the plan names, and the sections come in the plan's order;
 *   - nothing the plan never listed is on the page, unless it is an owner pick (a sponsor badge keeps a pick only on
 *     the sponsors guide and the Louisiana small-shop guide: owner 11-20 9:33 PM, a sponsor is guaranteed no spot);
 *   - Louisiana-brand picks the owner moved live only in a Louisiana guide; her five splurges stay off Her.
 * The full comparison (missing picks included) is scripts/check-gift-guide-standard.mjs.
 *
 * @mutate scripts/giftGuideStandard1120.mjs |       if (gone.has(p)) continue; |       if (gone.has(p)) { secs[at].push(p); continue; }
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { auditFix1120 } from "../../scripts/giftGuideSectionAudit1120.mjs";
import { SPONSOR_HOME_GUIDES, applyStandard, findPick } from "../../scripts/giftGuideStandard1120.mjs";

type Want = { name: string; href: string; line?: string };
type Row = { name: string; href: string; section?: string; sectionId?: string; line?: string; sponsor?: true; ownerPick?: true };
type Guide = { sections: { id: string; title: string; picks: Want[] }[]; cut: Want[]; ownerCall: Want[] };
const spec = JSON.parse(readFileSync("scripts/gift-guide-standard-1120.json", "utf8")) as { guides: Record<string, Guide> };
const page = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Row[] }).picks;
const guides = Object.entries(spec.guides);

describe("gift guide standard 1120: the plan is what the pages show", () => {
  it("covers the planned guides", () => {
    expect(guides.length).toBe(49);
    expect(spec.guides.healthcare).toBeUndefined(); // no plan: the by-use version stays
  });

  it("a pick the plan cut is not on its guide", () => {
    const back: string[] = [];
    for (const [slug, g] of guides) {
      const picks = page(slug);
      const kept = new Set(g.sections.flatMap((s) => s.picks).map((p) => `${p.name}|${p.href}`));
      for (const c of g.cut) if (!kept.has(`${c.name}|${c.href}`) && picks.some((p) => p.name === c.name && (!c.href || p.href === c.href))) back.push(`${slug}: ${c.name}`);
    }
    expect(back).toEqual([]);
  });

  it("each kept pick is in the plan's section, in the plan's order, and nothing unplanned is on the page", () => {
    const wrong: string[] = [];
    for (const [slug, g] of guides) {
      const picks = page(slug);
      const used = new Set<Row>();
      let last = -1;
      for (const s of g.sections) for (const want of s.picks) {
        // The section audit runs after the plan and may give a planned pick the name and link its retailer sells
        // today (the Carhartt beanie in Carhartt Brown): the same pick, found under the audit's name.
        const p = (findPick(picks, used, want) ?? findPick(picks, used, auditFix1120(slug, want) ?? want)) as Row | undefined;
        if (!p) continue; // a planned pick no source holds any more: reported by the check script, not a guard failure
        used.add(p);
        if (p.section !== s.title) wrong.push(`${slug}: "${p.name}" is in "${p.section}", plan "${s.title}"`);
        const i = picks.indexOf(p);
        if (i < last) wrong.push(`${slug}: "${p.name}" is out of the plan's order`);
        last = Math.max(last, i);
      }
      for (const c of g.ownerCall) { const p = findPick(picks, used, c) as Row | undefined; if (p) used.add(p); }
      for (const p of picks) if (!used.has(p) && !p.sponsor && !p.ownerPick) wrong.push(`${slug}: "${p.name}" is not in the plan`);
    }
    expect(wrong).toEqual([]);
  });

  it("the owner's 9:12 PM decisions hold", () => {
    const names = (slug: string) => page(slug).map((p) => p.name);
    for (const n of ["Printfresh Eco Satin Soho Pajama Set", "Southern Tide Textured Knit Lounge Pant", "Southern Tide Textured Knit Lounge Quarter Zip", "Olive & June Gel Mani System", "lululemon Define Cropped Jacket Nulu"]) expect(names("her"), n).not.toContain(n);
    for (const n of ["YETI Camino 35 Carryall Tote", "Kitsch Holiday Advent Calendar", "lululemon Define Jacket Luon"]) expect(names("her"), n).toContain(n);
    const louisiana = /^(louisiana-|shop-small-louisiana$)/;
    for (const [slug] of guides) {
      if (louisiana.test(slug)) continue;
      for (const n of names(slug)) expect(/^Southern Marsh (Marshlux Augusta|FieldTec Bozeman|Youth Regatta)|^Geometry Greetings From Louisiana|^Community Coffee/i.test(n), `${slug}: ${n}`).toBe(false);
    }
  });

  it("the owner's 9:33 PM decision holds: three sponsor picks live on the sponsors guide only, and popular picks took their Her spots", () => {
    const OFF = /^(SRI Labs DryQ|OYU Botanica Winter Radiance|Arey The System)/i;
    const seen: string[] = [];
    for (const f of readdirSync("src/content/giftGuidePicks").filter((x) => x.endsWith(".json"))) {
      for (const p of page(f.slice(0, -5))) if (OFF.test(p.name)) seen.push(`${f.slice(0, -5)}: ${p.name.match(OFF)![0]}`);
    }
    expect(seen.sort()).toEqual(["25-days-sponsors: Arey The System", "25-days-sponsors: OYU Botanica Winter Radiance", "25-days-sponsors: SRI Labs DryQ"]);
    const ready = page("her").filter((p) => p.section === "Getting ready").map((p) => p.name);
    for (const n of ["Lancôme Juicy Tubes Lip Gloss", "OLAPLEX No.7 Bonding Hair Oil", "Charlotte Tilbury Hollywood Flawless Filter"]) expect(ready, n).toContain(n);
  });
});

describe("applyStandard", () => {
  it("a sponsor badge keeps an unplanned pick only on the sponsors guide and the Louisiana small-shop guide", () => {
    const g: Guide = { sections: [{ id: "one", title: "One", picks: [{ name: "A", href: "a" }] }], cut: [], ownerCall: [] };
    const rows = (): Row[] => [{ name: "A", href: "a" }, { name: "Sponsor stray", href: "s", sponsor: true }, { name: "Owner pick", href: "o", ownerPick: true }];
    const pageList: Record<string, Row[]> = { her: rows(), "25-days-sponsors": rows(), "shop-small-louisiana": rows() };
    applyStandard(pageList, { guides: { her: g, "25-days-sponsors": g, "shop-small-louisiana": g } }, { snapshots: [], anchors: {}, aliases: {}, parentOf: () => undefined });
    expect(pageList.her.map((p) => p.name)).toEqual(["A", "Owner pick"]);
    expect([...SPONSOR_HOME_GUIDES].sort()).toEqual(["25-days-sponsors", "shop-small-louisiana"]);
  });

  const specOf = (g: Guide) => ({ guides: { g } });
  it("cuts, orders and sections a list, and leaves an owner call in place", () => {
    const pageList: Record<string, Row[]> = { g: [
      { name: "B", href: "b", section: "Old" }, { name: "Cut me", href: "c", section: "Old" }, { name: "Owner call", href: "o", section: "Old" }, { name: "A", href: "a", section: "Old", line: "old line" }, { name: "Stray", href: "s", section: "Old" },
    ] };
    const g: Guide = { sections: [{ id: "one", title: "One", picks: [{ name: "A", href: "a", line: "new line" }] }, { id: "two", title: "Two", picks: [{ name: "B", href: "b" }] }], cut: [{ name: "Cut me", href: "c" }], ownerCall: [{ name: "Owner call", href: "o" }] };
    applyStandard(pageList, specOf(g), { snapshots: [], anchors: {}, aliases: {}, parentOf: () => undefined });
    const names = pageList.g.map((p) => p.name);
    expect(names).not.toContain("Cut me");
    expect(names).not.toContain("Stray");
    expect(names).toContain("Owner call");
    expect(names.indexOf("A")).toBeLessThan(names.indexOf("B"));
    expect(pageList.g.find((p) => p.name === "A")).toMatchObject({ section: "One", line: "new line" });
    expect(pageList.g.find((p) => p.name === "B")).toMatchObject({ section: "Two" });
  });
});
