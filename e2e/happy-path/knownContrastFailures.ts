/**
 * The colour-contrast failures that are KNOWN, RECORDED and not yet fixed.
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS NOT A MUTE BUTTON
 * ------------------------------------------------------------------
 * The a11y gate could not see colour-contrast at all until 2026-09-02: axe
 * files every contrast result on a gradient canvas under `incomplete`, and the
 * gate read only `violations` (see contrastResolve.ts). Switching it on does
 * not introduce failures, it reveals the ones that were always there — and
 * there are more than one person can fix in the change that turns the gate on.
 *
 * That is the exact moment a gate dies. Someone unblocking a build adds
 * `continue-on-error`, or narrows the tag set, or deletes the assertion, and
 * the check spends the next three months not running while its green tick
 * still shows up in the checks list. `migration-lint` did precisely that here.
 *
 * So the known set is written down instead, with the measured number, and the
 * gate keeps every property that makes it worth having:
 *
 *   - a NEW failure fails the run. Not on this list, not allowed.
 *   - a listed failure that got WORSE fails the run. The recorded ratio is a
 *     ceiling on the damage, not a blanket pass for that element.
 *   - a listed failure that is GONE fails the run, as a stale entry. This is
 *     the anti-rot rule and it is the reason this file cannot quietly become a
 *     graveyard: the list can only shrink, because fixing something forces the
 *     entry out of it. Same shape as UNSWEPT_ROUTES in
 *     src/test/auditCatalogRoutes.test.ts, and for the same reason — a list
 *     that is checked against itself can never fail.
 *
 * Every entry needs a `note` naming what it is and who should fix it. "It was
 * already like that" is not a note.
 *
 * TO FIX ONE: fix the screen, delete its entry, and the gate will tell you if
 * you were wrong. Do NOT add an entry to get a red build green — if it is new,
 * it is a regression this change set introduced, and the fix is the fix.
 */

export interface KnownContrastFailure {
  /** Screen name exactly as the sweep records it, e.g. "customer-profile-schedule". */
  screen: string;
  /** Variant tag, e.g. "phone-dark". A failure is per-variant. */
  variant: string;
  /** The element's trimmed text as the report records it (first 48 chars). */
  text: string;
  /**
   * The WORST ratio observed for this key when it was recorded. The gate
   * allows this value or better; anything worse than `ratio - TOLERANCE` fails
   * as a regression.
   *
   * Worst, not first, because screen+variant+text is not always ONE element: a
   * tab strip carries several 9px "1" badges with different tints, and
   * recording whichever came first made a later run reporting the dimmer twin
   * read as a regression from 3.66 to 2.59. Recording the worst keeps the
   * entry a true ceiling.
   */
  ratio: number;
  /** What this is, and who owns fixing it. */
  note: string;
}

/**
 * Antialiasing, subpixel layout and gradient position move a measured ratio by
 * a few hundredths between runs. Anything beyond this is a real change.
 */
export const KNOWN_FAILURE_TOLERANCE = 0.1;

/**
 * EMPTY, DELIBERATELY, and it should stay that way until something genuinely
 * cannot be fixed now.
 *
 * A five-leg sweep on 2026-09-02 found 295 failing nodes over twelve root
 * causes, and every one of them was fixed rather than listed. An allowlist
 * populated on the day it ships is not a record of known debt, it is a list
 * that gets read as "these are fine" — so this exists for the failure nobody
 * can fix immediately, not for the ones nobody got round to.
 *
 * Adding an entry is a decision to ship a known WCAG AA failure. Make it
 * deliberately, name an owner in the note, and expect to be asked when it
 * comes out again.
 */
export const KNOWN_CONTRAST_FAILURES: KnownContrastFailure[] = [];

export interface ClassifiedFailure {
  screen: string;
  variant: string;
  text: string;
  ratio: number;
  line: string;
}

export interface Classification {
  /** Not on the list. These fail the run. */
  fresh: ClassifiedFailure[];
  /** On the list but measurably worse than recorded. These fail the run. */
  regressed: string[];
  /** On the list, at or better than recorded. Reported, not failed. */
  allowed: string[];
  /**
   * Listed for a screen+variant this run actually swept, but not seen. Either
   * it was fixed (delete the entry) or the element moved (update it). Fails
   * the run so the list cannot rot.
   */
  stale: string[];
}

/**
 * Split this run's contrast failures against the known set.
 *
 * `sweptKeys` is every `screen|variant` the run actually visited — staleness
 * can only be judged for those. The CI matrix runs ONE variant per leg, so
 * without this every entry for the other four variants would read as stale on
 * every leg.
 */
export function classifyAgainstKnown(
  failures: ClassifiedFailure[],
  sweptKeys: Set<string>,
): Classification {
  const out: Classification = { fresh: [], regressed: [], allowed: [], stale: [] };
  const matched = new Set<KnownContrastFailure>();

  for (const f of failures) {
    const known = KNOWN_CONTRAST_FAILURES.find(
      (k) => k.screen === f.screen && k.variant === f.variant && k.text === f.text,
    );
    if (!known) {
      out.fresh.push(f);
      continue;
    }
    matched.add(known);
    if (f.ratio < known.ratio - KNOWN_FAILURE_TOLERANCE) {
      out.regressed.push(
        `${f.line}  — RECORDED AT ${known.ratio}:1, NOW ${f.ratio}:1. This got worse. (${known.note})`,
      );
    } else {
      out.allowed.push(`${f.line}  — known, recorded at ${known.ratio}:1. ${known.note}`);
    }
  }

  for (const k of KNOWN_CONTRAST_FAILURES) {
    if (matched.has(k)) continue;
    if (!sweptKeys.has(`${k.screen}|${k.variant}`)) continue;
    out.stale.push(
      `${k.screen} (${k.variant}) "${k.text}" — recorded at ${k.ratio}:1 but NOT seen in this run. ` +
        "If you fixed it, delete the entry from knownContrastFailures.ts. If the element moved, update it.",
    );
  }

  return out;
}
