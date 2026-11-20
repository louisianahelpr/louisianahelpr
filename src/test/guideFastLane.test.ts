/**
 * Guide fast lane (owner, 2026-11-20: a gift-guide PR waited ~5 hours behind
 * 10 PRs and ~15 queued jobs). A PR that changes only the guide lane
 * (scripts/ci/guide-only.mjs GUIDE_CONTENT) skips the Vitest and Coverage
 * shards, both Playwright checks' work and Lighthouse; vitest.yml's "Guide fast
 * lane" job runs typecheck, the build, the sitemap drift check and every test
 * that reads the changed files, and the required "Vitest unit tests" check
 * passes only when that lane passed.
 *
 * The danger is a lane that quietly grows to cover code users run. So:
 *  - every file the lane matches today (git index) is content, a guide-only
 *    script or a guide-only test: never src/** /*.ts(x) outside src/content
 *    and the guide tests, never pages/components/hooks, api/, workflows or
 *    package files; the one src/lib file is a data-only slug manifest;
 *  - no lane script is imported by shipped code or by the build chain;
 *  - a code file anywhere in the PR means the whole suite runs;
 *  - the workflows skip only on an explicit 'true' and gate the required
 *    check on the lane's own result.
 *
 * @mutate scripts/ci/guide-only.mjs |   "src/content/giftGuidePicks/**",\n |   "src/content/giftGuidePicks/**",\n  "src/pages/info/giftGuides/**",\n
 * @mutate scripts/ci/guide-only.mjs |   return changed.every((f) => isGuideContent(f) \|\| RIDE_RE.some((r) => r.test(f))); |   return true;
 * @mutate src/lib/giftGuideShareImages.mjs | export const OG_JPG_SLUGS | export function pick() { return 1; }\nexport const OG_JPG_SLUGS
 * @mutate .github/workflows/vitest.yml |             test "$LANE" = "success" |             true
 * @mutate .github/workflows/vitest.yml |     needs: scope\n    if: ${{ !cancelled() && needs.scope.outputs.guide_only != 'true' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 25 |     needs: scope\n    if: ${{ needs.scope.outputs.guide_only != 'true' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 25
 * @mutate .github/workflows/vitest.yml |       - name: Production build\n        run: npm run build\n |
 * @mutate .github/workflows/e2e-happy-path.yml |       - name: Run happy-path smoke tests\n        if: github.event_name != 'pull_request' \|\| (steps.filter.outputs.ui == 'true' && steps.guide.outputs.guide_only != 'true') |       - name: Run happy-path smoke tests\n        if: github.event_name != 'pull_request' \|\| steps.guide.outputs.guide_only != 'true'
 * @mutate .github/workflows/lighthouse.yml |       - "!public/sitemap.xml"\n |
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
import { GUIDE_CONTENT, RIDE_ALONG, MAX_FAST_TESTS, globToRegExp, isGuideContent, isGuideOnly, pickGuideTests } from "../../scripts/ci/guide-only.mjs";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean);
const lane = tracked.filter((f) => isGuideContent(f));

/** The one src/lib file in the lane: api/share.ts's slug manifest. */
const DATA_MANIFESTS = ["src/lib/giftGuideShareImages.mjs", "src/lib/giftGuideShareImages.d.mts"];
const GUIDE_TEST = /^src\/test\/(giftGuide[A-Za-z0-9]*\.test\.tsx?|goLinks\.test\.ts|helpers\/giftGuide[A-Za-z0-9]*\.ts|fixtures\/giftGuide[A-Za-z0-9]*\.json)$/;
const GUIDE_SCRIPT = /^scripts\/(gift-guide-[a-z0-9-]+|giftGuide[A-Za-z0-9]+|go-links|check-gift-cover-[a-z-]+)\.(mjs|d\.mts|json|py)$/;

describe("the guide lane covers content, guide-only scripts and guide-only tests, never shipped code", () => {
  it("matches a real inventory (floor: >100 tracked files)", () => {
    expect(lane.length).toBeGreaterThan(100);
  });

  it("every glob starts in a content, image, guide-script or guide-test location", () => {
    const allowed = /^(src\/content\/(giftGuide|goLinks)|src\/lib\/giftGuideShareImages\.(mjs|d\.mts)$|public\/gift-guides\/|public\/sitemap\.xml$|scripts\/(gift-guide-|giftGuide|go-links\.|check-gift-cover-)|src\/test\/(giftGuide|goLinks\.test\.ts$|helpers\/giftGuide|fixtures\/giftGuide))/;
    for (const g of GUIDE_CONTENT) expect(g, g).toMatch(allowed);
    expect(RIDE_ALONG).toEqual(["docs/**"]);
  });

  it("no matched file is shipped code: src/**/*.ts(x) only under src/content or as a guide test; no pages, components, hooks, api, workflows, package files", () => {
    const bad = lane.filter((f) => {
      if (DATA_MANIFESTS.includes(f)) return false;
      if (/^(src\/(pages|components|hooks|integrations|config)\/|api\/|supabase\/|e2e\/|\.github\/|package(-lock)?\.json$|vite\.config|index\.html$)/.test(f)) return true;
      if (/^src\//.test(f) && !f.startsWith("src/content/") && !GUIDE_TEST.test(f)) return true;
      if (/^scripts\//.test(f) && !GUIDE_SCRIPT.test(f)) return true;
      return false;
    });
    expect(bad).toEqual([]);
  });

  it("the src/lib manifest stays data: only exported Sets of string literals", () => {
    const code = blankComments(read("src/lib/giftGuideShareImages.mjs")).replace(/\s+/g, " ").trim();
    const stmts = code.split(";").map((s) => s.trim()).filter(Boolean);
    expect(stmts.length).toBeGreaterThan(1);
    // Whitespace is collapsed to single spaces above, so the list reads unambiguously (no backtracking, CodeQL js/redos).
    for (const s of stmts) expect(s).toMatch(/^export const [A-Z_]+ = new Set\(\[ ?(?:"[a-z0-9-]+"(?:, ?"[a-z0-9-]+")*,? ?)?\]\)$/);
  });

  it("no lane script is imported by shipped code (src outside tests, api/) or by the build chain", () => {
    const laneScripts = lane.filter((f) => f.startsWith("scripts/") && /\.(mjs|d\.mts)$/.test(f));
    expect(laneScripts.length).toBeGreaterThan(5);
    const build = JSON.parse(read("package.json")).scripts.build as string;
    const buildChain = [...build.matchAll(/node (scripts\/[^\s&]+)/g)].map((m) => m[1]);
    expect(buildChain.length).toBeGreaterThan(2);
    const shipped = tracked.filter((f) =>
      (/^src\/.*\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.|^src\/test\//.test(f)) || /^api\/.*\.(ts|mjs|js)$/.test(f) || f === "vite.config.ts" || buildChain.includes(f));
    expect(shipped.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    for (const f of shipped) {
      const src = blankComments(read(f));
      for (const s of laneScripts) {
        const stem = s.replace(/^scripts\//, "").replace(/(\.d)?\.mts$|\.mjs$/, "");
        if (new RegExp(`(?:from|import\\()\\s*["'][^"']*scripts/${stem.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?:\\.mjs)?["']`).test(src)) offenders.push(`${f} -> ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("isGuideOnly: one file outside the lane runs the whole suite", () => {
  it("guide content alone, or with docs, is guide-only", () => {
    expect(isGuideOnly(["src/content/giftGuidePicks/dad.json"])).toBe(true);
    expect(isGuideOnly(["src/content/goLinks.json", "public/gift-guides/covers/dad.webp", "docs/OPEN.md"])).toBe(true);
    expect(isGuideOnly(["scripts/giftGuideRules.mjs", "src/test/giftGuideFitR4.test.ts"])).toBe(true);
  });
  it("any code file, an empty list, or docs alone is not", () => {
    expect(isGuideOnly(["src/content/giftGuidePicks/dad.json", "src/pages/info/giftGuides/GiftGuideView.tsx"])).toBe(false);
    expect(isGuideOnly(["src/content/giftGuidePicks/dad.json", "src/test/seoPageBodies.test.ts"])).toBe(false);
    expect(isGuideOnly(["src/content/goLinks.json", "package.json"])).toBe(false);
    expect(isGuideOnly(["src/content/giftWishList.ts"])).toBe(false);
    expect(isGuideOnly([])).toBe(false);
    expect(isGuideOnly(["docs/OPEN.md"])).toBe(false);
  });
  it("globs: * stays inside one path segment", () => {
    expect(globToRegExp("src/content/giftGuide*.ts").test("src/content/giftGuides.ts")).toBe(true);
    expect(globToRegExp("src/content/giftGuide*.ts").test("src/content/giftGuide/x/evil.ts")).toBe(false);
  });
});

describe("the picker runs every test that reads a changed guide file", () => {
  const tests = tracked.filter((f) => /^src\/.*\.test\.tsx?$/.test(f));
  it("a picks change runs the guide suites plus the tests that read the picks (floor: >30, under the cap)", () => {
    const picked = pickGuideTests(["src/content/giftGuidePicks/dad.json"], tests, read);
    expect(picked.length).toBeGreaterThan(30);
    expect(picked.length).toBeLessThanOrEqual(MAX_FAST_TESTS);
    expect(picked).toContain("src/test/goLinks.test.ts");
    expect(picked.some((t) => !/giftGuide|goLinks|giftWish|navGiftGuides/.test(t))).toBe(true);
  });
  it("a test that imports a changed script (relative or @/) is picked", () => {
    const files: Record<string, string> = {
      "src/test/a.test.ts": 'import { x } from "../../scripts/giftGuideRules.mjs";',
      "src/test/b.test.ts": 'import { y } from "@/lib/mid";',
      "src/lib/mid.ts": 'export { z } from "../content/giftGuides";',
      "src/test/c.test.ts": "expect(1).toBe(1)",
    };
    const r = (p: string) => { if (!(p in files)) throw new Error(`no ${p}`); return files[p]; };
    const picked = pickGuideTests(["scripts/giftGuideRules.mjs", "src/content/giftGuides.ts"], ["src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"], r);
    expect(picked).toEqual(["src/test/a.test.ts", "src/test/b.test.ts"]);
  });
});

type Step = { name?: string; id?: string; if?: string; run?: string };
type Job = { name?: string; needs?: string | string[]; if?: string; steps?: Step[] };
const wf = (f: string) => parse(read(`.github/workflows/${f}`)) as { on: Record<string, { paths?: string[] }>; jobs: Record<string, Job> };

describe("the workflows skip only on an explicit 'true' and gate the required check on the lane", () => {
  const v = wf("vitest.yml");
  it("vitest.yml: the shards run unless scope said 'true' (a failed scope runs them)", () => {
    for (const id of ["vitest-shard", "coverage-shard"]) {
      expect(v.jobs[id].needs, id).toEqual("scope");
      expect(v.jobs[id].if, id).toMatch(/!cancelled\(\) && .*needs\.scope\.outputs\.guide_only != 'true'/);
    }
  });
  it("vitest.yml: the fast lane runs typecheck, the build, the sitemap check and the picked tests", () => {
    const j = Object.values(v.jobs).find((x) => x.name === "Guide fast lane")!;
    expect(j.if).toBe("${{ needs.scope.outputs.guide_only == 'true' }}");
    const runs = (j.steps ?? []).map((s) => s.run ?? "").join("\n");
    for (const cmd of ["node scripts/ci/guide-only.mjs", "npx tsc -b --noEmit", "npm run build", "node scripts/generate-sitemap.mjs --check", "xargs npx vitest run"]) expect(runs).toContain(cmd);
  });
  it("vitest.yml: 'Vitest unit tests' passes on the lane's success when guide-only, else on the shards'", () => {
    const g = Object.values(v.jobs).find((x) => x.name === "Vitest unit tests")!;
    expect(g.needs).toEqual(["scope", "vitest-shard", "guide-fast-lane"]);
    expect(g.if).toMatch(/always\(\)/);
    const run = (g.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/if \[ "\$GUIDE_ONLY" = "true" \]; then\s+test "\$LANE" = "success"\s+else\s+test "\$SHARDS" = "success"\s+fi/);
  });
  for (const f of ["e2e-happy-path.yml", "mobile-viewports.yml"]) {
    it(`${f}: every expensive step also needs guide_only != 'true', and the scope step runs only on a PR`, () => {
      const steps = Object.values(wf(f).jobs)[0].steps ?? [];
      const scope = steps.find((s) => s.id === "guide")!;
      expect(scope.if).toBe("github.event_name == 'pull_request'");
      expect(scope.run).toContain("node scripts/ci/guide-only.mjs");
      const gated = steps.filter((s) => /steps\.filter\.outputs\.ui/.test(s.if ?? ""));
      expect(gated.length).toBeGreaterThan(3);
      for (const s of gated) expect(s.if, s.name).toBe("github.event_name != 'pull_request' || (steps.filter.outputs.ui == 'true' && steps.guide.outputs.guide_only != 'true')");
    });
  }
  it("lighthouse.yml (not required) negates exactly the lane's src/ and public/ globs", () => {
    const paths = wf("lighthouse.yml").on.pull_request.paths ?? [];
    const neg = paths.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
    expect(neg).toEqual(GUIDE_CONTENT.filter((g) => /^(src|public)\//.test(g)));
  });
});
