/**
 * Pure, side-effect-free helpers for the Post-a-Task form.
 *
 * Everything here is React-free and independently testable — the
 * orchestration and anything that needs hook closures stays in
 * usePostJobForm.ts and its sub-hooks.
 */

/**
 * Parses a stored `location` string ("street, city, ST zip") back into the
 * discrete address fields. Used by both the one-tap rebook loader and the
 * draft restore path, which historically had identical inline parsing.
 *
 * When the string has fewer than 3 comma-separated parts we can't confidently
 * split it, so the whole value is returned as the street address and the other
 * fields are left untouched (the caller decides how to apply them).
 */
export interface ParsedLocationFields {
  streetAddress: string;
  city?: string;
  addrState?: string;
  zipCode?: string;
}

export function parseLocationIntoFields(location: string | null | undefined): ParsedLocationFields {
  const locParts = (location || "").split(", ");
  if (locParts.length >= 3) {
    const stateZip = locParts[2].split(" ");
    return {
      streetAddress: locParts[0],
      city: locParts[1],
      addrState: stateZip[0] || "",
      zipCode: stateZip.slice(1).join(" ") || "",
    };
  }
  return { streetAddress: location || "" };
}

/**
 * When the poster opted into "I'll provide materials", append the note into
 * special_requirements with a tagged prefix so helprs can see it on the job
 * card. Avoids a schema migration for what's effectively a label on a freeform
 * note.
 */
export function composeSpecialRequirements(opts: {
  includeMaterials: boolean;
  materialsNote: string;
  specialRequirements: string;
}): string {
  const { includeMaterials, materialsNote, specialRequirements } = opts;
  if (!includeMaterials || !materialsNote.trim()) return specialRequirements;
  const prefix = `Materials I'll provide: ${materialsNote.trim()}`;
  return specialRequirements.trim() ? `${prefix}\n\n${specialRequirements.trim()}` : prefix;
}

/**
 * Budget presets derived from a category's suggested range. Snaps each preset
 * to the nearest $25 ($25 floor) so the quick-tap pills read as clean round
 * numbers instead of raw market values like $38. A bump pass keeps the three
 * values distinct and ascending when two snap to the same multiple (e.g.
 * 38 & 60 → 50 & 50 → 50 & 75). Falls back to [25, 50, 75] when no range.
 */
export function computeBudgetPresets(
  presetRange: { min: number; max: number } | null,
  priceStatsMedian: number | null | undefined,
): number[] {
  if (!presetRange) return [25, 50, 75];
  const snap25 = (n: number) => Math.max(25, Math.round(n / 25) * 25);
  const raw = [
    presetRange.min,
    priceStatsMedian ?? Math.round((presetRange.min + presetRange.max) / 2),
    presetRange.max,
  ]
    .map(snap25)
    .sort((a, b) => a - b);
  return raw.reduce<number[]>((acc, v) => {
    const prev = acc[acc.length - 1];
    acc.push(prev != null && v <= prev ? prev + 25 : v);
    return acc;
  }, []);
}

/**
 * Scroll the first invalid field into view so the user can see it even on a
 * small screen (SE: 375×667, ~550px usable). Uses the element's native `id`
 * attribute — every form field already has one. Focuses after scrolling when
 * the element is focusable (inputs / textareas); non-focusable targets (divs
 * used as scroll anchors) get scroll-only. `block: "center"` keeps the label
 * visible above the field.
 */
export function scrollToField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof (el as HTMLInputElement).focus === "function" && el.tagName !== "DIV") {
    setTimeout(() => (el as HTMLInputElement).focus(), 350);
  }
}
