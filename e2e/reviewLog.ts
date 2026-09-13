/**
 * Review log: the record that someone actually LOOKED at a screenshot.
 *
 * CLAUDE.md says nothing visual is done until a screenshot has been looked at,
 * and until this file that claim was unverifiable. An agent that says it
 * inspected a screenshot records one entry per screenshot here;
 * `npm run review:report` then lists every screenshot a run produced beside
 * whether an entry exists, and flags failures and pixel diffs nobody reviewed.
 *
 * From a spec: recordReview({...}). From the shell:
 *   npm run review:record -- <screenshot> <screen> <checked> <ok|defect> [note]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REVIEW_LOG = resolve(process.cwd(), "test-results", "review-log.jsonl");

export interface ReviewEntry {
  /** Path to the PNG that was looked at (absolute or relative to cwd). */
  screenshot: string;
  /** Which screen / route / state it shows. */
  screen: string;
  /** What was checked while looking, e.g. "icons, card spacing, header". */
  checked: string;
  verdict: "ok" | "defect";
  note?: string;
}

export function recordReview(entry: ReviewEntry): void {
  if (!entry.screenshot || !entry.screen || !entry.checked) {
    throw new Error("recordReview needs screenshot, screen and checked");
  }
  if (entry.verdict !== "ok" && entry.verdict !== "defect") {
    throw new Error(`recordReview verdict must be "ok" or "defect", got ${String(entry.verdict)}`);
  }
  mkdirSync(dirname(REVIEW_LOG), { recursive: true });
  const row = { ...entry, screenshot: resolve(entry.screenshot), reviewedAt: new Date().toISOString() };
  appendFileSync(REVIEW_LOG, JSON.stringify(row) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [screenshot, screen, checked, verdict, ...note] = process.argv.slice(2);
  recordReview({ screenshot, screen, checked, verdict: verdict as ReviewEntry["verdict"], note: note.join(" ") || undefined });
  console.log(`recorded review of ${screenshot} (${verdict}) -> ${REVIEW_LOG}`);
}
