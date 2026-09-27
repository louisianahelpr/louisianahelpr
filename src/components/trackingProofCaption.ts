import type { ArrivalState } from "@/lib/arrivalGate";

/**
 * "GPS confirmed · 1792 mi from job" — the caption the owner screenshotted, one
 * line under a toast that said we could NOT confirm the arrival.
 *
 * The old string was gated on `tracking.latitude` — i.e. on having a position
 * fix AT ALL — and every one of its three branches opened with the word
 * "confirmed". A fix taken 1792 miles from the job site therefore rendered as
 * proof of arrival. That is not a wording slip: "confirmed" is the word this
 * app uses for evidence that unlocks a payout, and the caption was spending it
 * on a raw coordinate read.
 *
 * So the caption is now derived from the SAME `arrivalState()` the toast, the
 * completion gate and the DB trigger read (`src/lib/arrivalGate.ts`) — they
 * cannot disagree again, because there is only one input:
 *
 *   confirmed — the poster vouched. A second party attesting.
 *   verified  — the server itself computed the helper within 500ft.
 *   claimed   — the helper says so and nothing corroborates it. This is the
 *               state in the screenshot, and it now READS as the open question
 *               it is, in amber, with the recourse on the step rail beside it.
 *   none      — no arrival claimed yet. A distance is still useful here (it is
 *               "how far away are they"), but it proves nothing, so the line
 *               says "Location shared", never "confirmed".
 *
 * The distance is kept in every branch — it is the most useful fact on the line
 * — but it is stated as the LAST PING, which is what it is, and it never
 * carries the word "confirmed" on its own.
 *
 * WHEN THE MAP ALREADY SAYS IT (owner, 2026-09-14, VN-20: "Location confirmed
 * … should be on the map"). A settled arrival — verified or confirmed — is now
 * drawn as a label on the map's job pin. While that map is on screen, this
 * line saying "Arrival GPS-verified" / "Arrival confirmed by the person who posted it" a few pixels
 * above it is the same fact twice, so `arrivalShownOnMap` drops ONLY that
 * clause and keeps the location part ("Location shared · 3.2 mi from job").
 * With no map drawn (no coordinates, or past the en-route step) the clause
 * stays here — this line is then the only place the fact appears.
 */
export type TrackingProofCaption = {
  text: string;
  /** `warn` paints amber: the line is reporting a problem, not vouching. */
  tone: "ok" | "warn" | "muted";
};

/** Display twin of the server's 500ft verification radius (0.1 mi ≈ 528ft). */
const AT_JOB_MI = 0.1;

export function trackingProofCaption(
  state: ArrivalState,
  /** Miles between the last ping and the job, or `null` when either end has no
   *  coordinates to measure against. */
  distanceMi: number | null,
  /** Did the last tracking row carry a position at all? */
  hasPosition: boolean,
  /** Is the map rendering this arrival as a label on its job pin? See above. */
  arrivalShownOnMap = false,
): TrackingProofCaption {
  // NO "at the job" CLAUSE (owner, 2026-09-16: "remove the at the job text").
  // A ping inside the verification radius now says NOTHING about where — the
  // clause is dropped exactly as the no-distance branches already drop it, so
  // "Arrival GPS-verified · last ping at the job" reads "Arrival GPS-verified"
  // and no dangling "·" is left behind (every consumer below builds the
  // separator from `where`, never around it). The DISTANCE branch stays: the
  // owner named only the "at the job" phrasing, and "1792 mi from job" is the
  // headline fact this caption exists for.
  const where =
    !hasPosition || distanceMi == null || distanceMi < AT_JOB_MI
      ? null
      : `${distanceMi < 10 ? distanceMi.toFixed(1) : Math.round(distanceMi)} mi from job`;

  // No position at all. The absence is stated rather than left blank — a
  // self-reported arrival that rendered identically to a GPS-confirmed one
  // would be the app quietly overstating what it knows.
  if (!hasPosition) {
    switch (state) {
      case "confirmed":
        return { text: "Arrival confirmed by the person who posted it · no location shared", tone: "ok" };
      case "verified":
        return { text: "Arrival GPS-verified · no location shared", tone: "ok" };
      case "claimed":
        return { text: "Arrival not confirmed · no location shared", tone: "warn" };
      default:
        return { text: "Location not shared", tone: "muted" };
    }
  }

  const suffix = where ? ` · last ping ${where}` : "";
  // The map's job pin is carrying the verification clause; keep the location.
  if (arrivalShownOnMap && (state === "confirmed" || state === "verified")) {
    return { text: where ? `Location shared · ${where}` : "Location shared", tone: "ok" };
  }
  switch (state) {
    // The poster's vouch outranks GPS, so a long distance is not a
    // contradiction here — the person standing next to the helper said yes.
    // It is still shown, because hiding it would be the same sin in reverse.
    case "confirmed":
      return { text: `Arrival confirmed by the person who posted it${suffix}`, tone: "ok" };
    // Verified is a statement about the MOMENT OF ARRIVAL, not about where the
    // helper is now — stepping away from a site mid-job is normal and is the
    // exact false-positive the arrival gate was built to stop punishing.
    case "verified":
      return { text: `Arrival GPS-verified${suffix}`, tone: "ok" };
    // THE SCREENSHOT. Never "confirmed"; amber; and the distance is stated
    // plainly rather than dressed as proof — 1792 miles is the headline.
    case "claimed":
      return { text: `Arrival not confirmed${where ? ` · ${where}` : ""}`, tone: "warn" };
    default:
      return { text: where ? `Location shared · ${where}` : "Location shared", tone: "muted" };
  }
}
