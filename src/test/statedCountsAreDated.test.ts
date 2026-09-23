// @mutate scripts/check-stated-counts.mjs | const dated = DATE_RE.test(b.text); | const dated = true;
/*
 * Every stated count is generated, a dated record, dated, or in the shrinking
 * baseline (scripts/check-stated-counts.mjs; owner, 2026-09-23: "ANY number we
 * track or keep count of, anywhere, must always be current").
 *
 * The registered mutation treats every paragraph as dated, so no count is ever
 * UNDATED: the baseline's 580-odd entries then match nothing and every one
 * reports stale — the real two-way check below goes red.
 */
import { describe, it, expect } from "vitest";
import {
  COUNT_RE,
  compare,
  docClass,
  loadBaseline,
  scanAll,
  scanText,
  // @ts-expect-error — plain .mjs script, no declaration file
} from "../../scripts/check-stated-counts.mjs";

type Hit = { file: string; cls: string; key: string; text: string };

describe("stated counts are dated", () => {
  it("the scan is real, and the repo holds no undated count outside the baseline — both directions", async () => {
    const hits = (await scanAll()) as Hit[];
    expect(hits.length).toBeGreaterThanOrEqual(2000);
    expect(hits.filter((h) => h.cls === "dated").length).toBeGreaterThanOrEqual(400);
    const { added, stale } = compare(hits, loadBaseline().undated) as { added: Hit[]; stale: string[] };
    expect(added.map((h) => h.key)).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("is RED on a new undated count in a living doc, green once it carries its date", () => {
    const undated = scanText("docs/RUNBOOK.md", "The app has 73 edge functions.", "living") as Hit[];
    expect(undated.map((h) => h.cls)).toEqual(["undated"]);
    expect((compare(undated, []) as { added: Hit[] }).added).toHaveLength(1);
    const dated = scanText("docs/RUNBOOK.md", "The app had 73 edge functions on 2026-09-23.", "living") as Hit[];
    expect(dated.map((h) => h.cls)).toEqual(["dated"]);
  });

  it("is RED on a baseline entry that no longer matches anything", () => {
    const { stale } = compare([], ["docs/X.md :: 12 routes"]) as { stale: string[] };
    expect(stale).toEqual(["docs/X.md :: 12 routes"]);
  });

  it("classifies generated files, dated records and generated blocks, and skips non-counts", () => {
    const gen = new Set(["docs/audit/launch-2026-09/SURFACE.md", "docs/GUARD-BURNDOWN.md"]);
    expect(docClass("docs/audit/launch-2026-09/SURFACE.md", gen, "# t")).toBe("generated");
    expect(docClass("docs/GUARD-BURNDOWN.md", gen, "x\n<!-- generated:burndown-score -->\n")).toBe("living");
    expect(docClass("docs/archive/COVERAGE_2026-08-31.md", gen, "")).toBe("record");
    expect(docClass("docs/REPORT.md", gen, "# R\n**Date:** 2026-09-03\n")).toBe("record");
    const inBlock = scanText("docs/G.md", "<!-- generated:x -->\n| 715 files |\n<!-- /generated:x -->", "living") as Hit[];
    expect(inBlock).toEqual([]);
    for (const s of ["§3 dimension", 'pluralisation ("1 job")', "v1.2 routes", "$500 jobs", "2026-09-23 routes"]) {
      expect([...s.matchAll(COUNT_RE)], s).toHaveLength(0);
    }
    expect([...("**802** addressable surfaces".matchAll(COUNT_RE))]).toHaveLength(1);
  });
});
