#!/usr/bin/env node
/**
 * Every pinned GitHub Action SHA is the commit its `# vX.Y.Z` comment names
 * (docs/OPEN.md Q1354; nightly, .github/workflows/action-pins.yml).
 *
 * src/test/actionsPinnedToSha.test.ts proves each `uses:` is `<ref>@<40-hex>`
 * with a version comment, but not that the SHA IS that version: a typo'd, an
 * orphaned or a fork's commit passes it, and Dependabot reads the comment to
 * decide what to bump. This resolves each (action repo, tag) pair with
 * `git ls-remote` (public repos, no token, no API rate limit), takes the peeled
 * commit of an annotated tag, and fails on any pin whose SHA differs or whose
 * tag no longer exists.
 *
 *   node scripts/ci/action-pins-match-tags.mjs        # exit 1 on a mismatch
 *
 * Pure parts (collectPins, peeledSha, judge) are exported for
 * src/test/actionPinsMatchTags.test.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "../..");

/** `uses: owner/repo[/path]@<40-hex> # <tag>` */
const PIN_LINE = /^\s*-?\s*uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_./-]+)?@([0-9a-f]{40})\s*#\s*(\S+)/;

export function workflowFiles(root = REPO) {
  const wf = join(root, ".github", "workflows");
  const out = readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(wf, f));
  const actions = join(root, ".github", "actions");
  if (existsSync(actions)) {
    for (const d of readdirSync(actions)) {
      const dir = join(actions, d);
      if (!statSync(dir).isDirectory()) continue;
      for (const name of ["action.yml", "action.yaml"]) if (existsSync(join(dir, name))) out.push(join(dir, name));
    }
  }
  return out.sort();
}

/** One entry per (repo, sha, tag), with every file that uses it. */
export function collectPins(files) {
  const byKey = new Map();
  for (const { path, text } of files) {
    for (const line of text.split("\n")) {
      const m = PIN_LINE.exec(line);
      if (!m) continue;
      const [, repo, sha, tag] = m;
      const key = `${repo}@${sha}#${tag}`;
      if (!byKey.has(key)) byKey.set(key, { repo, sha, tag, files: [] });
      const e = byKey.get(key);
      if (!e.files.includes(path)) e.files.push(path);
    }
  }
  return [...byKey.values()].sort((a, b) => (a.repo + a.tag).localeCompare(b.repo + b.tag));
}

/** The commit a tag points at, from `git ls-remote` output: the peeled `^{}` line of an annotated tag wins. */
export function peeledSha(lsRemote, tag) {
  let direct = null;
  for (const line of lsRemote.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === `refs/tags/${tag}^{}`) return sha;
    if (ref === `refs/tags/${tag}`) direct = sha;
  }
  return direct;
}

/** resolved: Map "<repo>#<tag>" -> commit sha, or null when the tag is gone. */
export function judge(pins, resolved) {
  const lines = [];
  for (const p of pins) {
    const got = resolved.get(`${p.repo}#${p.tag}`);
    if (!got) lines.push(`${p.repo}@${p.sha} # ${p.tag}: tag ${p.tag} not found on github.com/${p.repo} (${p.files.join(", ")})`);
    else if (got !== p.sha) lines.push(`${p.repo}@${p.sha} # ${p.tag}: tag ${p.tag} is ${got}, not the pinned SHA (${p.files.join(", ")})`);
  }
  return { ok: lines.length === 0, lines };
}

function main() {
  const files = workflowFiles().map((f) => ({ path: relative(REPO, f), text: readFileSync(f, "utf8") }));
  const pins = collectPins(files);
  if (pins.length === 0) {
    console.error("action-pins: no pinned `uses:` line found; the scan is broken, not clean.");
    process.exit(1);
  }
  const resolved = new Map();
  for (const key of new Set(pins.map((p) => `${p.repo}#${p.tag}`))) {
    const [repo, tag] = key.split("#");
    const out = execFileSync(
      "git",
      ["ls-remote", "--tags", `https://github.com/${repo}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
      { encoding: "utf8", timeout: 60_000 },
    );
    resolved.set(key, peeledSha(out, tag));
  }
  const { ok, lines } = judge(pins, resolved);
  console.log(`action-pins: ${pins.length} pin(s) across ${new Set(pins.map((p) => p.repo)).size} action repo(s) checked against their tags.`);
  if (!ok) {
    console.error(`action-pins: ${lines.length} pin(s) do not match their version comment:\n  ${lines.join("\n  ")}`);
    process.exit(1);
  }
  console.log("OK: every pinned SHA is its tag's commit.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
