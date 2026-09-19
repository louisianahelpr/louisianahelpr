import { describe, it, expect } from "vitest";
import {
  arrivalState,
  arrivalEvidenceState,
  arrivalEstablished,
  arrivalGateMessage,
  arrivalRefusalFromError,
  arrivalRefusalMessage,
  arrivalVerdictFromRpc,
  arrivalVerdictMessage,
  helperMayStartWorking,
  helperMayMarkDone,
  posterOwesArrivalConfirmation,
  formatArrivalDistance,
  type ArrivalBasis,
} from "./arrivalGate";
import * as shared from "../../supabase/functions/_shared/arrivalRule";

const T = "2026-09-14T10:00:00Z";

/**
 * VN-33 IS SUPERSEDED. THE HISTORY, SO NOBODY RE-DERIVES THE OLD RULE.
 *
 * This file used to assert the VN-33 invariant (owner, 2026-09-14): arrival is
 * established by GPS verification AND the poster's confirmation, "no fallback",
 * and every refusal sentence had to say "both are needed" and must never offer
 * one half as a substitute for the other.
 *
 * THE OWNER REVERSED THAT ON 2026-09-19 (pop-up, verbatim): "but they can not
 * start working until the poster confirms they are there. they shoud be aware
 * of this so they dont try to cheat the system. if gps is not on, they can mark
 * themselves as arrived but can not move on until the poster marks them
 * arrived. so encourgage to turn on gps. but even if gps does confirm they are
 * there the poster still needs ro cfnrm wither way"
 *
 * WHY. VN-33 was enforced by `mark_helper_arrival` REFUSING a far or fix-less
 * arrival and writing nothing at all. `helper_arrived_at` therefore stayed
 * NULL — and the poster's "Confirm They Arrived" control renders only once that
 * stamp exists. So the poster was never offered the tap, while the Helpr's
 * blocked CTA told them to go ask the poster for exactly that tap. The job
 * could not move and neither party had a control that would move it.
 *
 * WHAT THE REVERSAL IS AND IS NOT. It is NOT a return to the pre-VN-33 rule
 * ("verified OR confirmed"), under which GPS alone unlocked wrap-up. GPS alone
 * unlocks nothing now, and the assertions below pin that: the half that cannot
 * be faked — a second human attesting — is required in every case, which is a
 * stronger answer to VN-33's anti-cheat concern than the spoofable half was.
 * The GPS measurement still happens, still gates `helper_arrival_verified_at`,
 * and is still shown to both parties as evidence.
 */
describe("arrivalGate — owner 2026-09-19: the poster confirms, EVERY time", () => {
  it("treats a bare helper claim as NOT established", () => {
    const job = { helper_arrived_at: T };
    expect(arrivalState(job)).toBe("claimed");
    expect(arrivalEstablished(job)).toBe(false);
  });

  it("does NOT accept a server-verified arrival until the poster confirms", () => {
    // Unchanged by the reversal, and the owner said it twice: "even if gps does
    // confirm they are there the poster still needs ro cfnrm wither way".
    const job = { helper_arrived_at: T, helper_arrival_verified_at: T, poster_confirmed_arrival_at: null };
    expect(arrivalState(job)).toBe("verified");
    expect(arrivalEstablished(job)).toBe(false);
  });

  it("DOES accept the poster's confirmation with no verified location (the 2026-09-19 reversal)", () => {
    // THE ASSERTION THIS FILE USED TO MAKE THE OTHER WAY. Under VN-33 this was
    // false, and that is precisely what deadlocked a Helpr whose phone had no
    // fix. If a future edit flips it back, the deadlock is back.
    const job = { helper_arrived_at: T, helper_arrival_verified_at: null, poster_confirmed_arrival_at: T };
    expect(arrivalState(job)).toBe("confirmed");
    expect(arrivalEstablished(job)).toBe(true);
    expect(arrivalEstablished({ poster_confirmed_arrival_at: T })).toBe(true);
  });

  it("accepts a near-miss arrival on the poster's confirmation alone", () => {
    const j = { helper_arrived_at: T, helper_arrival_near_miss_at: T, poster_confirmed_arrival_at: T };
    expect(arrivalEstablished(j)).toBe(true);
  });

  it("is not established when nothing has happened", () => {
    expect(arrivalEstablished({})).toBe(false);
    expect(arrivalEstablished(null)).toBe(false);
    expect(arrivalState(undefined)).toBe("none");
  });

  it("never lets evidence alone unlock anything", () => {
    // The whole point of keeping GPS: it proves something, it grants nothing.
    for (const job of [
      { helper_arrived_at: T },
      { helper_arrived_at: T, helper_arrival_verified_at: T },
      { helper_arrived_at: T, helper_arrival_near_miss_at: T },
      { helper_arrival_verified_at: T, helper_arrival_near_miss_at: T },
    ]) {
      expect(arrivalEstablished(job), JSON.stringify(job)).toBe(false);
      expect(helperMayStartWorking(job)).toBe(false);
      expect(helperMayMarkDone(job)).toBe(false);
    }
  });

  it("is the SAME predicate create-payment reads (one rule, not two)", () => {
    expect(arrivalEstablished).toBe(shared.arrivalEstablished);
    expect(arrivalGateMessage).toBe(shared.arrivalGateMessage);
    expect(helperMayStartWorking).toBe(shared.arrivalEstablished);
    expect(helperMayMarkDone).toBe(shared.arrivalEstablished);
  });

  it("names the poster's tap in every blocked message, and never offers a way round it", () => {
    const gpsOnly = arrivalGateMessage({ helper_arrived_at: T, helper_arrival_verified_at: T });
    const nearMiss = arrivalGateMessage({ helper_arrived_at: T, helper_arrival_near_miss_at: T });
    const claimed = arrivalGateMessage({ helper_arrived_at: T });
    const none = arrivalGateMessage({});

    for (const m of [gpsOnly, nearMiss, claimed, none]) {
      expect(m).toContain("Confirm They Arrived");
      // The superseded copy. "both are needed" is now false: only one is.
      expect(m).not.toMatch(/both are needed/i);
      // And the reversal must not be mis-shipped as "GPS is enough".
      expect(m).not.toMatch(/works too|either one|that unlocks/i);
    }
    // A Helpr with no fix is told what to do AND that it is not the blocker.
    expect(claimed).toContain("Try My Location Again");
    expect(claimed).toMatch(/checked in/i);
    expect(none).toContain("Mark yourself arrived");
  });

  it("stops asking once the poster has confirmed", () => {
    expect(arrivalGateMessage({ helper_arrived_at: T, poster_confirmed_arrival_at: T })).not.toMatch(/still has to|has to tap/i);
    expect(
      arrivalGateMessage({ helper_arrived_at: T, helper_arrival_verified_at: T, poster_confirmed_arrival_at: T }),
    ).toMatch(/confirmed by your location and by the person who posted/i);
  });

  it("names the door: wrap-up on Done, the next step on Working", () => {
    const job = { helper_arrived_at: T, helper_arrival_verified_at: T };
    expect(arrivalGateMessage(job, "wrap-up")).toContain("mark the job complete");
    expect(arrivalGateMessage(job, "tracker")).toContain("start working");
  });
});

/**
 * THE UI CONTRACT. The four evidence states the reversal makes the UI
 * responsible for telling apart — a claim with no location reads differently
 * from a claim that landed near a possibly-wrong pin — plus the one that
 * unlocks.
 */
describe("arrivalEvidenceState — the four states the UI must distinguish", () => {
  it("separates a fix-less claim from a near miss, which arrivalState cannot", () => {
    const noGps = { helper_arrived_at: T };
    const near = { helper_arrived_at: T, helper_arrival_near_miss_at: T };
    expect(arrivalState(noGps)).toBe("claimed");
    expect(arrivalState(near)).toBe("claimed");
    expect(arrivalEvidenceState(noGps)).toBe("claimed");
    expect(arrivalEvidenceState(near)).toBe("near_miss");
  });

  it("ranks confirmed above verified above near miss above claim", () => {
    expect(arrivalEvidenceState({ helper_arrived_at: T, helper_arrival_verified_at: T, helper_arrival_near_miss_at: T, poster_confirmed_arrival_at: T })).toBe("confirmed");
    expect(arrivalEvidenceState({ helper_arrived_at: T, helper_arrival_verified_at: T, helper_arrival_near_miss_at: T })).toBe("verified");
    expect(arrivalEvidenceState({})).toBe("none");
    expect(arrivalEvidenceState(null)).toBe("none");
  });

  it("tells the poster's card when it owes the tap", () => {
    expect(posterOwesArrivalConfirmation({ helper_arrived_at: T })).toBe(true);
    // The deadlock in one assertion: a fix-less check-in is still owed a tap.
    expect(posterOwesArrivalConfirmation({ helper_arrived_at: T, helper_arrival_verified_at: null })).toBe(true);
    expect(posterOwesArrivalConfirmation({ helper_arrived_at: T, poster_confirmed_arrival_at: T })).toBe(false);
    expect(posterOwesArrivalConfirmation({})).toBe(false);
  });
});

/**
 * `mark_helper_arrival` (20260919155016) records an arrival on every call and
 * returns a verdict instead of raising. These pin the shape the UI lane reads.
 */
describe("the arrival verdict from mark_helper_arrival", () => {
  const verdict = (over: Record<string, unknown> = {}) =>
    arrivalVerdictFromRpc({
      arrival_recorded: true,
      arrived_at: T,
      verified: false,
      basis: "no_location",
      distance_ft: null,
      poster_confirmed: false,
      poster_confirmation_required: true,
      arrival_established: false,
      ...over,
    });

  it("reads a fix-less check-in as RECORDED, not refused", () => {
    const v = verdict()!;
    expect(v.arrivalRecorded).toBe(true);
    expect(v.verified).toBe(false);
    expect(v.basis).toBe("no_location");
    expect(v.posterConfirmationRequired).toBe(true);
    expect(v.arrivalEstablished).toBe(false);
  });

  it("reads a GPS-verified check-in, which still owes the poster's tap", () => {
    const v = verdict({ verified: true, basis: "gps_verified", distance_ft: 120 })!;
    expect(v.verified).toBe(true);
    expect(v.distanceFt).toBe(120);
    expect(v.posterConfirmationRequired).toBe(true);
    expect(v.arrivalEstablished).toBe(false);
  });

  it("reads an already-confirmed arrival as established", () => {
    const v = verdict({ basis: "already_confirmed", poster_confirmed: true, poster_confirmation_required: false, arrival_established: true })!;
    expect(v.arrivalEstablished).toBe(true);
    expect(v.posterConfirmationRequired).toBe(false);
  });

  it("returns null for a body it cannot read — a null error is not a write", () => {
    expect(arrivalVerdictFromRpc(null)).toBeNull();
    expect(arrivalVerdictFromRpc({})).toBeNull();
    expect(arrivalVerdictFromRpc([])).toBeNull();
    expect(arrivalVerdictFromRpc({ basis: "something_else" })).toBeNull();
    expect(arrivalVerdictFromRpc("ok")).toBeNull();
  });

  it("every basis has a sentence, and every unconfirmed one names the poster's tap", () => {
    const bases: ArrivalBasis[] = [
      "gps_verified",
      "no_job_coordinates",
      "near_miss",
      "too_far",
      "no_location",
      "location_invalid",
      "already_verified",
      "already_confirmed",
    ];
    for (const basis of bases) {
      const v = verdict({ basis, distance_ft: basis === "near_miss" || basis === "too_far" ? 900 : null })!;
      const copy = arrivalVerdictMessage(v);
      expect(copy, basis).toBeTruthy();
      // Nothing may tell a Helpr the check-in failed — it never does now.
      expect(copy, basis).not.toMatch(/couldn't (mark|check) you|too far from the job — get closer|get within 500/i);
      if (basis !== "already_confirmed") {
        expect(copy, basis).toContain("Confirm They Arrived");
      }
    }
  });

  it("encourages Location without ever making it the gate", () => {
    const noGps = arrivalVerdictMessage(verdict({ basis: "no_location" })!);
    expect(noGps).toMatch(/Location on/i);
    expect(noGps).toContain("Confirm They Arrived");
    expect(noGps).toMatch(/checked in/i);
  });
});

describe("legacy refusal parsing (pre-20260919155016 servers and queued errors)", () => {
  it("still reads the distance out of an arrival_too_far error", () => {
    const r = arrivalRefusalFromError({ message: "arrival_too_far", details: "distance_ft=11081180" });
    expect(r).toEqual({ kind: "too_far", distanceFt: 11081180 });
  });

  it("still reads a missing or invalid location", () => {
    expect(arrivalRefusalFromError({ message: "arrival_location_required" })).toEqual({ kind: "no_location" });
    expect(arrivalRefusalFromError({ message: "arrival_location_invalid" })).toEqual({ kind: "no_location" });
  });

  it("does not mistake any other error for a refusal", () => {
    expect(arrivalRefusalFromError({ message: "not_the_assigned_helper" })).toBeNull();
    expect(arrivalRefusalFromError({ message: "Failed to fetch" })).toBeNull();
    expect(arrivalRefusalFromError(null)).toBeNull();
  });

  it("formats feet under a tenth of a mile, miles above", () => {
    expect(formatArrivalDistance(510)).toBe("510 ft");
    expect(formatArrivalDistance(640)).toBe("0.1 mi");
    expect(formatArrivalDistance(5280 * 3.24)).toBe("3.2 mi");
    expect(formatArrivalDistance(5280 * 2091.4)).toBe("2091 mi");
  });

  it("the REFUSAL path says the check-in did not happen, and promises no poster tap", () => {
    // This function runs on ONE path only: mark_helper_arrival raised, so it
    // wrote NOTHING. Since 20260919155016 the live RPC raises none of these —
    // but Vercel ships the bundle independently of db-deploy, so between a push
    // and the migration landing, prod is still the VN-33 definition that
    // refuses.
    //
    // Browser verification on 2026-09-19 caught the copy promising the opposite
    // ("You're still checked in", "the person who posted this job has to tap
    // Confirm They Arrived") while helper_arrived_at stayed NULL — so the
    // poster's control rendered DISABLED and each side was told to wait for the
    // other. That is the deadlock this batch removed, rebuilt out of reassuring
    // words. The assertions below are inverted from the pre-fix version ON
    // PURPOSE: naming the poster's tap is right for a RECORDED arrival and
    // wrong here, because there is nothing for the poster to confirm.
    const all = [
      arrivalRefusalMessage({ kind: "denied" }),
      arrivalRefusalMessage({ kind: "no_location" }),
      arrivalRefusalMessage({ kind: "too_far", distanceFt: 1490 }),
      arrivalRefusalMessage({ kind: "too_far", distanceFt: null }),
    ];
    for (const copy of all) {
      // Never claim the check-in landed.
      expect(copy).not.toMatch(/still checked in|you're checked in|checked in either way/i);
      // Never send them to a poster control that cannot exist in this state.
      expect(copy).not.toContain("Confirm They Arrived");
      // Say plainly that it did not happen, and give the one way forward.
      expect(copy).toMatch(/couldn't check you in/i);
      expect(copy).toContain("Try My Location Again");
      // And never re-introduce VN-33's dead end.
      expect(copy).not.toMatch(/has to show you at the job to mark arrived|can't mark arrived/i);
    }
    // Through the formatter, not a hardcoded string: 1490 ft renders as miles,
    // and pinning the literal would just re-encode the formatter's rule badly.
    expect(arrivalRefusalMessage({ kind: "too_far", distanceFt: 1490 }))
      .toContain(formatArrivalDistance(1490));
  });
});

describe("server refusal copy (lifecycleErrors) — one stamp, named plainly", () => {
  it("maps the surviving arrival/completion refusals to copy that names the poster's tap", async () => {
    const { lifecycleErrorMessage, RPC_ERROR_COPY } = await import("./lifecycleErrors");
    for (const code of ["completion_requires_confirmed_arrival", "tracker_requires_arrival"]) {
      const copy = lifecycleErrorMessage({ message: code });
      expect(copy, code).toBeTruthy();
      expect(copy!, code).toContain("Confirm They Arrived");
      // The superseded rule, in the copy the server's HINT mirrors.
      expect(copy!, code).not.toMatch(/both are needed/i);
    }
    // The three location refusals went with the RAISEs that produced them
    // (20260919155016). rpcErrorCopyCoverage forbids copy for a code the RPC
    // no longer raises; this says the same thing from the other side.
    const arrival = RPC_ERROR_COPY.mark_helper_arrival as Record<string, string>;
    for (const gone of ["arrival_too_far", "arrival_location_required", "arrival_location_invalid"]) {
      expect(arrival[gone], `${gone} is copy for a refusal the server cannot raise`).toBeUndefined();
    }
  });
});
