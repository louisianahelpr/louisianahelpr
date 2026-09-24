#!/usr/bin/env node
/**
 * Loading-state inventory — derived from the world, not from a list.
 *
 * Owner, 2026-09-19: "you also need to check loading states thoroughly bc a lot
 * of them jump and are not consistent with their info."
 *
 * Two defect classes live in that sentence and this file feeds the guard for
 * both:
 *   JUMP  — the placeholder is a different SIZE from the content that replaces
 *           it, so the page moves under the reader.
 *   SHAPE — the placeholder is a different SHAPE from that content (three grey
 *           bars where a card with an avatar, a title and two chips arrives).
 *
 * The inventory is scanned out of `src/`, never hand-listed: a list that is
 * both the input and the oracle cannot fail for a missing member
 * (memory: registries-checked-against-themselves). Comments and string
 * literals are stripped before any pattern runs — guards satisfied by a
 * comment have bitten repeatedly.
 *
 * Usage:
 *   node scripts/loading-state-inventory.mjs            # human table
 *   node scripts/loading-state-inventory.mjs --json     # machine inventory
 *   node scripts/loading-state-inventory.mjs --by-file  # grouped counts
 *
 * Exit 1 when the scan finds fewer sites than the floor below — a scan broken
 * by a refactor must fail LOUDLY, never pass vacuously on an empty inventory.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/**
 * Floors. Each is a deliberate undercount of what the scan finds today, so
 * normal churn does not trip it but a pattern that stops matching does.
 * Raising a floor is fine; silently lowering one is the failure this guards.
 */
export const FLOORS = {
  skeletonElement: 90,
  skeletonComponent: 20,
  suspenseFallback: 30,
  pulse: 25,
  spinner: 89, // 90 until 2026-09-24: AdminBroadcasts (deleted, owner MQ19) held one
  loadingBranch: 100,
  files: 90,
};

/** Strip block comments, line comments and string/template literals. */
export function stripNonCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      const chunk = src.slice(i, end === -1 ? n : end + 2);
      // Keep newlines so line numbers survive.
      out += chunk.replace(/[^\n]/g, " ");
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "/" && c2 === "/") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = n;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      let body = "";
      while (j < n) {
        if (src[j] === "\\") { body += "  "; j += 2; continue; }
        if (src[j] === quote) break;
        // Template expressions are real code — keep them.
        if (quote === "`" && src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            k++;
          }
          body += src.slice(j, k);
          j = k;
          continue;
        }
        body += src[j] === "\n" ? "\n" : " ";
        j++;
      }
      // Preserve the quotes so className="animate-pulse" still reads as a
      // string boundary, but blank the contents… EXCEPT class strings, which
      // are the thing we are scanning for. Keep any token we care about.
      const kept = body.replace(/[^\n ]/g, " ");
      out += quote + kept + (j < n ? quote : "");
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Class names live inside string literals, which stripNonCode blanks. So for
 * the class-based patterns we scan a SEPARATE pass that strips only comments
 * (never strings) — a comment can still not satisfy it, which is the rule that
 * matters.
 */
export function stripCommentsOnly(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      const chunk = src.slice(i, end === -1 ? n : end + 2);
      out += chunk.replace(/[^\n]/g, " ");
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "/" && c2 === "/") {
      // Not a comment if it is inside a JSX closing tag or a URL. Cheap guard:
      // treat `://` as not-a-comment.
      if (src[i - 1] === ":") { out += c; i++; continue; }
      let end = src.indexOf("\n", i);
      if (end === -1) end = n;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__snapshots__") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(p);
  }
  return acc;
}

const EXCLUDE = /(^|\/)(test|tests|__tests__)\//;
const EXCLUDE_FILE = /\.(test|spec)\.tsx?$/;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function scanFile(abs) {
  const rel = relative(ROOT, abs);
  if (EXCLUDE.test(rel) || EXCLUDE_FILE.test(rel)) return [];
  const raw = readFileSync(abs, "utf8");
  const code = stripNonCode(raw);
  const noComments = stripCommentsOnly(raw);
  const hits = [];
  const push = (kind, idx, text, detail) =>
    hits.push({ file: rel, line: lineOf(text, idx), kind, detail });

  // 1. <Skeleton .../> elements — the explicit placeholder primitive.
  for (const m of code.matchAll(/<Skeleton\b/g)) push("skeletonElement", m.index, code);

  // 2. Components whose NAME declares them a placeholder.
  const declRe =
    /(?:function|const)\s+([A-Z]\w*(?:Skeleton|Fallback|Loading|Placeholder))\b/g;
  for (const m of noComments.matchAll(declRe)) {
    push("skeletonComponent", m.index, noComments, m[1]);
  }

  // 3. <Suspense fallback={...}> boundaries.
  for (const m of code.matchAll(/<Suspense\b/g)) push("suspenseFallback", m.index, code);

  // 4. animate-pulse — the hand-rolled placeholder.
  for (const m of noComments.matchAll(/animate-pulse/g)) push("pulse", m.index, noComments);

  // 5. Spinners.
  for (const m of noComments.matchAll(/animate-spin/g)) push("spinner", m.index, noComments);

  // 6. Loading branches: a conditional on a pending/loading flag that renders.
  const branchRe =
    /(?:\bif\s*\(\s*!?\s*(is(?:Loading|Pending|Fetching|InitialLoading))\b)|\b(is(?:Loading|Pending|Fetching|InitialLoading)|loading|pending)\b\s*(?:&&|\?)/g;
  for (const m of code.matchAll(branchRe)) push("loadingBranch", m.index, code, m[1] ?? m[2]);

  return hits;
}

export function inventory() {
  const files = walk(SRC);
  const hits = files.flatMap(scanFile);
  return hits;
}

export function counts(hits) {
  const c = Object.fromEntries(Object.keys(FLOORS).map((k) => [k, 0]));
  for (const h of hits) if (h.kind in c) c[h.kind]++;
  c.files = new Set(hits.map((h) => h.file)).size;
  return c;
}

export function checkFloors(c) {
  const bad = [];
  for (const [k, floor] of Object.entries(FLOORS)) {
    if ((c[k] ?? 0) < floor) bad.push(`${k}: found ${c[k] ?? 0}, floor ${floor}`);
  }
  return bad;
}

function main() {
  const hits = inventory();
  const c = counts(hits);
  const bad = checkFloors(c);

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ counts: c, hits }, null, 2) + "\n");
  } else if (process.argv.includes("--by-file")) {
    const byFile = new Map();
    for (const h of hits) {
      if (!byFile.has(h.file)) byFile.set(h.file, {});
      const b = byFile.get(h.file);
      b[h.kind] = (b[h.kind] ?? 0) + 1;
    }
    const rows = [...byFile.entries()].sort(
      (a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0),
    );
    for (const [file, kinds] of rows) {
      console.log(
        String(Object.values(kinds).reduce((x, y) => x + y, 0)).padStart(4),
        file,
        JSON.stringify(kinds),
      );
    }
    console.log(`\n${byFile.size} files, ${hits.length} loading-state sites`);
  } else {
    for (const [k, v] of Object.entries(c)) {
      console.log(`${k.padEnd(20)} ${String(v).padStart(5)}   floor ${FLOORS[k]}`);
    }
    console.log(`\nTOTAL sites: ${hits.length}`);
  }

  if (bad.length) {
    console.error("\nINVENTORY FLOOR BREACHED — the scan is broken, not the app:");
    for (const b of bad) console.error("  " + b);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
