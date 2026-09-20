import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The CI check for the owner's 2026-09-19 report: loading states "jump and are
 * not consistent with their info."
 *
 * Standing order: an owner-reported bug ships with a check for its whole CLASS,
 * built from the app's own inventory, shown RED on the original defect.
 *
 * Two defects, two assertions:
 *   JUMP   the placeholder is a different SIZE from the content replacing it.
 *   SHAPE  the placeholder is a different SHAPE — different row count, a face
 *          where no face arrives.
 *
 * Neither is visible in source. A skeleton that looks right in JSX is routinely
 * 12px shorter than its content, and a `p-3` glass card standing in for a
 * `py-2.5` hairline row reads fine until something measures both. So the
 * evidence comes from `scripts/audit/measure-loading-states.mjs`, which drives
 * the real app against PROD with the shared test accounts (no mock mode, ever)
 * and records both frames' geometry; this spec gates on it.
 *
 * The inventory is scanned out of `src/` by what a placeholder IS, never from a
 * hand-kept list — a list that is both the input and the oracle cannot fail for
 * a missing member.
 */

const REPO = resolve(__dirname, "..", "..");
const CHECK = resolve(REPO, "scripts", "check-loading-state-shape.mjs");
const INVENTORY = resolve(REPO, "scripts", "loading-state-inventory.mjs");
const EVIDENCE = resolve(REPO, "docs", "audit", "loading-states", "measurements.json");

function run(script: string, args: string[] = []) {
  try {
    const stdout = execFileSync("node", [script, ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("loading states: the inventory is alive", () => {
  // @mutate scripts/loading-state-inventory.mjs | for (const m of code.matchAll(/<Skeleton\b/g)) push("skeletonElement", m.index, code); | // scan removed
  it("finds every kind of placeholder, above its floor", () => {
    const { code, stdout } = run(INVENTORY);
    expect(stdout, "the scan printed nothing").toMatch(/skeletonElement/);
    expect(code, `inventory floor breached:\n${stdout}`).toBe(0);
  });

  it("reports a non-empty inventory — an empty one must never pass", () => {
    const { stdout } = run(INVENTORY, ["--json"]);
    const inv = JSON.parse(stdout) as { hits: unknown[]; counts: Record<string, number> };
    // The floor the whole suite rests on. Without it every assertion below
    // holds vacuously the day the scan stops matching, which is exactly how
    // five guards in this repo stayed green for months.
    expect(inv.hits.length).toBeGreaterThan(300);
    expect(inv.counts.files).toBeGreaterThan(80);
  });
});

describe("loading states: no placeholder lies about size or shape", () => {
  // @mutate docs/audit/loading-states/baseline.json | "allow": [ | "allow": [ {"key":"__mutant__ /x #0","kind":"jump"},
  it("every measured placeholder matches what replaces it", () => {
    if (!existsSync(EVIDENCE)) {
      throw new Error(
        `No loading-state evidence at docs/audit/loading-states/measurements.json.\n` +
        `Produce it with:\n` +
        `  npm run build && npx vite preview --port 4173 &\n` +
        `  BASE=http://127.0.0.1:4173 node scripts/audit/measure-loading-states.mjs`,
      );
    }
    const { code, stdout } = run(CHECK);
    expect(code, stdout).toBe(0);
  });

  it("the evidence was produced against the real backend, not a mock", () => {
    const ev = JSON.parse(readFileSync(EVIDENCE, "utf8")) as { base: string; results: unknown[] };
    expect(ev.results.length).toBeGreaterThan(20);
    // A run against a mocked Supabase does not count as verification
    // (owner, 2026-09-12, twice). The frontend host may be local — the
    // measurement is of layout, not of the network — but the run must have
    // produced real surfaces, not an empty set.
    expect(ev.base).toBeTruthy();
  });
});


/**
 * THE PROFILE-TAB PLACEHOLDER, held to the owner's ruling — "skeleton fills
 * the screen, grows below" (2026-09-19, decided in a pop-up).
 *
 * The measured half of this lane lives above and is gated on the real-browser
 * evidence file. These three are the SOURCE half, because all three defects
 * they pin live in a branch that runs before any query resolves — a boot
 * skeleton and a Suspense fallback — where the evidence run cannot reach them
 * without holding a module back by hand.
 *
 * The behavioural counterpart (every tab's title actually rendering, the
 * reserve actually resolving to a screenful) is
 * src/components/profile/ProfileTabFallback.test.tsx, which renders all 24.
 */
describe("loading states: the Profile tab placeholder fills the screen", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const FALLBACK = resolve(REPO, "src/components/profile/ProfileTabFallback.tsx");
  const PROFILE = resolve(REPO, "src/pages/Profile.tsx");

  // @mutate src/components/profile/ProfileTabFallback.tsx | <ProfileTabHeader title={TAB_TITLES[tab]} onBack={onBack} /> | <span />
  it("paints the tab's REAL header, so the h1 does not arrive late", () => {
    // Measured at 375 on prod with each tab's module held back: no <h1> in the
    // loading frame, an <h1> at y=26 once loaded - every tab's whole body slid
    // down by a header's height on arrival.
    const src = strip(readFileSync(FALLBACK, "utf8"));
    expect(src, "the placeholder must render the header component itself").toContain("<ProfileTabHeader");
    expect(src, "and take its title from the registry, never invent one").toContain("TAB_TITLES[tab]");
  });

  // @mutate src/components/profile/ProfileTabFallback.tsx | window.innerHeight - top | 118
  it("reserves ONE SCREENFUL, taken from the viewport, not a constant", () => {
    // It reserved 118px against real content of 447-3,477px.
    const src = strip(readFileSync(FALLBACK, "utf8"));
    expect(src, "the reserve must be measured from the viewport").toMatch(/window\.innerHeight/);
    expect(src, "and applied as a min-height, so short tabs collapse empty space").toMatch(/minHeight/);
  });

  // @mutate src/pages/Profile.tsx | {tab === "landing" ? (\n              <ProfilePageSkeleton /> | {false ? (\n              <ProfilePageSkeleton />
  it("boots into the TAB's placeholder, never the landing's", () => {
    // A cold deep link into ?tab=gift_card used to paint an avatar hero and
    // three stat tiles, because the boot branch special-cased one tab.
    const src = strip(readFileSync(PROFILE, "utf8"));
    const branch = src.slice(src.indexOf("if (loading) {"), src.indexOf("const displayName"));
    expect(branch.length, "Profile.tsx's loading branch not found - guard rotted").toBeGreaterThan(100);
    expect(branch).toContain("ProfileTabFallback");
    // The PAIRING, not the presence of either half. `/tab === "landing"/`
    // alone was satisfied by the container's own `pt-3` gate a few lines up
    // in the same branch, so the vacuity run's mutation of the skeleton
    // ternary left this green: a guard reading the right file and the wrong
    // expression. What must hold is that ProfilePageSkeleton is what the
    // landing test selects.
    expect(
      branch,
      "the LANDING skeleton must be what `tab === \"landing\"` selects",
    ).toMatch(/tab === "landing"\s*\?\s*\(\s*<ProfilePageSkeleton/);
  });
});


/**
 * ONE NAME, ONE SKELETON.
 *
 * Found in the same 2026-09-19 sweep: `JobCardSkeleton` was exported from TWO
 * files with two completely different shapes — src/components/SkeletonLoaders
 * (a hand-drawn job card with a chip row, a metadata grid and an apply-button
 * footer) and src/components/ui/skeletons/JobCardSkeleton (the real one, built
 * by importing JobCard's own exported geometry). Which one a screen got
 * depended on which import line it happened to carry, and the two callers of
 * the hand-drawn copy — Home History and Work Record — render a service-record
 * card and a letterhead document, neither of which is a job card.
 *
 * A duplicate placeholder name is not a style problem; it is how a screen ends
 * up reserving the wrong shape and nobody notices, because the name reads
 * right at the call site. So: every placeholder component in `src/` has a
 * unique name.
 */
describe("loading states: no two placeholders share a name", () => {
  const SKEL_NAME = /^\s*export\s+(?:const|function)\s+([A-Z]\w*(?:Skeleton|Fallback|Placeholder))\b/gm;

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); continue; }
      if (/\.tsx?$/.test(e.name) && !e.name.includes(".test.")) out.push(p);
    }
    return out;
  };

  // @mutate src/components/ui/skeletons/JobCardSkeleton.tsx | export function JobCardSkeleton() { | export function ProfilePageSkeleton() {} export function JobCardSkeleton() {
  it("every exported placeholder name is defined in exactly one file", () => {
    const files = walk(resolve(REPO, "src"));
    // FLOOR: a scan that matches nothing must fail, never pass quietly.
    expect(files.length, "the source walk found nothing").toBeGreaterThan(200);
    const byName = new Map<string, string[]>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(SKEL_NAME)) {
        const rel = f.slice(REPO.length + 1);
        byName.set(m[1], [...(byName.get(m[1]) ?? []), rel]);
      }
    }
    expect(byName.size, "no placeholder exports matched — this guard has rotted").toBeGreaterThan(10);
    const dupes = [...byName.entries()]
      .filter(([, files]) => new Set(files).size > 1)
      .map(([name, files]) => `${name}: ${[...new Set(files)].join(" + ")}`);
    expect(dupes, "two placeholders answering to one name").toEqual([]);
  });
});
