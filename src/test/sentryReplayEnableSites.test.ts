/**
 * Q386: every place a Sentry Session Replay can be constructed, enabled,
 * sampled or flushed, inventoried from the tree, and the configured rates.
 *
 * Replays kept reaching the 50/month quota after Q275 (no replay in a
 * WebDriver browser) and Q379 (no replay for an is_seed profile). A new
 * `replayIntegration()` in some other module, a Sentry loader <script> in
 * index.html, a second `init()` carrying its own replay rates, or a rate
 * quietly raised would each send replays that none of those gates see. So:
 *
 *   1. SITES. Every source file under src/ (plus index.html and public/) is
 *      scanned with comments blanked; the per-file count of each replay hook
 *      must EQUAL the table below. A new site fails, and so does a site that
 *      disappears (then the table is stale and the gates below read nothing).
 *   2. RATES. The init config samples 10% of sessions and 100% of error
 *      sessions, and both are 0 unless `recordReplays`, which requires a PROD
 *      build, no WebDriver (Q275) and not a locally served build (Q386).
 *   3. The replay integration is only ever added inside `if (recordReplays)`
 *      and skipped once a test profile blocked it (Q379).
 *
 * Old INSTALLED native bundles are outside any source check: their JS is
 * baked into the .ipa/.apk and keeps whatever rates it shipped with until a
 * new build is installed (Q387).
 *
 * @mutate src/lib/sentry.ts | replaysSessionSampleRate: recordReplays ? 0.1 : 0, | replaysSessionSampleRate: 0.1,
 * @mutate src/lib/sentry.ts | replaysOnErrorSampleRate: recordReplays ? 1.0 : 0, | replaysOnErrorSampleRate: recordReplays ? 0.5 : 0,
 * @mutate src/lib/sentry.ts | const recordReplays = import.meta.env.PROD && !automated && !localBuild; | const recordReplays = import.meta.env.PROD && !localBuild;
 * @mutate src/lib/errorLogger.ts | async function fanOutToObservability(err: unknown | void import("@sentry/react").then((m) => m.addIntegration(m.replayIntegration())); async function fanOutToObservability(err: unknown
 * @mutate src/lib/sentry.ts | void getReplay()?.stop({ flush: false }) | void Promise.resolve()
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");

/** Each hook that can construct, enable, sample, start or flush a replay. */
const HOOKS: Record<string, RegExp> = {
  replayIntegration: /\breplay(?:Canvas)?Integration\s*\(/g,
  addIntegration: /\baddIntegration\s*\(/g,
  sessionRate: /\breplaysSessionSampleRate\b/g,
  onErrorRate: /\breplaysOnErrorSampleRate\b/g,
  getReplay: /\bgetReplay\s*\(/g,
  // Any Sentry package, static or dynamic: a second init() or a replay
  // package would arrive this way.
  sentryImport: /(?:from\s*|import\s*\(\s*)["']@sentry(?:-internal)?\/[^"']+["']/g,
  // The hosted loader script can enable replay from Sentry's dashboard.
  loaderScript: /sentry-cdn\.com|js\.sentry-cdn|browser\.sentry-cdn/g,
};

// Two-way: the exact per-file counts. Any file not listed must count 0.
const REPLAY_SITES: Record<string, Record<string, number>> = {
  "src/lib/sentry.ts": {
    replayIntegration: 1,
    addIntegration: 1,
    sessionRate: 1,
    onErrorRate: 1,
    getReplay: 1,
    sentryImport: 2,
  },
  // captureMessage on the client initSentry() built: an error-level event, so
  // it can flush a buffered error-session replay, under the same rates. It
  // constructs and enables nothing (a no-op before init).
  "src/lib/validateResult.ts": { sentryImport: 1 },
};

function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p, keep);
    return keep(n) ? [p] : [];
  });
}

function inventory(): { scanned: number; sites: Record<string, Record<string, number>> } {
  const files = [
    ...walk(join(REPO, "src"), (n) => /\.(ts|tsx|js|jsx|mjs)$/.test(n) && !/\.test\.tsx?$/.test(n)),
    ...walk(join(REPO, "public"), (n) => /\.(js|html)$/.test(n)),
    join(REPO, "index.html"),
  ];
  const sites: Record<string, Record<string, number>> = {};
  for (const abs of files) {
    const rel = relative(REPO, abs);
    const raw = readFileSync(abs, "utf8");
    const code = /\.html$/.test(rel) ? raw.replace(/<!--[\s\S]*?-->/g, " ") : blankComments(raw);
    for (const [hook, re] of Object.entries(HOOKS)) {
      const n = code.match(re)?.length ?? 0;
      if (n > 0) (sites[rel] ??= {})[hook] = n;
    }
  }
  return { scanned: files.length, sites };
}

const SENTRY = blankComments(readFileSync(join(REPO, "src/lib/sentry.ts"), "utf8"));

describe("Session Replay: every enable site and the configured rates (Q386)", () => {
  it("the replay hooks live exactly where the table says, and nowhere else", () => {
    const { scanned, sites } = inventory();
    expect(scanned).toBeGreaterThan(500);
    expect(sites).toEqual(REPLAY_SITES);
  });

  it("sessions are sampled at 10% and error sessions at 100%, both 0 unless recordReplays", () => {
    const session = /replaysSessionSampleRate:\s*recordReplays\s*\?\s*([\d.]+)\s*:\s*0\s*,/.exec(SENTRY);
    const onError = /replaysOnErrorSampleRate:\s*recordReplays\s*\?\s*([\d.]+)\s*:\s*0\s*,/.exec(SENTRY);
    expect(session, "replaysSessionSampleRate must be `recordReplays ? <rate> : 0`").not.toBeNull();
    expect(onError, "replaysOnErrorSampleRate must be `recordReplays ? <rate> : 0`").not.toBeNull();
    expect(Number(session![1])).toBe(0.1);
    expect(Number(onError![1])).toBe(1);
  });

  it("recordReplays requires a PROD build, no WebDriver (Q275) and not a locally served build (Q386)", () => {
    const decl = /const recordReplays\s*=\s*([^;]+);/.exec(SENTRY);
    expect(decl).not.toBeNull();
    const terms = decl![1].split("&&").map((t) => t.trim()).sort();
    expect(terms).toEqual(["!automated", "!localBuild", "import.meta.env.PROD"].sort());
    expect(SENTRY).toMatch(/const automated\s*=\s*isAutomatedBrowser\(\);/);
    expect(SENTRY).toMatch(/const localBuild\s*=\s*isLocalBuildHost\(window\.location\);/);
  });

  it("the integration is added only inside `if (recordReplays)`, skipped once a test profile blocked it (Q379)", () => {
    const gate = SENTRY.indexOf("if (recordReplays) {");
    const add = SENTRY.indexOf("addIntegration(");
    const block = SENTRY.indexOf("if (replayBlocked) return;");
    expect(gate).toBeGreaterThan(0);
    expect(add).toBeGreaterThan(gate);
    expect(block).toBeGreaterThan(gate);
    expect(block).toBeLessThan(add);
    // A test profile's running replay is stopped WITHOUT sending its segment.
    expect(SENTRY).toContain("void getReplay()?.stop({ flush: false })");
  });
});
