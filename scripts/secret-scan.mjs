#!/usr/bin/env node
/**
 * Secret scan for this repo's key shapes (Q75). Never prints a value: a
 * finding is reported as rule id, file, line and length only.
 *
 *   node scripts/secret-scan.mjs --staged        pre-commit (.husky/pre-commit)
 *   node scripts/secret-scan.mjs --range A..B    CI: every commit in the range
 *   node scripts/secret-scan.mjs --files f ...   whole files (proofs, ad hoc)
 *
 * --staged and --range report only lines the change ADDS, so a triaged
 * historical fixture already on main does not block an unrelated edit to the
 * same file. The shapes and the allowlist live in scripts/lib/secretShapes.mjs,
 * mirrored into .gitleaks.toml (gitleaks runs beside this in CI, and in the
 * hook when it is installed). Any finding fails the run (non-zero exit).
 *
 * A false positive: reword the line, or (if it really is public) add it to
 * ALLOWED_MATCHES / ALLOWED_LINES AND the .gitleaks.toml allowlist in the same
 * commit. Never --no-verify past a real key: rotate it, it is already burned.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { scanText } from "./lib/secretShapes.mjs";

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const isBinary = (s) => s.includes("\u0000");

// Triaged findings, by gitleaks fingerprint (commit:file:rule:line for history,
// file:rule:line for a tree). The lh-* rule ids are shared with .gitleaks.toml,
// so one ignore file serves both engines.
// @two-way scripts/check-gitleaksignore.mjs:const staleIgnores =
const IGNORED = new Set(
  existsSync(".gitleaksignore")
    ? readFileSync(".gitleaksignore", "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : [],
);

/** Line numbers (new side) that a -U0 diff adds, per file. */
function addedLines(diff) {
  const out = new Map();
  let file = null;
  let ln = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      if (file && !out.has(file)) out.set(file, new Set());
      continue;
    }
    const h = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      ln = Number(h[1]);
      continue;
    }
    if (file && line.startsWith("+")) out.get(file).add(ln++);
  }
  return out;
}

function scanBlobs(label, added, readBlob, sha = null) {
  const findings = [];
  for (const [file, lines] of added) {
    if (lines.size === 0) continue;
    let text;
    try {
      text = readBlob(file);
    } catch {
      continue; // deleted or unreadable: nothing added to scan
    }
    if (isBinary(text)) continue;
    for (const f of scanText(text)) {
      if (!lines.has(f.line)) continue;
      if (sha && IGNORED.has(`${sha}:${file}:${f.id}:${f.line}`)) continue;
      findings.push({ ...f, file, label });
    }
  }
  return findings;
}

const args = process.argv.slice(2);
let findings = [];
let scanned = 0;

if (args[0] === "--staged") {
  const added = addedLines(git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"]));
  scanned = added.size;
  findings = scanBlobs("staged", added, (f) => git(["show", `:${f}`]));
} else if (args[0] === "--range" && args[1]) {
  const shas = git(["rev-list", "--no-merges", args[1]]).split("\n").filter(Boolean);
  for (const sha of shas) {
    const added = addedLines(git(["show", "-U0", "--no-color", "--no-ext-diff", "--format=", "--diff-filter=ACMR", sha]));
    scanned += added.size;
    findings.push(...scanBlobs(sha.slice(0, 9), added, (f) => git(["show", `${sha}:${f}`]), sha));
  }
  console.log(`secret-scan: ${shas.length} commit(s) in ${args[1]}`);
} else if (args[0] === "--files" && args.length > 1) {
  for (const file of args.slice(1)) {
    const text = readFileSync(file, "utf8");
    scanned++;
    if (isBinary(text)) continue;
    for (const f of scanText(text)) if (!IGNORED.has(`${file}:${f.id}:${f.line}`)) findings.push({ ...f, file, label: "file" });
  }
} else {
  console.error("usage: secret-scan.mjs --staged | --range A..B | --files <file>...");
  process.exit(2);
}

for (const f of findings) {
  const where = f.label === "file" || f.label === "staged" ? "" : `${f.label}  `;
  console.error(`SECRET-SCAN ${f.id}  ${where}${f.file}:${f.line}  (value redacted, ${f.length} chars)`);
}
if (findings.length) {
  console.error(`\nsecret-scan: ${findings.length} finding(s). Remove the value; if it was ever real, rotate it (a pushed key is burned).`);
}
let gitleaksFailed = false;
// In the hook, also run gitleaks when it is installed (CI always has it).
if (args[0] === "--staged" && !process.env.LH_SECRET_SCAN_NO_GITLEAKS) {
  const r = spawnSync("gitleaks", ["git", "--pre-commit", "--staged", "--redact", "--no-banner", "--config", ".gitleaks.toml"], {
    stdio: "inherit",
  });
  if (r.error?.code === "ENOENT") {
    console.log("secret-scan: gitleaks not installed, repo key shapes only (brew install gitleaks for the full rule set)");
  } else if (r.status !== 0) {
    console.error("secret-scan: gitleaks found a secret in the staged changes (value redacted above)");
    gitleaksFailed = true;
  }
}

if (findings.length || gitleaksFailed) process.exit(1);
console.log(`secret-scan: clean (${scanned} file change(s) scanned)`);
