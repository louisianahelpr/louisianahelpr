#!/usr/bin/env node
/**
 * check-audit-evidence — make the absence of evidence visible in an audit report.
 *
 * Audits of this app have repeatedly reported it clean while real breakage sat
 * in production, because a session that could not operate the app substituted
 * reading the code and filed that as verification. Prose reads identically
 * either way. This script does not judge whether a claim is TRUE — it only
 * asks whether the claim carries an artifact somebody could go and re-check:
 * an HTTP status, a DB row count, a screenshot path, command output, a SHA.
 *
 * Deliberately a heuristic. It is a mirror, not a gate — do NOT wire it into
 * CI as a blocking check (audit reports aren't committed on a schedule and it
 * would just be noise). Run it on a report before filing it.
 *
 *   npm run check:audit-evidence -- docs/audit/MY-REPORT.md
 *   npm run check:audit-evidence -- report.md --json
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * A line is a CLAIM if it asserts something about the app's state.
 * Verdict words ("works", "clean", "broken", "verified") are the tell.
 */
const CLAIM_PATTERNS = [
  /\b(?:verified|confirmed|validated)\b/i,
  /\b(?:works?|working|functions? correctly|behaves? correctly)\b/i,
  /\b(?:is|are|was|were|looks?|reads?|renders?)\s+(?:all\s+)?(?:clean|correct|fine|good|healthy|ok|okay|right)\b/i,
  /\b(?:no (?:issues?|defects?|bugs?|problems?|regressions?) (?:found|detected|present))\b/i,
  /\b(?:broken|fails?|failing|failed|regressed|returns? an error|throws?)\b/i,
  /\b(?:passes|passed|passing|green)\b/i,
  /\bcheck(?:ed|s)? out\b/i,
  /\ball clear\b/i,
];

/**
 * A line carries EVIDENCE if it contains a re-checkable artifact.
 * Each entry is [label, pattern] so the report can say what was found.
 */
const EVIDENCE_PATTERNS = [
  ["http-status", /\b(?:HTTP\s*)?[1-5]\d{2}\b\s*(?:OK|Not Found|Forbidden|Unauthorized|Bad Request|Server Error|response|status|→|->)/i],
  ["http-status", /\b(?:status|code|responded|returned|→)\s*(?:code\s*)?(?:=|:)?\s*[1-5]\d{2}\b/i],
  ["curl", /\bcurl\b/],
  ["db-rows", /\b\d+\s*rows?\b/i],
  ["db-query", /\b(?:select|insert into|update|delete from)\b .*\b(?:from|set|where|values)\b/i],
  ["screenshot", /[\w./-]+\.(?:png|jpg|jpeg|webp|gif)\b/i],
  ["command-output", /(?:^|\s)(?:\$|>)\s*\S+/m],
  ["command", /\b(?:gh|npm|npx|supabase|git|psql|xcrun|playwright|vitest|eslint|tsc)\s+\S+/],
  ["commit-sha", /\b[0-9a-f]{7,40}\b(?=\s|$|[).,])/],
  ["code-fence", /^\s*```/],
  ["workflow-run", /\brun\s+#?\d{3,}\b|\bconclusion\s*[:=]\s*\w+/i],
  ["log-line", /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\b/],
  // `file.ts:44` — the evidence form PROTOCOL §3 names for a STATIC finding,
  // and the one this list forgot. Without it every lane whose findings are
  // read from source rather than driven at runtime scores near-zero:
  // lh-native-bridge measured 72% of its claims "unevidenced" while nearly
  // every flagged line carried a `biometricGate.ts:44`-style citation.
  //
  // That is worse than a missing check. A checker that reports a well-evidenced
  // report as unevidenced teaches lanes to ignore it — and the next lane with a
  // genuinely thin report gets the same 72% and nobody looks twice. A gate
  // people have learned to disregard protects nothing.
  //
  // Deliberately narrow: a real extension plus a line number. A bare filename
  // is not evidence, and `1.5:30` or a time is not a citation.
  ["file-line", /\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|sql|css|swift|kt|java|yml|yaml|json|html)\s*:\s*\d+\b/i],
];

/** Lines that look like a claim but are structural noise, not assertions. */
const IGNORE_PATTERNS = [
  /^\s*```/,            // fence markers themselves handled separately
  /^\s*\|?\s*-{3,}/,    // table rules
  /^\s*#{1,6}\s/,       // headings
  /^\s*>/,              // blockquotes (usually quoted guidance)
];

// UNVERIFIED anywhere in the heading, not only at its start.
//
// This anchored the word to the beginning, so a lane that titled its section
// "Still genuinely UNVERIFIED" — a better heading than the bare word — was told
// the section was MISSING and that it had failed the standard's completeness
// bar. The checker was grading the wording of the heading, not the presence of
// the section.
const UNVERIFIED_HEADING = /^\s*#{1,6}\s*\**[^\n]*?\bUNVERIFIED\b/im;

export function analyzeReport(text) {
  const lines = text.split(/\r?\n/);
  const claims = [];
  let inFence = false;
  let fenceStart = -1;

  // Evidence inside a fenced block counts for the nearest preceding claim,
  // so track which fences exist and their line spans.
  const fences = [];
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceStart = i;
      } else {
        inFence = false;
        fences.push([fenceStart, i]);
      }
    }
  });
  if (inFence) fences.push([fenceStart, lines.length - 1]);

  const inFenceAt = (i) => fences.some(([a, b]) => i >= a && i <= b);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (inFenceAt(i)) return;
    if (IGNORE_PATTERNS.some((p) => p.test(raw))) return;
    if (!CLAIM_PATTERNS.some((p) => p.test(line))) return;

    // Evidence may sit on the claim line, or in the two lines after it
    // (a common shape is "X works:" followed by a fenced command output).
    const window = [raw, lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
    const found = EVIDENCE_PATTERNS.filter(([, p]) => p.test(window)).map(([label]) => label);

    claims.push({
      line: i + 1,
      text: line.length > 160 ? `${line.slice(0, 157)}...` : line,
      evidence: [...new Set(found)],
    });
  });

  return {
    claims,
    withEvidence: claims.filter((c) => c.evidence.length > 0),
    withoutEvidence: claims.filter((c) => c.evidence.length === 0),
    hasUnverifiedSection: UNVERIFIED_HEADING.test(text),
  };
}

function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const json = args.includes("--json");
  const file = args.find((a) => !a.startsWith("--"));

  if (!file) {
    console.error("usage: npm run check:audit-evidence -- <report.md> [--json]");
    process.exit(2);
  }

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`cannot read ${file}: ${err.message}`);
    process.exit(2);
  }

  const result = analyzeReport(text);

  if (json) {
    console.log(JSON.stringify({ file, ...result }, null, 2));
    return;
  }

  const total = result.claims.length;
  const ok = result.withEvidence.length;
  const bad = result.withoutEvidence.length;
  const pct = total === 0 ? 0 : Math.round((ok / total) * 100);

  console.log(`\naudit evidence check — ${file}\n`);
  console.log(`  claims found            ${total}`);
  console.log(`  claims with evidence    ${ok}`);
  console.log(`  claims without evidence ${bad}   (${100 - pct}%)`);
  console.log(
    `  UNVERIFIED section      ${result.hasUnverifiedSection ? "present" : "MISSING — the standard requires one"}`,
  );

  if (bad > 0) {
    console.log(`\nclaims carrying no artifact — move these to UNVERIFIED, or attach evidence:\n`);
    for (const c of result.withoutEvidence) {
      console.log(`  ${String(c.line).padStart(5)}:  ${c.text}`);
    }
  }

  if (total === 0) {
    console.log("\nno claims matched. Either the report asserts nothing, or its");
    console.log("phrasing is outside the heuristic — read it yourself before trusting this.");
  }

  console.log(
    "\nheuristic, not a verdict: evidence found here only means an artifact is",
  );
  console.log("present, not that it proves what the sentence claims.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
