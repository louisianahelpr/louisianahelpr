/**
 * Every script that can write prod refuses to run from a stale checkout
 * (Q?stale-shared-checkout-writes, 2026-10-17).
 *
 * At 09:13:20Z a node script run from the shared ~/louisianahelpr checkout
 * (main of 2026-09-24) wrote an old Terms version over two shared test
 * accounts, because its copy of acceptCurrentTerms + src/lib/consent.ts was a
 * month old. scripts/lib/freshCheckout.mjs refuses such a run; this guard
 * proves every prod writer actually calls it.
 *
 * The inventory is built from source with comments blanked: every file under
 * scripts/ (not a lib/ module, not a .d.mts) and e2e/ whose CODE reads
 * SUPABASE_SERVICE_ROLE_KEY, imports adminSession / opsAlertLedger / prodEnv /
 * acceptCurrentTerms, or names test-signin-link. Both ways:
 *   - a script in the inventory that does not call assertFreshCheckout fails;
 *   - a script that calls it but no longer matches the inventory fails (the
 *     wired list never goes stale);
 *   - the e2e inventory equals PROD_WRITING_E2E in playwright.config.ts, whose
 *     single call guards every spec.
 */
// @mutate scripts/lib/freshCheckout.mjs | if (behind > MAX_BEHIND) { | if (behind > MAX_BEHIND * 1000) {
// @mutate scripts/lib/freshCheckout.mjs | if (changedOnMain.length) { | if (false) {
// @mutate scripts/lib/freshCheckout.mjs | if (p && !relative(top, p).startsWith("..") && !seen.has(p)) stack.push(p); | if (false) stack.push(p);
// @mutate scripts/test-signin-link.mjs | assertFreshCheckout(import.meta.url, { also: ["src/lib/consent.ts"] }); | void import.meta.url;
// @mutate playwright.config.ts |   "e2e/prodSessions.ts", |   "e2e/prodSessionsX.ts",
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { blankComments } from "./helpers/blankNonCode";
import { assertFreshCheckout, freshVerdict, localImportClosure, MAX_BEHIND } from "../../scripts/lib/freshCheckout.mjs";

const ROOT = join(__dirname, "..", "..");

const PROD_MARKERS = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /adminSession(\.mjs)?["']/,
  /opsAlertLedger(\.mjs)?["']/,
  /prodEnv(\.mjs)?["']/,
  /acceptCurrentTerms(\.mjs)?["']/,
  /test-signin-link/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs|ts|mts)$/.test(name) && !name.endsWith(".d.mts")) out.push(p);
  }
  return out;
}

const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));
const FILES = [...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "e2e"))].map((f) => relative(ROOT, f)).sort();
const INVENTORY = FILES.filter((rel) => PROD_MARKERS.some((re) => re.test(code(rel))));
const isLib = (rel: string) => rel.split("/").includes("lib");
const SCRIPT_WRITERS = INVENTORY.filter((rel) => rel.startsWith("scripts/") && !isLib(rel));
const E2E_WRITERS = INVENTORY.filter((rel) => rel.startsWith("e2e/"));

const CALL = /\bassertFreshCheckout\(\s*import\.meta\.url\b/;
const IMPORT = /import\s*\{\s*assertFreshCheckout\s*\}\s*from\s*["'](?:\.\.?\/)+(?:lib\/)?freshCheckout\.mjs["']/;
const WIRED = FILES.filter((rel) => rel.startsWith("scripts/") && rel !== "scripts/lib/freshCheckout.mjs" && CALL.test(code(rel)));

describe("prod writers refuse a stale checkout: inventory == wired, both ways", () => {
  it("the inventory is real (floors)", () => {
    expect(SCRIPT_WRITERS.length).toBeGreaterThan(60);
    expect(E2E_WRITERS.length).toBeGreaterThan(10);
    expect(SCRIPT_WRITERS).toContain("scripts/test-signin-link.mjs");
  });

  it("every prod-writing script calls assertFreshCheckout(import.meta.url) and imports it", () => {
    const missing = SCRIPT_WRITERS.filter((rel) => !CALL.test(code(rel)) || !IMPORT.test(code(rel)));
    expect(missing, "add `import { assertFreshCheckout } from \"./lib/freshCheckout.mjs\"; assertFreshCheckout(import.meta.url);` after the imports").toEqual([]);
  });

  it("every wired script is still a prod writer (the wired list cannot go stale)", () => {
    expect(WIRED.filter((rel) => !SCRIPT_WRITERS.includes(rel))).toEqual([]);
    expect(WIRED.length).toBe(SCRIPT_WRITERS.length);
  });

  it("test-signin-link also compares src/lib/consent.ts, the Terms version it writes", () => {
    expect(code("scripts/test-signin-link.mjs")).toMatch(/assertFreshCheckout\(import\.meta\.url, \{ also: \["src\/lib\/consent\.ts"\] \}\)/);
  });

  it("playwright.config.ts guards every spec, and PROD_WRITING_E2E is exactly the e2e inventory", () => {
    const cfg = blankComments(readFileSync(join(ROOT, "playwright.config.ts"), "utf8"));
    expect(cfg).toMatch(/assertFreshCheckout\(import\.meta\.url, \{ entryOnly: false, also: PROD_WRITING_E2E \}\)/);
    const block = cfg.match(/const PROD_WRITING_E2E = \[([\s\S]*?)\];/);
    expect(block, "PROD_WRITING_E2E array").not.toBeNull();
    const listed = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(E2E_WRITERS);
  });
});

describe("freshVerdict", () => {
  const base = { behind: 0, changedOnMain: [] as string[], ci: false, override: "" };
  it("passes a current checkout", () => expect(freshVerdict(base).ok).toBe(true));
  it("refuses more than MAX_BEHIND behind, allows exactly MAX_BEHIND", () => {
    expect(MAX_BEHIND).toBe(400);
    expect(freshVerdict({ ...base, behind: MAX_BEHIND + 1 }).ok).toBe(false);
    expect(freshVerdict({ ...base, behind: MAX_BEHIND }).ok).toBe(true);
  });
  it("refuses when main changed a file the run executes", () => {
    const v = freshVerdict({ ...base, changedOnMain: ["scripts/lib/acceptCurrentTerms.mjs"] });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("scripts/lib/acceptCurrentTerms.mjs");
  });
  it("refuses when it cannot compare (no origin/main, not a checkout)", () => expect(freshVerdict({ ...base, behind: null }).ok).toBe(false));
  it("CI and an explicit override pass", () => {
    expect(freshVerdict({ ...base, behind: 9999, ci: true }).ok).toBe(true);
    expect(freshVerdict({ ...base, behind: 9999, override: "measured why" }).ok).toBe(true);
  });
});

describe("localImportClosure", () => {
  it("follows test-signin-link's relative imports to the Terms writer", () => {
    const got = localImportClosure(join(ROOT, "scripts/test-signin-link.mjs"), ROOT).map((p) => relative(ROOT, p));
    expect(got).toContain("scripts/lib/acceptCurrentTerms.mjs");
    expect(got).toContain("scripts/lib/adminSession.mjs");
  });
});

// A throwaway repo: HEAD at commit A, origin/main ahead of it.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
function g(dir: string, args: string[], input?: string) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    env: CLEAN_ENV,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "fresh-checkout-"));
  g(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "w.mjs"), 'import { x } from "./dep.mjs";\nexport const y = x;\n');
  writeFileSync(join(dir, "dep.mjs"), "export const x = 1;\n");
  writeFileSync(join(dir, "data.txt"), "v1\n");
  g(dir, ["add", "-A"]);
  g(dir, ["commit", "-q", "-m", "A"]);
  return { dir, a: g(dir, ["rev-parse", "HEAD"]) };
}
const url = (dir: string) => pathToFileURL(join(dir, "w.mjs")).href;
const ENV = (extra: Record<string, string> = {}) => ({ ...extra }) as NodeJS.ProcessEnv;

describe("assertFreshCheckout on a real git checkout", () => {
  it("passes when origin/main is HEAD, refuses when main changed an IMPORTED file, names it", () => {
    const { dir, a } = repo();
    try {
      g(dir, ["update-ref", "refs/remotes/origin/main", a]);
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), entryOnly: false })).not.toThrow();
      writeFileSync(join(dir, "dep.mjs"), "export const x = 2;\n");
      g(dir, ["commit", "-q", "-am", "B"]);
      g(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      g(dir, ["checkout", "-q", "--detach", a]);
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), entryOnly: false })).toThrow(/dep\.mjs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unrelated main commit passes; a change to an `also` file refuses", () => {
    const { dir, a } = repo();
    try {
      writeFileSync(join(dir, "other.txt"), "x\n");
      g(dir, ["add", "-A"]);
      g(dir, ["commit", "-q", "-m", "B"]);
      g(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      g(dir, ["checkout", "-q", "--detach", a]);
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), entryOnly: false })).not.toThrow();
      g(dir, ["checkout", "-q", "main"]);
      writeFileSync(join(dir, "data.txt"), "v2\n");
      g(dir, ["commit", "-q", "-am", "C"]);
      g(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      g(dir, ["checkout", "-q", "--detach", a]);
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), entryOnly: false })).not.toThrow();
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), entryOnly: false, also: ["data.txt"] })).toThrow(/data\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses MAX_BEHIND+1 commits behind even when nothing it runs changed", () => {
    const { dir, a } = repo();
    try {
      // One fast-import process writes empty commits on top of A, one more than the limit.
      let stream = "";
      for (let i = 0; i < MAX_BEHIND + 1; i++) {
        stream += `commit refs/heads/ahead\ncommitter t <t@example.invalid> ${1700000000 + i} +0000\ndata 1\nc\n${i === 0 ? `from ${a}\n` : ""}\n`;
      }
      g(dir, ["fast-import", "--quiet"], stream);
      g(dir, ["update-ref", "refs/remotes/origin/main", "refs/heads/ahead"]);
      expect(g(dir, ["rev-list", "--count", "HEAD..origin/main"])).toBe(String(MAX_BEHIND + 1));
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), entryOnly: false })).toThrow(/401 commits behind/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entryOnly: checks only when the script is argv[1]; CI, vitest and a logged override skip", () => {
    const { dir, a } = repo();
    const logDir = mkdtempSync(join(tmpdir(), "fresh-log-"));
    try {
      writeFileSync(join(dir, "dep.mjs"), "export const x = 3;\n");
      g(dir, ["commit", "-q", "-am", "B"]);
      g(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      g(dir, ["checkout", "-q", "--detach", a]);
      const script = join(dir, "w.mjs");
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), argv: ["node", join(dir, "other.mjs")] })).not.toThrow();
      expect(() => assertFreshCheckout(url(dir), { env: ENV(), argv: ["node", script] })).toThrow(/dep\.mjs/);
      expect(() => assertFreshCheckout(url(dir), { env: ENV({ GITHUB_ACTIONS: "true" }), argv: ["node", script] })).not.toThrow();
      expect(() => assertFreshCheckout(url(dir), { env: ENV({ VITEST: "true" }), argv: ["node", script] })).not.toThrow();
      expect(() =>
        assertFreshCheckout(url(dir), { env: ENV({ LH_STALE_CHECKOUT_OK: "test reason", LH_HYGIENE_DIR: logDir }), argv: ["node", script] }),
      ).not.toThrow();
      expect(readFileSync(join(logDir, "stale-checkout-runs.log"), "utf8")).toContain("test reason");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("refuses outside a git checkout (cannot compare)", () => {
    const dir = mkdtempSync(join(tmpdir(), "fresh-nogit-"));
    try {
      mkdirSync(join(dir, "s"));
      writeFileSync(join(dir, "s", "w.mjs"), "export {};\n");
      expect(existsSync(join(dir, ".git"))).toBe(false);
      expect(() => assertFreshCheckout(pathToFileURL(join(dir, "s", "w.mjs")).href, { env: ENV(), entryOnly: false })).toThrow(/cannot compare/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
