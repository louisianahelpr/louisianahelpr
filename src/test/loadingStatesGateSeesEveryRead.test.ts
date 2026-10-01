/**
 * THE LOADING-STATE GATE SEES EVERY READ (Q1654 P2).
 *
 * scripts/audit/measure-loading-states.mjs holds every Supabase data request
 * with page.route until the loading frame is measured. Playwright's route
 * never sees a fetch a service worker answers, and the app's Workbox SW
 * (vite.config.ts runtimeCaching, NetworkFirst on *.supabase.co) claims the
 * page about a second in and answers every GET. Run 36784259578 (2026-09-30)
 * logged 1156 data GETs across 88 surfaces that never reached the route (the
 * earliest at 1168ms) against 0 HEAD/POST, so every page's reads went
 * straight to prod while the gate was shut and data painted in the frame
 * judged as "loading" (/post-job's real cards at waves=0).
 *
 * INVENTORY: every script under scripts/ or e2e/ that launches a browser AND
 * writes the loading-state evidence (docs/audit/loading-states). Every browser
 * context such a script opens must pass serviceWorkers: "block".
 *
 * @mutate scripts/audit/measure-loading-states.mjs | deviceScaleFactor: 2, serviceWorkers: "block" }); | deviceScaleFactor: 2 });
 * @mutate scripts/audit/measure-loading-states.mjs | deviceScaleFactor: 2, serviceWorkers: "block" }); | deviceScaleFactor: 2, serviceWorkers: "allow" });
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

/** The argument text of every `newContext(...)` call (balanced parentheses). */
function contextArgs(src: string): string[] {
  const out: string[] = [];
  const re = /\bnewContext\(/g;
  for (let m; (m = re.exec(src)); ) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

const blocks = (args: string) => /\bserviceWorkers\s*:\s*["']block["']/.test(args);

const measurers = walk(join(ROOT, "scripts"))
  .concat(walk(join(ROOT, "e2e")))
  .filter((f) => {
    const src = blankComments(readFileSync(f, "utf8"));
    return LAUNCHES.test(src) && WRITES_EVIDENCE.test(src);
  });

describe("the loading-state gate sees every read", () => {
  it("finds the loading-state measurements (inventory floor)", () => {
    expect(measurers.map((f) => relative(ROOT, f))).toContain("scripts/audit/measure-loading-states.mjs");
  });

  it.each(measurers.map((f) => [relative(ROOT, f)]))("%s blocks service workers in every context", (rel) => {
    const args = contextArgs(blankComments(readFileSync(join(ROOT, rel), "utf8")));
    expect(args.length, `${rel}: opens no browser context`).toBeGreaterThan(0);
    const open = args.filter((a) => !blocks(a));
    expect(
      open,
      `${rel}: a browser context without serviceWorkers: "block". The app's SW answers every Supabase GET, and ` +
        `page.route never sees those fetches, so the gate holds only writes and data paints in the "loading" frame.`,
    ).toEqual([]);
  });

  it("rejects a context that lets the SW in (the rule can fail)", () => {
    expect(contextArgs(`browser.newContext({ viewport: V, deviceScaleFactor: 2 })`).filter((a) => !blocks(a))).toHaveLength(1);
    expect(contextArgs(`browser.newContext({ serviceWorkers: "allow" })`).filter((a) => !blocks(a))).toHaveLength(1);
    expect(contextArgs(`browser.newContext({ viewport: f(1), serviceWorkers: "block" })`).filter((a) => !blocks(a))).toHaveLength(0);
  });
});
