/**
 * axe WCAG violations that are KNOWN, RECORDED and not yet fixed — the
 * two-way baseline for the prod route sweep's axe gate (Q181, docs/OPEN.md;
 * overlaps Q71 "Accessibility on every route").
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS NOT A MUTE BUTTON
 * ------------------------------------------------------------------
 * Same shape and same reasoning as knownContrastFailures.ts. Turning the
 * route sweep's axe tag set from wcag2a/2aa/21a/21aa on to ALSO
 * wcag22aa+best-practice (axeTags.ts) is very likely to surface violations
 * that were always there, un-scanned — exactly the moment a gate dies if
 * there is nowhere to write them down: someone narrows the tag set back, or
 * deletes the assertion, to unblock a build, and the gate quietly stops
 * doing its job.
 *
 * So the known set is written down instead, keyed by (screen, variant, axe
 * rule id), and the gate keeps every property that makes it worth having:
 *
 *   - a NEW violation (not on the list) fails the run.
 *   - a listed violation that is GONE fails the run, as a stale entry — the
 *     list can only shrink; fixing something forces the entry out.
 *   - the same is true whether the violation is a pre-existing 2.0/2.1 one or
 *     one the new 2.2/best-practice tags reveal — this is not a carve-out for
 *     the new tags, it's a record of today's actual debt either way.
 *
 * Every entry needs a `note` naming what it is. "It was already like that" is
 * not a note — say who should fix it or why it's accepted for now.
 *
 * TO FIX ONE: fix the screen, delete its entry, and the gate will tell you if
 * you were wrong (a fixed entry left in place fails as stale).
 *
 * ------------------------------------------------------------------
 * WHERE THE BASELINE FILE COMES FROM
 * ------------------------------------------------------------------
 * `e2e/happy-path/axe-known-violations.json` does NOT ship with this change.
 * It cannot: this sweep only ever runs for real, against prod (CLAUDE.md "NO
 * MOCK MODE, EVER"), and the session that wrote this baseline mechanism had
 * no prod access, so there is no way to measure "today's known violations"
 * from here.
 *
 * loadAxeBaseline() returns `null` when that file is missing — DELIBERATELY
 * different from "empty baseline" (`[]`, which would mean "we checked and
 * there is truly nothing to grandfather"). `null` means "never generated".
 * The gate (assertSweepGate in sweepCore.ts) treats those two states
 * differently: `null` writes every violation THIS run found to
 * `<OUTPUT_DIR>/axe-baseline-generated.json` (inside the directory the
 * a11y-webkit-prod.yml workflow already uploads as a build artifact) and
 * fails with "axe baseline missing — generated at <path>", rather than
 * silently passing empty or silently failing on everything with no
 * actionable next step.
 *
 * TO ESTABLISH THE BASELINE: run a11y-webkit-prod.yml once (it runs
 * Mon/Wed/Fri automatically, or `workflow_dispatch` it), download the
 * generated file from the run's uploaded artifact, read every entry (this is
 * a decision to grandfather real, measured WCAG 2.2 AA / best-practice
 * debt — do it deliberately, not by reflex), and commit it as
 * `e2e/happy-path/axe-known-violations.json`. Then add its registration to
 * JSON_TWO_WAY in src/test/baselinesAreTwoWay.test.ts:
 *   "e2e/happy-path/axe-known-violations.json": {
 *     "[]": "e2e/happy-path/knownAxeViolations.ts:out.stale.push(",
 *   },
 * (that test refuses to register a path that isn't tracked yet, which is
 * why it isn't added in this change).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface KnownAxeViolation {
  /** Screen name exactly as the sweep records it, e.g. "job-detail-open". */
  screen: string;
  /** Variant tag, e.g. "phone-light". A violation is per-variant. */
  variant: string;
  /** The route this screen renders, with dynamic ids normalized (see normalizeRoute). Informational — not part of the match key. */
  route: string;
  /** axe rule id, e.g. "color-contrast", "button-name", "empty-heading". */
  id: string;
  /** What this is, and who owns fixing it. */
  note: string;
}

export interface AxeViolationHit {
  screen: string;
  variant: string;
  route: string;
  id: string;
  impact: string | null;
  line: string;
}

export interface AxeClassification {
  /** Not on the baseline. These fail the run. */
  fresh: AxeViolationHit[];
  /** On the baseline. Reported, not failed. */
  allowed: string[];
  /**
   * Listed for a screen+variant this run actually swept, but not seen this
   * run. Either it was fixed (delete the entry) or it moved (update it).
   * Fails the run so the baseline cannot rot.
   */
  stale: string[];
}

/** Path relative to the repo root — the same string the gate's failure message and the lead's commit both use. */
export const AXE_BASELINE_REL_PATH = "e2e/happy-path/axe-known-violations.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = resolve(HERE, "axe-known-violations.json");

/**
 * `null` = the baseline has never been generated (file missing — see the
 * header). `[]` = it was generated and is genuinely empty. The gate must be
 * able to tell these apart, so this does NOT default to `[]` on a missing file.
 */
export function loadAxeBaseline(): KnownAxeViolation[] | null {
  if (!existsSync(BASELINE_FILE)) return null;
  const raw: unknown = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  if (!Array.isArray(raw)) return null;
  return raw as KnownAxeViolation[];
}

/**
 * Strip ids the sweep resolves from live prod data (job ids, user ids) out of
 * a URL, so the baseline's `route` field is stable and readable — the MATCH
 * key never uses this, only `screen` (already the sweep's stable identifier
 * for "which screen"), so a job id changing between runs cannot itself create
 * a spurious fresh/stale pair.
 */
export function normalizeRoute(url: string): string {
  return url
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\?.*$/, "");
}

function keyOf(x: { screen: string; variant: string; id: string }): string {
  return `${x.screen}|${x.variant}|${x.id}`;
}

/**
 * Split this run's axe violations against the known baseline.
 *
 * `sweptKeys` is every `screen|variant` the run actually visited — staleness
 * can only be judged for those (the CI matrix may run one variant per leg).
 * Same shape as knownContrastFailures.ts's classifyAgainstKnown.
 */
export function classifyAxeAgainstKnown(
  hits: AxeViolationHit[],
  known: KnownAxeViolation[],
  sweptKeys: Set<string>,
): AxeClassification {
  const out: AxeClassification = { fresh: [], allowed: [], stale: [] };
  const knownByKey = new Map(known.map((k) => [keyOf(k), k]));
  const seen = new Set<string>();

  for (const h of hits) {
    const key = keyOf(h);
    seen.add(key);
    const match = knownByKey.get(key);
    if (!match) {
      out.fresh.push(h);
    } else {
      out.allowed.push(`${h.line} — known. ${match.note}`);
    }
  }

  for (const k of known) {
    if (seen.has(keyOf(k))) continue;
    if (!sweptKeys.has(`${k.screen}|${k.variant}`)) continue;
    out.stale.push(
      `${k.screen} (${k.variant}) @ ${k.route} — ${k.id} recorded but NOT seen in this run. ` +
        `If you fixed it, delete the entry from ${AXE_BASELINE_REL_PATH}. If the element moved, update it.`,
    );
  }

  return out;
}

/** One baseline-shaped entry per (screen, variant, id) hit, for the auto-generated first-run artifact. */
export function toBaselineEntries(hits: AxeViolationHit[], generatedNote: string): KnownAxeViolation[] {
  const byKey = new Map<string, AxeViolationHit>();
  for (const h of hits) byKey.set(keyOf(h), h);
  return [...byKey.values()]
    .map((h) => ({ screen: h.screen, variant: h.variant, route: h.route, id: h.id, note: generatedNote }))
    .sort((a, b) => (a.screen === b.screen ? (a.variant === b.variant ? a.id.localeCompare(b.id) : a.variant.localeCompare(b.variant)) : a.screen.localeCompare(b.screen)));
}
