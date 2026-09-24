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
 * A 2-part "City, ST" (or "City, ST 70501") is recognised explicitly, because
 * plenty of stored locations have no street — guest posts, older rows, and
 * anything created before the address fields were split apart.
 *
 * Those used to fall through to the catch-all below and land the WHOLE string
 * in `streetAddress`. Because the fallback also leaves city/state/zip alone,
 * they kept whatever was already in the form (the poster's profile defaults),
 * so reposting a "Baton Rouge, LA" job produced a street of "Baton Rouge, LA"
 * next to an unrelated city — and since the submit path recomposes
 * `"{street}, {city}, {state} {zip}"` verbatim, that nonsense was WRITTEN BACK
 * to the job row as "Baton Rouge, LA, Delcambre, LA, 70501". Observed on the
 * checkout Location row while verifying the repost flow.
 *
 * Mapping it to city/state instead leaves `streetAddress` empty, which the
 * submit gate already blocks on with "Add a street address" — the poster is
 * asked for the one field we genuinely don't know, instead of silently
 * shipping a corrupted address.
 *
 * When the string still can't be split confidently the whole value is returned
 * as the street address and the other fields are left untouched (the caller
 * decides how to apply them, keyed off whether `city` came back defined).
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
  // "City, ST" / "City, ST 70501" — no street component.
  if (locParts.length === 2) {
    const stateZip = locParts[1].trim().split(/\s+/);
    if (/^[A-Za-z]{2}$/.test(stateZip[0] ?? "")) {
      return {
        streetAddress: "",
        city: locParts[0].trim(),
        addrState: stateZip[0].toUpperCase(),
        // Deliberately "" rather than leaving the previous value: we are
        // loading ONE specific job's address, so a zip left over from a
        // different address is worse than an empty required field.
        zipCode: stateZip.slice(1).join(" ") || "",
      };
    }
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
  // Five rungs, not three. Three presets (min / median / max) meant a poster
  // whose job sat between two of them — the common case — had to type a number
  // anyway, which is the tap the presets exist to save. Five covers the range
  // at a useful granularity and still wraps to two rows at 375px.
  if (!presetRange) return [25, 50, 75, 100, 150];
  const snap25 = (n: number) => Math.max(25, Math.round(n / 25) * 25);
  const median = priceStatsMedian ?? Math.round((presetRange.min + presetRange.max) / 2);
  const raw = [
    presetRange.min,
    // Quarter points between the floor and the median/ceiling, so the ladder
    // is denser where most jobs actually price.
    Math.round((presetRange.min + median) / 2),
    median,
    Math.round((median + presetRange.max) / 2),
    presetRange.max,
  ]
    .map(snap25)
    .sort((a, b) => a - b);
  // Snapping can collapse neighbours onto the same value (a narrow category
  // range, or a median close to an endpoint). Keep the ladder strictly
  // ascending by nudging duplicates up one $25 step, exactly as before.
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
