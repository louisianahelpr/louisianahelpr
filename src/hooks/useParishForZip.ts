import { useEffect, useRef, useState } from "react";
import { resolveCityByZip, resolveParishByZip, type ParishResolution } from "@/lib/parishLookup";

/**
 * Resolves a ZIP field's parish as the user types, and says which of the four
 * outcomes happened.
 *
 * Signup, CompleteProfile and ProfileEditForm each carried a byte-identical
 * copy of this effect, and each of them dropped the interesting case on the
 * floor: an unresolvable ZIP set `parish` to null and rendered nothing at all.
 * Parish is what places a member who has not granted device location — which is
 * most of them — so that null is the difference between someone the job fan-out
 * reaches and someone it never will. It now has a name (`unknownZip`) that a
 * screen can render, instead of three places independently deciding to stay
 * quiet.
 *
 * `unknownZip` is deliberately false while the lookup itself is failing: we
 * have no evidence the ZIP is wrong in that case, and telling someone their
 * correct address is unrecognised because our RPC broke is worse than silence.
 */
export interface ZipParishState {
  /** The resolved parish, or null for every other outcome. */
  parish: string | null;
  /**
   * True only when a complete 5-digit ZIP was looked up successfully and
   * Louisiana has no such ZIP. Render a warning; do not block.
   */
  unknownZip: boolean;
  /** The raw resolution, for callers that need to tell `incomplete` apart. */
  resolution: ParishResolution;
}

const INCOMPLETE: ParishResolution = { status: "incomplete" };

export function useParishForZip(zipCode: string): ZipParishState {
  const [resolution, setResolution] = useState<ParishResolution>(INCOMPLETE);

  useEffect(() => {
    const cleaned = zipCode.replace(/\D/g, "");
    if (cleaned.length !== 5) {
      setResolution(INCOMPLETE);
      return;
    }
    let cancelled = false;
    resolveParishByZip(cleaned).then((r) => { if (!cancelled) setResolution(r); });
    return () => { cancelled = true; };
  }, [zipCode]);

  return {
    parish: resolution.status === "resolved" ? resolution.parish : null,
    unknownZip: resolution.status === "unknown-zip",
    resolution,
  };
}

/**
 * The one sentence every ZIP field shows for an unrecognised ZIP. Shared so the
 * three surfaces cannot drift into three different explanations of the same
 * thing. Deliberately does NOT say "invalid": an out-of-state ZIP is a real ZIP,
 * it is just not one this Louisiana-only app can place.
 */
export const UNKNOWN_ZIP_MESSAGE =
  "We don't recognise that as a Louisiana ZIP code. Jobs are matched by parish, " +
  "so double-check it — otherwise nearby work won't reach you.";

/**
 * A3-I1 (app audit 2026-10-28): a recognised ZIP fills an EMPTY town field
 * (City at signup, Area on the profile) with the ZIP's town. A town the member
 * typed is never replaced, and once a ZIP has filled the field, clearing it does
 * not bring the town back for that same ZIP. Used by every ZIP + town form:
 * Signup, CompleteProfile, ProfileEditForm.
 */
export function useZipFillsTown(zipCode: string, town: string, setTown: (town: string) => void): void {
  const filledFor = useRef<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCity(null);
    void resolveCityByZip(zipCode).then((c) => { if (!cancelled) setCity(c); });
    return () => { cancelled = true; };
  }, [zipCode]);
  useEffect(() => {
    if (!city || filledFor.current === city) return;
    filledFor.current = city;
    if (!town.trim()) setTown(city);
  }, [city, town, setTown]);
}
