/**
 * Every place under e2e/ that can SKIP a Playwright test, found from source.
 *
 * Shared by two readers that must agree on what a "skip site" is:
 *   - e2e/reporters/skipReporter.ts maps a runtime skip (Playwright records the
 *     file:line of the `test.skip(...)` call on the skip annotation) back to the
 *     site it came from, then to its verdict in e2e/skipAllowlist.ts;
 *   - src/test/e2eSkipsAreJustified.test.ts inventories every site and proves
 *     each one has a verdict, and every verdict still has a site.
 *
 * Pure node (fs + a small tokenizer), no Playwright import, so vitest can load it.
 *
 * What counts as a site (each is where Playwright's annotation.location points):
 *   test.skip( / test.fixme( / test.describe.skip( / test.describe.fixme(
 *   it.skip( / testInfo.skip( / info.skip( / test.info().skip(  (and .fixme)
 *   an alias call `X(` where `const X = … test.describe.skip …` (opt-in sweeps)
 * Comments are blanked first, so a skip mentioned in prose is not a site.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SkipSite {
  /** repo-relative, forward slashes */
  file: string;
  /** 1-based line of the call Playwright reports */
  line: number;
  /** the call text, whitespace-collapsed, capped — what allowlist `match` is tested against */
  text: string;
}

/**
 * Blank out comments (keeping every newline, so line numbers survive) while
 * leaving string and template contents alone — a URL's `//` is not a comment.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        if (q !== "`" && src[i] === "\n") break; // unterminated: stop at EOL
        out += src[i]; i++;
      }
      if (i < n) { out += src[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const DIRECT = /\b(?:(?:test|it)(?:\.describe)?|test\.info\(\)|testInfo|info)\s*\.\s*(?:skip|fixme)\s*\(/g;
const ALIAS = /\bconst\s+(\w+)\s*(?::[^=]+)?=[^;]*\btest\.describe\.skip\b/g;

function callText(code: string, openParen: number, start: number): string {
  let depth = 0;
  let i = openParen;
  for (; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") { depth--; if (depth === 0) break; }
  }
  return code.slice(start, i + 1).replace(/\s+/g, " ").slice(0, 400);
}

function lineOf(code: string, idx: number): number {
  let l = 1;
  for (let i = 0; i < idx; i++) if (code[i] === "\n") l++;
  return l;
}

/** Sites in one file's source. `file` is only used to label the result. */
export function sitesInSource(file: string, src: string): SkipSite[] {
  const code = stripComments(src);
  const sites: SkipSite[] = [];
  for (const m of code.matchAll(DIRECT)) {
    const open = m.index! + m[0].length - 1;
    sites.push({ file, line: lineOf(code, m.index!), text: callText(code, open, m.index!) });
  }
  for (const a of code.matchAll(ALIAS)) {
    const name = a[1];
    const call = new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g");
    for (const m of code.matchAll(call)) {
      const open = m.index! + m[0].length - 1;
      sites.push({ file, line: lineOf(code, m.index!), text: callText(code, open, m.index!) });
    }
  }
  return sites.sort((x, y) => x.line - y.line);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

/** Files that are infrastructure for skips, not places that skip. */
const NOT_SITES = new Set(["e2e/skipSites.ts", "e2e/skipAllowlist.ts", "e2e/reporters/skipReporter.ts"]);

export function toRepoPath(repoRoot: string, abs: string): string {
  return relative(repoRoot, abs).split(sep).join("/");
}

/** Every skip site under <repoRoot>/e2e. */
export function allSkipSites(repoRoot: string): SkipSite[] {
  const out: SkipSite[] = [];
  for (const abs of walk(join(repoRoot, "e2e"))) {
    const file = toRepoPath(repoRoot, abs);
    if (NOT_SITES.has(file)) continue;
    out.push(...sitesInSource(file, readFileSync(abs, "utf8")));
  }
  return out;
}
