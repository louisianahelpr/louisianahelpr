/**
 * The verdict on every place under e2e/ that can skip a Playwright test.
 *
 * Owner, 2026-09-23 (docs/OPEN.md Q52): "nothing is a false positive or going
 * green if it's not truly green." A skipped test reports green. On 2026-09-23
 * the nightly prod-audit skipped 17 tests (e.g. the double-apply race in
 * e2e/prod-audit/interruptions.spec.ts) because a prod fixture was missing,
 * and the run was green.
 *
 * TWO VERDICTS, and the reporter (e2e/reporters/skipReporter.ts) acts on them:
 *   justified — the skip is TRUE: the test does not apply to this run by
 *               design (an opt-in tool, a scenario pin, a viewport the surface
 *               does not render at). Reported, run stays green.
 *   failure   — the skip means "we could not test it" (a missing credential, a
 *               missing prod fixture, an upstream step that did not produce
 *               its state, a network error). Reported, and the RUN FAILS. The
 *               skip call stays in source so the reason is printed and the body
 *               does not crash on the missing precondition.
 * A skip at a site with no entry here also fails the run.
 *
 * TWO-WAY: src/test/e2eSkipsAreJustified.test.ts fails when a skip site in
 * source has no entry, and when an entry matches no site.
 *
 * `file` is a repo-relative path, or a directory prefix ending in "/".
 * `match` is a substring of the skip call's source text (whitespace-collapsed).
 */
export type SkipVerdict = "justified" | "failure";

export interface SkipEntry {
  file: string;
  match: string;
  verdict: SkipVerdict;
  why: string;
}

const MISSING_FIXTURE =
  "a prod fixture the test needs does not exist — the assertion never ran, so the run is not green; seed the state or fix the harness";
const MISSING_CREDS =
  "the test-account credentials/sessions are missing — in CI that is a broken secret, locally a missing .env; either way nothing was tested";

// @two-way src/test/e2eSkipsAreJustified.test.ts:entries that match no skip site — remove them
export const SKIP_ALLOWLIST: SkipEntry[] = [
  // ── justified: the test does not apply to this run, by design ──────────────
  {
    file: "e2e/journeys/",
    match: "SCENARIO pins another scenario",
    verdict: "justified",
    why: "a dispatch with SCENARIO=<one journey> runs only that journey; every other journey is out of scope for the run by request",
  },
  {
    file: "e2e/prod-audit/messy-input.spec.ts",
    match: "test.skip(...args)",
    verdict: "justified",
    why: "MESSY_INPUT_SCOPE narrows a manual run to matching titles (a --grep that keeps the inventory listed); unset in CI so nothing is scoped out",
  },
  {
    file: "e2e/prod-audit/expanding-search-geometry.spec.ts",
    match: "does not render at",
    verdict: "justified",
    why: "the surface declares a minWidth and is not rendered below it at all; there is no field to measure at that viewport",
  },
  {
    file: "e2e/happy-path/zz-recurring-picker.spec.ts",
    match: "!RECURRING_ENABLED",
    verdict: "justified",
    why: "reads the product's own RECURRING_ENABLED flag from LogisticsSection.tsx; while it is false the picker does not render for anyone",
  },
  {
    file: "e2e/happy-path/zz-senior-probe.spec.ts",
    match: "LH_SENIOR_PROBE",
    verdict: "justified",
    why: "opt-in measurement tool for the a11y lane (~15 min), not a suite contract; its findings are written up in the audit report",
  },
  {
    file: "e2e/happy-path/appstore-screenshots.spec.ts",
    match: "RUN_APPSTORE_SHOTS",
    verdict: "justified",
    why: "opt-in App Store screenshot generator, not a check; it produces marketing images when asked and asserts nothing about the app",
  },
  {
    file: "e2e/happy-path/empty-state-sweep.spec.ts",
    match: "sweepDescribe(",
    verdict: "justified",
    why: "opt-in visual sweep (RUN_EMPTY_SWEEP=1) that captures screenshots for human review; the per-push suite is not its gate",
  },
  {
    file: "e2e/happy-path/error-state-sweep.spec.ts",
    match: "sweepDescribe(",
    verdict: "justified",
    why: "opt-in visual sweep (RUN_ERROR_SWEEP=1) that captures screenshots for human review; the per-push suite is not its gate",
  },
  {
    file: "e2e/happy-path/overlay-sweep.spec.ts",
    match: "sweepDescribe(",
    verdict: "justified",
    why: "opt-in visual sweep (RUN_OVERLAY_SWEEP=1) that captures screenshots for human review; the per-push suite is not its gate",
  },
  {
    file: "e2e/happy-path/state-matrix/state-sweep.spec.ts",
    match: "manifestDescribe(",
    verdict: "justified",
    why: "opt-in state-matrix manifest emitter, run only when the matrix is being regenerated; not a check on the app",
  },
  {
    file: "e2e/happy-path/state-matrix/state-sweep.spec.ts",
    match: "sweepDescribe(",
    verdict: "justified",
    why: "opt-in state-matrix screenshot sweep for human review, enabled by its own env flag; the per-push suite is not its gate",
  },

  // ── failure: the skip means nothing was tested ─────────────────────────────
  { file: "e2e/journeys/", match: "test.skip(!avail.ok, avail.why)", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/journeys/time-travel.spec.ts", match: "sessionsAvailable().why", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/journeys/trailing-icon-fields.spec.ts", match: "!session,", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/auth.spec.ts", match: "!haveCreds", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/payment-lifecycle.spec.ts", match: "!haveCreds", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/prod-lifecycle.spec.ts", match: "!READY", verdict: "failure", why: MISSING_CREDS },
  {
    file: "e2e/two-role-lifecycle.spec.ts",
    match: "!RUN",
    verdict: "failure",
    why: "e2e-real-backend.yml sets PLAYWRIGHT_TWO_ROLE=1 for this spec; a skip means the job's env is broken and the two-role money loop was not tested",
  },
  { file: "e2e/a11y-prod/a11y-prod.spec.ts", match: "PLAYWRIGHT_INCOMPLETE_EMAIL", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/a11y-prod/a11y-prod.spec.ts", match: "PLAYWRIGHT_ADMIN_EMAIL", verdict: "failure", why: MISSING_CREDS },
  { file: "e2e/a11y-prod/a11y-prod.spec.ts", match: "keyed to a fixture id", verdict: "failure", why: MISSING_FIXTURE },
  { file: "e2e/a11y-prod/a11y-prod.spec.ts", match: "no is_seed job in status", verdict: "failure", why: MISSING_FIXTURE },
  { file: "e2e/a11y-prod/a11y-prod.spec.ts", match: "no is_seed group job", verdict: "failure", why: MISSING_FIXTURE },
  { file: "e2e/prod-audit/", match: "GAP:", verdict: "failure", why: MISSING_FIXTURE },
  {
    file: "e2e/prod-audit/messy-input.spec.ts",
    match: "test.skip(!!why, why",
    verdict: "failure",
    why: "an EXPLORE entry's needs() found its precondition missing on prod (no fixture row / no reachable form); the form was never exercised",
  },
  {
    file: "e2e/journeys/fixtures.ts",
    match: "`${title}: ${detail}`",
    verdict: "failure",
    why: "skipUncovered(): a journey leg could not run because prod lacked the state it needs (grid re-seed, funded open thread, prefs row); the leg is uncovered, not passed",
  },
  {
    file: "e2e/journeys/02-marketplace.spec.ts",
    match: "!S.funded",
    verdict: "failure",
    why: "Stripe stays in TEST mode until launch (CLAUDE.md), so a job must fund; an unfunded job means checkout broke and browse/apply/hire were not tested",
  },
  {
    file: "e2e/journeys/02-marketplace.spec.ts",
    match: "J2 did not create a job",
    verdict: "failure",
    why: "the upstream journey did not produce the job this one needs (including a SCENARIO pin that skipped J2) — this journey was not tested",
  },
  {
    file: "e2e/happy-path/zz-runtime-probe.spec.ts",
    match: "AASA fetch failed",
    verdict: "failure",
    why: "a network failure fetching the live AASA file is an unanswered check, not a pass; universal links were not verified",
  },
];

function fileMatches(entryFile: string, file: string): boolean {
  return entryFile.endsWith("/") ? file.startsWith(entryFile) : file === entryFile;
}

/** Every entry that covers a site (file + call text). */
export function entriesFor(file: string, siteText: string): SkipEntry[] {
  return SKIP_ALLOWLIST.filter((e) => fileMatches(e.file, file) && siteText.includes(e.match));
}
