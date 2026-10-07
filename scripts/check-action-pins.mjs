#!/usr/bin/env node
/**
 * Q1354: every pinned GitHub Action SHA is the commit its `# vX.Y.Z` comment
 * names.
 *
 * src/test/actionsPinnedToSha.test.ts keeps every non-local `uses:` pinned to
 * a 40-hex SHA with the version as a trailing comment, but nothing checked the
 * SHA IS that tag's commit: a typo'd, orphaned or tampered SHA passed the pin
 * guard. This resolves each (repo, tag) through the GitHub API
 * (git/ref/tags/<tag>, following an annotated tag object to its commit) and
 * fails on any pin whose SHA differs, or whose tag no longer resolves.
 *
 * Runs nightly in .github/workflows/code-scanning-alerts.yml (job action-pins;
 * a red run files a nightly-red issue). Needs GH_TOKEN for `gh api`.
 *
 *   node scripts/check-action-pins.mjs                    # check every pin
 *   node scripts/check-action-pins.mjs --inject-mismatch  # flips one pinned SHA in memory: must exit 1
 *
 * Pure parts (pinsFromText, verifyPins) are exported for
 * src/test/checkActionPins.test.ts.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const USES = /^\s*-?\s*uses:\s*([^\s#@]+)@([0-9a-f]{40})\s*#\s*(\S+)\s*$/;
const ANY_USES = /^\s*-?\s*uses:\s*(\S+)/;

/** Every pinned `uses:` in one file: { file, line, action, repo, sha, tag }. Unparseable non-local pins come back with problem set. */
export function pinsFromText(file, text) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    const any = ANY_USES.exec(raw);
    if (!any) return;
    const ref = any[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) return;
    const m = USES.exec(raw);
    if (!m) {
      out.push({ file, line: i + 1, action: ref, problem: "not `<action>@<40-hex> # <tag>`" });
      return;
    }
    const [, action, sha, tag] = m;
    const repo = action.split("/").slice(0, 2).join("/");
    out.push({ file, line: i + 1, action, repo, sha, tag });
  });
  return out;
}

/**
 * resolveTag(repo, tag) -> commit sha, or throws. Returns the failures, one
 * string per bad pin; resolves each (repo, tag) once.
 */
export async function verifyPins(pins, resolveTag) {
  const failures = [];
  const cache = new Map();
  for (const p of pins) {
    if (p.problem) {
      failures.push(`${p.file}:${p.line} ${p.action}: ${p.problem}`);
      continue;
    }
    const key = `${p.repo}@${p.tag}`;
    if (!cache.has(key)) {
      try {
        cache.set(key, { sha: await resolveTag(p.repo, p.tag) });
      } catch (e) {
        cache.set(key, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    const got = cache.get(key);
    if (got.error) failures.push(`${p.file}:${p.line} ${p.action}: tag ${p.tag} did not resolve (${got.error})`);
    else if (got.sha !== p.sha) failures.push(`${p.file}:${p.line} ${p.action}: pinned ${p.sha} but ${p.tag} is ${got.sha}`);
  }
  return failures;
}

function ghJson(path) {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

/** Tag -> commit through the GitHub API, following annotated tag objects (at most 5 hops). */
export function ghResolveTag(repo, tag) {
  let obj = ghJson(`repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`).object;
  for (let hop = 0; obj && obj.type === "tag" && hop < 5; hop++) {
    obj = ghJson(`repos/${repo}/git/tags/${obj.sha}`).object;
  }
  if (!obj || obj.type !== "commit") throw new Error(`ref resolved to ${obj?.type ?? "nothing"}, not a commit`);
  return obj.sha;
}

function walkYaml(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkYaml(p, out);
    else if (/\.ya?ml$/.test(name)) out.push(p);
  }
  return out;
}

export function repoPins(root) {
  const files = [...walkYaml(join(root, ".github", "workflows")), ...walkYaml(join(root, ".github", "actions"))];
  return files.flatMap((f) => pinsFromText(relative(root, f), readFileSync(f, "utf8")));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const pins = repoPins(root);
  if (pins.length < 50) {
    console.error(`::error::only ${pins.length} pinned uses: lines found under .github; the parser is broken or the tree is wrong`);
    process.exit(1);
  }
  if (process.argv.includes("--inject-mismatch")) {
    const first = pins.find((p) => p.sha);
    first.sha = first.sha.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    console.log(`--inject-mismatch: flipped ${first.file}:${first.line} to ${first.sha} (this run must fail)`);
  }
  const distinct = new Set(pins.filter((p) => p.sha).map((p) => `${p.repo}@${p.tag}`)).size;
  const failures = await verifyPins(pins, ghResolveTag);
  if (failures.length) {
    for (const f of failures) console.error(`::error::${f}`);
    console.error(`${failures.length} bad pin(s) of ${pins.length} uses: lines (${distinct} distinct tags)`);
    process.exit(1);
  }
  console.log(`OK: ${pins.length} pinned uses: lines, ${distinct} distinct tags, every SHA is its tag's commit`);
}
