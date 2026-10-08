/**
 * Owner, 2026-10-08 (Q1573, job 28f8cff5): "my location actually was shared".
 * A GPS-verified arrival that the poster also confirmed read "Arrival confirmed
 * by the person who posted it · no location shared": the poster's confirm
 * outranked GPS in the arrival state, and Start Working clears the tracker's
 * live position.
 *
 * The class: once the server verified the arrival's location, the caption
 * credits GPS in every branch and never says no location was shared.
 *
 * @mutate src/components/trackingProofCaption.ts |     if (gpsVerified && (state === "confirmed" \|\| state === "verified")) return { text: verifiedClause, tone: "ok" }; |
 * @mutate src/components/trackingProofCaption.ts |       if (gpsVerified) return { text: `${verifiedClause}${suffix}`, tone: "ok" }; |
 */
import { describe, expect, it } from "vitest";
import { trackingProofCaption } from "@/components/trackingProofCaption";

describe("a GPS-verified arrival is credited on the tracker caption", () => {
  it("the owner's case: verified + poster-confirmed, no live position", () => {
    const c = trackingProofCaption("confirmed", null, false, false, true);
    expect(c.text).toBe("Arrival GPS-verified and confirmed by the person who posted it");
    expect(c.text).not.toMatch(/no location shared/);
  });
  it("verified + confirmed with a live position keeps the distance", () => {
    expect(trackingProofCaption("confirmed", 3.2, true, false, true).text).toBe(
      "Arrival GPS-verified and confirmed by the person who posted it · last ping 3.2 mi from job",
    );
  });
  it("verified alone, no live position", () => {
    expect(trackingProofCaption("verified", null, false).text).toBe("Arrival GPS-verified");
  });
  it("a poster's confirm with NO GPS verification still says so", () => {
    expect(trackingProofCaption("confirmed", null, false, false, false).text).toBe(
      "Arrival confirmed by the person who posted it · no location shared",
    );
  });
});
