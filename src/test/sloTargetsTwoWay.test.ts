// @mutate scripts/slo.mjs | return (slo.good === "max" ? value <= slo.target : value >= slo.target) ? "PASS" : "FAIL"; | return "PASS";
// @mutate scripts/slo.mjs | if (s.notMeasured) { out.push(unk(s, `not measured (${s.notMeasured})`)); continue; } | if (false) { continue; }
// @mutate scripts/scoreboard.mjs | rows.push(...sloTargetRows(AT_HEAD)); | rows.push();
// @mutate scripts/slo.mjs | if (!ok && !bad) { out.push(unk(s, "no payment_intent succeeded/failed events in 7 days")); continue; } | if (false) { continue; }
/*
 * Q66: "working" is a set of numbers with targets, shown on the scoreboard and
 * RED when missed. The class this stops: a target list that drifts from what
 * was asked for (a metric silently dropped, or a made-up one added), a target
 * shown on the scoreboard that the code no longer defines, and a metric that
 * reads green without a measurement.
 *
 * TWO-WAY, both directions each time:
 *   - Q66's own list in docs/OPEN.md  <->  scripts/slo.mjs SLOS (by `q66` phrase);
 *   - SLOS  <->  the scoreboard's "target:" rows (generated, and committed);
 *   - SLOS  <->  the live rows measureSlos() returns (one per metric).
 * And the verdict: inside the target (on it included) PASS, outside FAIL, no
 * number UNKNOWN — never PASS for a metric that cannot be measured here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import * as slo from "../../scripts/slo.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import * as sb from "../../scripts/scoreboard.mjs";

type Slo = { id: string; q66: string; name: string; target: number; unit: string; good: "max" | "min"; ci: string | null; notMeasured?: string };
type Row = { signal: string; status: string; note: string; value?: number | null };

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SLOS: Slo[] = slo.SLOS;
const NOW = new Date("2026-09-24T12:00:00Z");

/** The metric list as Q66 itself words it: 'Define "working" as numbers: a, b, ... . Show each'. */
function q66Phrases(open: string): string[] {
  const item = /^- \[[ x~]\] \*\*Q66 [\s\S]*?(?=\n- \[)/m.exec(open)?.[0] ?? "";
  const list = /as numbers:\s*([\s\S]*?)\.\s*Show each/.exec(item)?.[1];
  if (!list) throw new Error("Q66's metric sentence not found in docs/OPEN.md");
  return list.replace(/\s+/g, " ").split(/,\s*(?![^(]*\))/).map((s) => s.trim());
}

const good = { sqlFn: async (q: string) => (q.includes("payout_transfers") ? [{ n: 12, p95_h: 26.5, p50_h: 24.2 }] : q.includes("notification_logs") ? [{ ok: 995, bad: 5, intentional: 40 }] : [{ ok: 40, bad: 1 }]),
  logsFn: async () => [{ total: 10000, errors: 12 }],
  runsFn: async () => [...Array(1000).fill({ conclusion: "success" }), { conclusion: "failure" }, { conclusion: "cancelled" }] };

describe("Q66's metric list and scripts/slo.mjs agree, both ways", () => {
  const phrases = q66Phrases(read("docs/OPEN.md"));

  it("has a real list (cannot pass vacuously)", () => {
    expect(phrases.length).toBeGreaterThan(5);
    expect(SLOS.length).toBeGreaterThan(5);
  });

  it("every Q66 metric has a target, and every target is a Q66 metric", () => {
    const defined = new Set(SLOS.map((s) => s.q66));
    expect(phrases.filter((p) => !defined.has(p)).map((p) => `Q66 names "${p}" but scripts/slo.mjs defines no target for it`)).toEqual([]);
    expect([...defined].filter((d) => !phrases.includes(d)).map((d) => `scripts/slo.mjs defines "${d}", which Q66 does not name`)).toEqual([]);
  });

  it("each metric either names how CI measures it, or says why it cannot", () => {
    for (const s of SLOS) {
      expect(Boolean(s.ci) !== Boolean(s.notMeasured), `${s.id}: exactly one of ci / notMeasured`).toBe(true);
      expect(s.target, s.id).toBeGreaterThan(0);
    }
    expect(new Set(SLOS.map((s) => s.id)).size).toBe(SLOS.length);
  });

  it("the SQL reads tables that exist in the generated schema", () => {
    const types = read("src/integrations/supabase/types.ts");
    const tables = Object.values(slo.SQL as Record<string, string>).flatMap((q) => [...q.matchAll(/public\.(\w+)/g)].map((m) => m[1]));
    expect(tables.length).toBeGreaterThan(3);
    for (const t of tables) expect(types, `public.${t}`).toMatch(new RegExp(`^      ${t}: \\{`, "m"));
  });
});

describe("the scoreboard shows every target and nothing else, both ways", () => {
  const names = SLOS.map((s) => `target: ${s.name}`).sort();
  const targetsIn = (rows: { signal: string }[]) => rows.map((r) => r.signal).filter((x) => x.startsWith("target: ")).sort();

  it("the generated local rows carry one INFO row per metric", () => {
    const rows = sb.localRows();
    expect(targetsIn(rows)).toEqual(names);
    for (const r of rows.filter((x: Row) => x.signal.startsWith("target: "))) expect(r.status).toBe("INFO");
  });

  it("the committed docs/SCOREBOARD.md carries the same rows", () => {
    const committed = read("docs/SCOREBOARD.md").split("\n").filter((l) => l.startsWith(`| ${slo.GROUP} | target: `))
      .map((l) => ({ signal: l.split(/(?<!\\)\|/)[2].trim() }));
    expect(targetsIn(committed)).toEqual(names);
  });
});

describe("a target is RED when missed and never green without a number", () => {
  const byId = (id: string) => SLOS.find((s) => s.id === id)!;

  it("judges both directions, with the target itself inside", () => {
    const up = byId("uptime"), err = byId("api-error-rate");
    expect(slo.judge(up, up.target)).toBe("PASS");
    expect(slo.judge(up, up.target - 0.01)).toBe("FAIL");
    expect(slo.judge(err, err.target)).toBe("PASS");
    expect(slo.judge(err, err.target + 0.01)).toBe("FAIL");
    expect(slo.judge(up, null)).toBe("UNKNOWN");
    expect(slo.judge(up, NaN)).toBe("UNKNOWN");
  });

  it("measured and inside every target: one row per metric, PASS where measured, UNKNOWN (why) where not", async () => {
    const rows: Row[] = await slo.measureSlos({ now: NOW, ...good });
    expect(rows.map((r) => r.signal).sort()).toEqual(SLOS.map((s) => s.name).sort());
    for (const s of SLOS) {
      const r = rows.find((x) => x.signal === s.name)!;
      if (s.notMeasured) {
        expect(r.status, s.id).toBe("UNKNOWN");
        expect(r.note, s.id).toMatch(/^UNKNOWN: not measured \(/);
      } else {
        expect(r.status, `${s.id}: ${r.note}`).toBe("PASS");
        expect(r.note, s.id).toMatch(/ vs target /);
      }
    }
  });

  it("outside the target is FAIL", async () => {
    const rows: Row[] = await slo.measureSlos({ now: NOW,
      sqlFn: async (q: string) => (q.includes("payout_transfers") ? [{ n: 3, p95_h: 71, p50_h: 50 }] : [{ ok: 10, bad: 10 }]),
      logsFn: async () => [{ total: 100, errors: 7 }],
      runsFn: async () => [...Array(90).fill({ conclusion: "success" }), ...Array(10).fill({ conclusion: "failure" })] });
    for (const s of SLOS.filter((x) => !x.notMeasured)) expect(rows.find((r) => r.signal === s.name)!.status, s.id).toBe("FAIL");
  });

  it("an empty window, a thrown fetch, or a bad shape is UNKNOWN with the reason — never PASS", async () => {
    const empty: Row[] = await slo.measureSlos({ now: NOW, sqlFn: async () => [{ ok: 0, bad: 0, n: 0 }], logsFn: async () => [{ total: 0, errors: 0 }], runsFn: async () => [{ conclusion: "cancelled" }] });
    const thrown: Row[] = await slo.measureSlos({ now: NOW, sqlFn: async () => { throw new Error("Management API 401"); }, logsFn: async () => { throw new Error("boom"); }, runsFn: async () => { throw new Error("gh missing"); } });
    const shape: Row[] = await slo.measureSlos({ now: NOW, sqlFn: async () => [{}], logsFn: async () => [{}], runsFn: async () => [] });
    for (const rows of [empty, thrown, shape]) {
      expect(rows).toHaveLength(SLOS.length);
      for (const r of rows) {
        expect(r.status, r.signal).toBe("UNKNOWN");
        expect(r.note, r.signal).toMatch(/^UNKNOWN: \S/);
      }
    }
    // and the scoreboard renders them (the shape check requires the reason)
    expect(sb.renderRow({ ...thrown[2], at: "2026-09-24T12:00Z" })).toMatch(/UNKNOWN: measurement failed/);
  });
});
