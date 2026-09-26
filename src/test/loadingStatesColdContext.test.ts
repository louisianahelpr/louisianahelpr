/**
 * EVERY LOADING-STATE MEASUREMENT IS A COLD FIRST VISIT (#1773 class).
 *
 * The app persists its React Query cache to IndexedDB (src/lib/queryPersister.ts)
 * and IndexedDB lives as long as the browser context. A measurement that
 * reuses one context across surfaces measures a WARM visit whenever a sibling
 * surface fetched the same queries first: the data can rehydrate so the
 * skeleton never draws, or draws a different subset, and which sibling ran
 * first depends on worker timing. The measurement did not repeat:
 * loading-states-refresh runs 36158775025 and 36186004139 (2026-09-25) on the SAME commit
 * (3569359) disagreed on 21 of 139 surface lines (78 vs 73 measured;
 * `helper /profile` was `cl=2/2` in one and `no-placeholder` in the other).
 * baseline.json is two-way, so a measurement that does not repeat can never
 * settle it: loading-states-refresh never passed, and staleness-watch went red
 * on that (nightly-red #1773). The flips reproduced locally were the boot-frame
 * race in nextStage (src/test/loadingStatesRepeat.test.ts); this guard removes
 * the second, order-dependent source: a shared context's persisted cache.
 *
 * INVENTORY: every script under scripts/ or e2e/ that launches a browser AND
 * writes the loading-state evidence (docs/audit/loading-states, what
 * scripts/check-loading-state-shape.mjs judges) is a loading-state
 * measurement. For each, some loop must build a context per surface (a
 * newContext call in the loop, directly or through a local helper that never
 * hands back a cached one), close it in that loop, and hold no nested loop that
 * navigates on its own (that is a context shared by every surface of the inner
 * loop, e.g. one context per viewport walking every route).
 *
 * @mutate scripts/audit/measure-loading-states.mjs | const r = await measureOne(ctx, t).finally(() => ctx.close().catch(() => {})); | const r = await measureOne(ctx, t);
 * @mutate scripts/audit/measure-loading-states.mjs | const freshContext = async (persona) => { | const cached = new Map(); const freshContext = async (persona) => { if (cached.has(persona)) return cached.get(persona);
 * @mutate scripts/audit/measure-loading-states.mjs | const ctx = await freshContext(t.persona); | const ctx = sharedContext;
 * @mutate scripts/audit/measure-loading-states.mjs | const OUT = resolve(REPO, process.env.OUT ?? "docs/audit/loading-states"); | const OUT = resolve(REPO, process.env.OUT ?? "docs/audit/elsewhere");
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:mjs|js|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const LAUNCHES = /\b(?:chromium|webkit|firefox)\.launch\(/;
const WRITES_EVIDENCE = /docs\/audit\/loading-states/;

/** The `{...}` body starting at the first `{` at or after `from`. */
function bodyAt(src: string, from: number): string {
  const open = src.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return "";
}

/** Local helpers (`const f = async (...) => {` / `function f(`) whose body makes a context and never returns a cached one. */
function freshContextHelpers(src: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>|async\s+function\s+(\w+)\s*\([^)]*\))\s*\{/g;
  for (let m; (m = re.exec(src)); ) {
    const body = bodyAt(src, m.index + m[0].length - 1);
    if (/\bnewContext\(/.test(body) && !/\.get\(/.test(body) && !/\.has\(/.test(body)) out.add(m[1] ?? m[2]);
  }
  return out;
}

/** The bodies of every loop that walks the surfaces (`for (;;)` / `for (const x of ...)`). */
function loopBodies(src: string): string[] {
  const out: string[] = [];
  const re = /\bfor\s*\((?:\s*;\s*;\s*|\s*const\s+\w+\s+of\s+[^)]*)\)\s*\{/g;
  for (let m; (m = re.exec(src)); ) out.push(bodyAt(src, m.index + m[0].length - 1));
  return out;
}

/** How many loops build a context per surface, close it, and walk no surfaces of their own inside. */
function perSurfaceLoops(src: string): number {
  const helpers = freshContextHelpers(src);
  return loopBodies(src).filter((body) => {
    const makes =
      /\bnewContext\(/.test(body) ||
      [...helpers].some((h) => new RegExp(`\\bawait\\s+${h}\\(`).test(body));
    const nestedWalk = loopBodies(body).some((inner) => /\.goto\(/.test(inner));
    return makes && /\.close\(/.test(body) && !nestedWalk;
  }).length;
}

const measurers = walk(join(ROOT, "scripts"))
  .concat(walk(join(ROOT, "e2e")))
  .filter((f) => {
    const src = blankComments(readFileSync(f, "utf8"));
    return LAUNCHES.test(src) && WRITES_EVIDENCE.test(src);
  });

describe("every loading-state measurement is a cold first visit", () => {
  it("finds the loading-state measurements (inventory floor)", () => {
    expect(measurers.map((f) => relative(ROOT, f))).toContain("scripts/audit/measure-loading-states.mjs");
    expect(measurers.length).toBeGreaterThan(0);
  });

  it.each(measurers.map((f) => [relative(ROOT, f)]))("%s measures each surface in its own fresh context", (rel) => {
    expect(
      perSurfaceLoops(blankComments(readFileSync(join(ROOT, rel), "utf8"))),
      `${rel}: no surface loop builds its own browser context and closes it. A context reused across surfaces keeps ` +
        `the persisted React Query cache (IndexedDB), so a later surface measures a warm visit and the result depends on ` +
        `run order. Create the context inside the loop (or through a helper that never returns a cached one) and close it there.`,
    ).toBeGreaterThan(0);
  });

  it("rejects the shapes that share a context (the rule can fail)", () => {
    const perPersona = `
      const byPersona = new Map();
      const contextFor = async (p) => { if (byPersona.has(p)) return byPersona.get(p); const c = await browser.newContext(); byPersona.set(p, c); return c; };
      for (;;) { const ctx = await contextFor(t.persona); await measureOne(ctx, t); }
      for (const c of byPersona.values()) await c.close();`;
    const perViewport = `
      for (const width of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width } });
        for (const route of ROUTES) { const page = await ctx.newPage(); await page.goto(route); }
        await ctx.close();
      }`;
    const perSurface = `
      const fresh = async (p) => { const c = await browser.newContext(); return c; };
      for (;;) { const ctx = await fresh(t.persona); await measureOne(ctx, t).finally(() => ctx.close()); }`;
    expect(perSurfaceLoops(perPersona)).toBe(0);
    expect(perSurfaceLoops(perViewport)).toBe(0);
    expect(perSurfaceLoops(perSurface)).toBe(1);
  });
});
