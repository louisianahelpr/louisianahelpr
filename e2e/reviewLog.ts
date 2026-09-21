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

/**
 * NOT under `test-results/`, and that is the whole point.
 *
 * It lived there until 2026-09-20, when a lane noticed its own eight records
 * had vanished: `test-results/` is Playwright's default `outputDir`, and
 * Playwright CLEARS it at the start of every run. So the log survived only
 * until the next spec ran, and `npm run review:report` then reported against
 * whatever happened to be left.
 *
 * The damage was not a lost file. CLAUDE.md's first rule is that nothing
 * visual is done until someone has LOOKED at a screenshot, and this log is the
 * only thing that makes "I looked" falsifiable rather than a claim. A log that
 * silently empties turns the strongest verification rule in the project into
 * an honour system — and worse, `review:report` goes GREEN on an empty log,
 * because zero unreviewed failures is what a wiped file looks like. Checked
 * the day it was found: one entry survived out of a day's reviewing.
 *
 * `.review/` is gitignored, outside every tool's output directory, and nothing
 * clears it. `src/test/reviewLogSurvivesTestRuns.test.ts` fails if this path
 * moves back under a directory a runner owns.
 */
export const REVIEW_LOG = resolve(process.cwd(), ".review", "review-log.jsonl");

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
