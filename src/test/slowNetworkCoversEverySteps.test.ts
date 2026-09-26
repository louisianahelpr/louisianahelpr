/**
 * Q68: the slow-network suite covers every core journey step, both ways, and
 * really runs nightly.
 *
 *   docs/OPEN.md Q68's journey list  ⇄  e2e/slow-network/steps.ts
 *   steps.ts × {3g, drop}            ⇄  the tests in slow-network.spec.ts
 *   every step's route               →  a real <Route path> in src/App.tsx
 *   every 3g test throttles and measures progress; every drop test goes
 *   offline and asserts the app says so; every drop test of a WRITE step
 *   asserts the write lands exactly once after a lost response
 *   playwright.config.ts + .github/workflows/slow-network.yml run it, 1 worker, on a schedule
 *
 * @mutate e2e/slow-network/slow-network.spec.ts | test(stepTitle("message", "drop"), | test.skip(stepTitle("message", "drop"),
 * @mutate e2e/slow-network/slow-network.spec.ts | await expectExactlyOnce(request, t.poster, q, "messages row"); | // removed
 * @mutate e2e/slow-network/slow-network.spec.ts | await throttle3g(ctx, page);\n  // Stops at Stripe's door | // Stops at Stripe's door
 * @mutate e2e/slow-network/steps.ts | { id: "browse", route: "/browse", write: null }, | { id: "browse", route: "/browse-all", write: null },
 * @mutate .github/workflows/slow-network.yml | --project=slow-network --workers=1 | --project=slow-network
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { NETWORK_MODES, SLOW_NETWORK_STEPS } from "../../e2e/slow-network/steps";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const SPEC = blankComments(read("e2e/slow-network/slow-network.spec.ts"));

/** Each `test(stepTitle("<step>", "<mode>"), …)` and the source of its body (to the next top-level test). */
function specTests(): Array<{ step: string; mode: string; body: string }> {
  const re = /^test\(stepTitle\("([^"]+)",\s*"([^"]+)"\)/gm;
  const hits = [...SPEC.matchAll(re)];
  return hits.map((m, i) => ({
    step: m[1],
    mode: m[2],
    body: SPEC.slice(m.index!, i + 1 < hits.length ? hits[i + 1].index : SPEC.length),
  }));
}

describe("slow-network covers every core journey step, two ways", () => {
  const tests = specTests();
  const stepIds = SLOW_NETWORK_STEPS.map((s) => s.id as string);

  it("inventory floors", () => {
    expect(SLOW_NETWORK_STEPS.length).toBeGreaterThan(5);
    expect(tests.length).toBeGreaterThan(11);
  });

  it("the steps are exactly the journeys docs/OPEN.md Q68 names", () => {
    // Q68 is ticked into the month's archive once done; read wherever it lives.
    const q68 = ["docs/OPEN.md", "docs/archive/OPEN-done-2026-09.md"]
      .map((f) => /\*\*Q68 [^\n]*\n(?:[^\n]*\n){0,4}/.exec(read(f))?.[0])
      .find(Boolean)!;
    const named = /journeys?\s*\(([^)]+)\)/.exec(q68.replace(/\s+/g, " "))![1].split(",").map((w) => w.trim().replace(/\s+/g, "-"));
    expect(named.length).toBeGreaterThan(5);
    // "pay" in the queue text is the pay START step here: nothing is charged.
    const norm = (w: string) => (w === "pay" ? "pay-start" : w);
    expect(named.map(norm).sort()).toEqual([...stepIds].sort());
  });

  it("every step × mode has a test, and no test names an unknown step or mode", () => {
    const have = new Set(tests.map((t) => `${t.step}|${t.mode}`));
    for (const s of stepIds) for (const m of NETWORK_MODES) expect(have.has(`${s}|${m}`), `missing test: ${s} · ${m}`).toBe(true);
    for (const t of tests) {
      expect(stepIds, `test names unknown step "${t.step}"`).toContain(t.step);
      expect(NETWORK_MODES as readonly string[], `test names unknown mode "${t.mode}"`).toContain(t.mode);
    }
    expect(tests.length).toBe(stepIds.length * NETWORK_MODES.length);
  });

  it("3g tests throttle and measure progress; drop tests go offline and demand the offline copy", () => {
    for (const t of tests) {
      if (t.mode === "3g") {
        expect(t.body, `${t.step} · 3g never throttles`).toMatch(/throttle3g\(/);
        expect(t.body, `${t.step} · 3g never measures a wait`).toMatch(/waitShowsProgress\(/);
      } else {
        expect(t.body, `${t.step} · drop never drops the connection`).toMatch(/setOffline\(true\)/);
        expect(t.body, `${t.step} · drop never asserts the offline copy`).toMatch(/expectOfflineSaid\(/);
      }
    }
  });

  it("every WRITE step's drop test loses a response and asserts exactly-once", () => {
    const writes = SLOW_NETWORK_STEPS.filter((s) => s.write && s.id !== "sign-in");
    expect(writes.length).toBeGreaterThan(3);
    for (const s of writes) {
      const t = tests.find((x) => x.step === s.id && x.mode === "drop")!;
      expect(t.body, `${s.id} · drop never loses a response`).toMatch(/loseNextResponse\(/);
      expect(t.body, `${s.id} · drop never checks the write happened exactly once`).toMatch(/await expectExactlyOnce\(/);
    }
  });

  it("every step's route is a real route in src/App.tsx", () => {
    const app = read("src/App.tsx");
    const routes = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
    expect(routes.size).toBeGreaterThan(20);
    for (const s of SLOW_NETWORK_STEPS) expect(routes.has(s.route), `${s.id}: ${s.route} is not a route`).toBe(true);
  });

  it("runs nightly on one worker", () => {
    const cfg = read("playwright.config.ts");
    const block = /\{\s*name: "slow-network",[\s\S]*?\n {4}\},/.exec(cfg)?.[0] ?? "";
    expect(block, "no slow-network project in playwright.config.ts").toMatch(/testDir: "\.\/e2e\/slow-network"/);
    expect(block).toMatch(/workers: 1,/);
    const wf = read(".github/workflows/slow-network.yml");
    expect(wf).toMatch(/^\s+- cron: "[^"]+"/m);
    expect(wf).toContain("npx playwright test --project=slow-network --workers=1 ");
    expect(wf).toMatch(/workflow-name: slow-network/);
  });
});
