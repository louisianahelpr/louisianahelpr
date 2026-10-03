#!/usr/bin/env node
/**
 * Zero open code-scanning alerts on main, from a CodeQL scan that really ran.
 *
 * 2026-10-02: GitHub's Security tab held 70 open CodeQL alerts on main
 * (xss-through-dom, stack-trace exposure, an unverified TLS socket, a
 * workflow with no token scope...). CodeQL default setup files an alert and
 * stops there: nothing in this repo read the list, so it only grew. This makes
 * the count a check. Every open alert fails the run and is listed by number,
 * rule and file:line, so the fix (or a dismissal with a stated reason) starts
 * from the run log.
 *
 * Zero alerts is only meaningful if CodeQL is still scanning, so the run also
 * fails (NO FALSE GREENS) when:
 *   - the API refuses us (code scanning off, or the token lost security-events);
 *   - any language in EXPECTED_CATEGORIES has no analysis on main, or its newest
 *     one is older than MAX_AGE_DAYS (default setup scans every push to main and
 *     weekly besides, so a week of silence means the scan stopped);
 *   - main is analysed under a category not listed here (a language was added:
 *     list it, so the freshness check covers it too).
 *
 *   node scripts/code-scanning-check.mjs     # needs gh, authenticated (GH_TOKEN in CI)
 *
 * Daily: .github/workflows/code-scanning-alerts.yml (red files a nightly-red
 * issue). Guard: src/test/codeScanningCheck.test.ts. docs/OPEN.md Q1143.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Every CodeQL category main is analysed under. Exact: a new or vanished one fails. */
// "eslint": the ESLint SARIF upload (.github/workflows/eslint.yml, 2957f7017,
// owner's #2159), weekly and on every push to main.
export const EXPECTED_CATEGORIES = ["/language:actions", "/language:javascript-typescript", "eslint"];
export const MAX_AGE_DAYS = 8;

/**
 * Pure verdict. `alerts` are the OPEN alerts on main; `analyses` are recent
 * analyses of main ({category, created_at}), newest first or not.
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function judge({ alerts, analyses, now, expected = EXPECTED_CATEGORIES, maxAgeDays = MAX_AGE_DAYS }) {
  const lines = [];
  const newest = new Map();
  for (const a of analyses) {
    const t = Date.parse(a.created_at);
    if (!newest.has(a.category) || t > newest.get(a.category)) newest.set(a.category, t);
  }
  for (const cat of expected) {
    if (!newest.has(cat)) {
      lines.push(`no CodeQL analysis of main under ${cat}: the scan is not running for it`);
      continue;
    }
    const days = (now - newest.get(cat)) / 86_400_000;
    if (days > maxAgeDays) {
      lines.push(`newest ${cat} analysis of main is ${days.toFixed(1)} days old (limit ${maxAgeDays}): the scan stopped`);
    }
  }
  for (const cat of newest.keys()) {
    if (!expected.includes(cat)) {
      lines.push(`main is analysed under ${cat}, which EXPECTED_CATEGORIES does not list: add it`);
    }
  }
  for (const a of [...alerts].sort((x, y) => x.number - y.number)) {
    lines.push(`open alert #${a.number} ${a.rule} (${a.severity}) ${a.path}:${a.line}`);
  }
  return { ok: lines.length === 0, lines };
}

function ghLines(path, jq) {
  const out = execFileSync("gh", ["api", "--paginate", path, "--jq", jq], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || "louisianahelpr/louisianahelpr";
  let alerts;
  let analyses;
  try {
    alerts = ghLines(
      `repos/${repo}/code-scanning/alerts?state=open&ref=refs/heads/main&per_page=100`,
      ".[] | {number, rule: .rule.id, severity: (.rule.security_severity_level // .rule.severity), path: .most_recent_instance.location.path, line: .most_recent_instance.location.start_line}",
    );
    // Not paginated: the newest 100 are plenty to find each category's latest.
    analyses = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/${repo}/code-scanning/analyses?ref=refs/heads/main&per_page=100`, "--jq", "[.[] | {category, created_at}]"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
      ),
    );
  } catch (err) {
    const why = String(err.stderr || err.message).trim().split("\n")[0];
    console.error(`[code-scanning] could not read code scanning for ${repo}: ${why}`);
    console.error("[code-scanning] failing closed: an unreadable list is not an empty one.");
    process.exit(1);
  }

  const { ok, lines } = judge({ alerts, analyses, now: Date.now() });
  if (ok) {
    console.log(`[code-scanning] 0 open alerts on main; ${EXPECTED_CATEGORIES.join(", ")} analysed within ${MAX_AGE_DAYS} days.`);
    return;
  }
  console.error(`[code-scanning] ${alerts.length} open alert(s) on main. Fix each, or dismiss it with a reason:`);
  for (const l of lines) console.error(`  ${l}`);
  console.error(`  https://github.com/${repo}/security/code-scanning`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
