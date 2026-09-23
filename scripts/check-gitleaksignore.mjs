#!/usr/bin/env node
/**
 * Two-way check for .gitleaksignore (Q75): every triaged fingerprint must
 * still reproduce. A line whose finding is gone (history rewritten, rule
 * renamed) is a stale exemption that would silently cover the next finding
 * with the same fingerprint, so it fails here.
 *
 * Runs gitleaks over the full history with NO ignore file (scanning via .git,
 * so gitleaks does not auto-load the repo-root .gitleaksignore), redacted, and
 * compares fingerprints. Needs gitleaks on PATH; the Secret Scan workflow
 * installs it. Exit 1 on a stale entry, 2 if gitleaks is missing.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entries = readFileSync(".gitleaksignore", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const dir = mkdtempSync(join(tmpdir(), "gitleaksignore-"));
try {
  const report = join(dir, "report.json");
  const emptyIgnore = join(dir, "empty");
  writeFileSync(emptyIgnore, "");
  const r = spawnSync(
    "gitleaks",
    ["git", ".git", "--config", ".gitleaks.toml", "--gitleaks-ignore-path", emptyIgnore, "--log-opts=--all", "--redact", "--no-banner", "--exit-code", "0", "-f", "json", "-r", report],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (r.error?.code === "ENOENT") {
    console.error("check-gitleaksignore: gitleaks is not installed");
    process.exit(2);
  }
  if (r.status !== 0) {
    console.error(`check-gitleaksignore: gitleaks exited ${r.status}`);
    process.exit(1);
  }
  const found = new Set(JSON.parse(readFileSync(report, "utf8")).map((f) => f.Fingerprint));
  const staleIgnores = entries.filter((e) => !found.has(e));
  for (const e of staleIgnores) console.error(`stale baseline entry ${e} — remove it (lower the baseline)`);
  if (staleIgnores.length) process.exit(1);
  console.log(`check-gitleaksignore: all ${entries.length} entries still reproduce`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
