/**
 * The Web Vitals lab (scripts/perf/cwv-lab.mjs) loads signed-in first screens
 * on PROD with a shared test account's session injected (sessionInit), so a
 * screen that writes on load (analytics RPCs, a token refresh, a mark-read)
 * would reach the real database. Rule (2026-10-09 lesson: a local screenshot
 * script applied to a real job): every browser context holding a test session
 * against prod aborts every non-GET request to Supabase and Stripe, and
 * proves the block fired before it measures anything.
 *
 * The block was built on the browser-perf lane (wip/limit-a1e95198, saved at a
 * usage-limit stop on 2026-10-12) and stranded there; this guard keeps it.
 *
 * @mutate scripts/perf/cwv-lab.mjs |       if (m === "GET" \|\| m === "HEAD" \|\| m === "OPTIONS") return route.continue(); |       return route.continue();
 * @mutate scripts/perf/cwv-lab.mjs |             await probeWriteBlock(ctx, blocked); |             void blocked;
 * @mutate scripts/perf/cwv-lab.mjs | const WRITE_BLOCK_HOSTS = /(^\|\.)supabase\.co$\|(^\|\.)stripe\.com$/; | const WRITE_BLOCK_HOSTS = /(^\|\.)stripe\.com$/;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const src = blankComments(readFileSync(resolve(ROOT, "scripts/perf/cwv-lab.mjs"), "utf8"));

describe("cwv-lab blocks every prod write before it measures", () => {
  it("the block covers Supabase and Stripe and lets only GET, HEAD and OPTIONS through", () => {
    const hosts = /const WRITE_BLOCK_HOSTS = (\/.*\/);/.exec(src)?.[1] ?? "";
    const re = new RegExp(hosts.slice(1, -1));
    expect(re.test("fncmgoasalhdgfwzhsqa.supabase.co")).toBe(true);
    expect(re.test("api.stripe.com")).toBe(true);
    expect(re.test("www.louisianahelpr.com")).toBe(false);
    expect(src).toMatch(/if \(m === "GET" \|\| m === "HEAD" \|\| m === "OPTIONS"\) return route\.continue\(\);\s*\n[\s\S]*?return route\.abort\("blockedbyclient"\);/);
  });

  it("every context installs the block and proves it live before any session or navigation", () => {
    const contexts = [...src.matchAll(/const ctx = await browser\.newContext\(/g)].map((m) => m.index ?? 0);
    expect(contexts.length).toBeGreaterThan(0);
    for (const at of contexts) {
      const after = src.slice(at);
      const install = after.indexOf("await installWriteBlock(ctx");
      const probe = after.indexOf("await probeWriteBlock(ctx, blocked)");
      const session = after.indexOf("sessionInit(");
      const nav = after.indexOf("page.goto(");
      expect(install, "installWriteBlock is called on the new context").toBeGreaterThan(-1);
      expect(probe, "the block is proven live").toBeGreaterThan(install);
      expect(session, "before the test session is injected").toBeGreaterThan(probe);
      expect(nav, "and before the first navigation").toBeGreaterThan(probe);
    }
  });

  it("the probe throws unless its POST failed AND was recorded as blocked", () => {
    expect(src).toMatch(/if \(outcome !== "failed" \|\| blocked\.length !== before \+ 1\) \{\s*throw new Error/);
  });
});
