import { AlertTriangle, MapPin } from "lucide-react";
import { haversineMiles } from "@/lib/geo";
import { STATUS_IDX } from "@/lib/jobProgressIndex";
import { trackingProofCaption } from "./trackingProofCaption";
import type { JobTrackingModel } from "./JobTracking";

/**
 * The open tracker's one status line under the step row (Q806, 2026-11-05: moved verbatim out of JobTrackingView,
 * DOM unchanged): "Updated 4:12 PM" with its proof clause and ETA while a tracking row exists, else the settled
 * arrival's fallback line while Arrived is the current step.
 */
export function TrackingStatusLine({
  tracking,
  currentArrivalState,
  jobLatitude,
  jobLongitude,
  arrivalOnMap,
  jobStamps,
  settledArrivalLabel,
  displaySteps,
  displayIdx,
}: Pick<JobTrackingModel, "tracking" | "currentArrivalState" | "jobLatitude" | "jobLongitude" | "arrivalOnMap" | "jobStamps" | "settledArrivalLabel" | "displaySteps" | "displayIdx">) {
  return (
    <>
      {/* Last update — directly below the step row (used to sit below the
          removed progress bar; the freshness stamp still closes the tracker
          it vouches for). */}
      {tracking && (
        <p className="text-ds-10 text-muted-foreground text-center">
          {/* NO NAME IN FRONT OF "Updated" (owner, 2026-09-16: "remove the
              name to the left of updated"). The stamp used to open with the
              Helpr's first name on the poster's card — "Hallie · Updated 4:12
              PM" — from when the tracker's heading row was dropped and the
              name had to land somewhere. It does not have to land here: the
              expanded card now carries the Helpr as a PersonTile of their own
              (VN-22), so this line was the second print of one name. */}
          Updated {new Date(tracking.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {/* THE PROOF CLAUSE. Derived from `arrivalState()` — the same single
              input as the unverified-arrival toast, the completion gate and
              the DB trigger — so the line can never again say "GPS confirmed"
              directly beneath a toast saying we could not confirm it. See
              `trackingProofCaption` (./trackingProofCaption.ts) for the four states and why the
              distance stays but the word "confirmed" does not.

              Still only rendered when there is something to say: a position to
              report, or an arrival claim from `arrived` onward whose absence of
              a position is itself the fact. */}
          {(() => {
            const hasPosition = tracking.latitude != null;
            // VN-20: while the map's job pin carries the settled arrival, this
            // line keeps the location and drops the verification clause.
            const trackingIdxHere =
              STATUS_IDX[tracking.status as keyof typeof STATUS_IDX] ?? -1;
            if (!hasPosition && trackingIdxHere < STATUS_IDX.arrived && currentArrivalState === "none") {
              return null;
            }
            const mi =
              hasPosition &&
              jobLatitude != null &&
              jobLongitude != null &&
              tracking.longitude != null
                ? haversineMiles(tracking.latitude!, tracking.longitude, jobLatitude, jobLongitude)
                : null;
            const proof = trackingProofCaption(currentArrivalState, mi, hasPosition, arrivalOnMap, !!jobStamps.arrivalVerifiedAt);
            const Glyph = proof.tone === "warn" ? AlertTriangle : MapPin;
            return (
              <span
                className={`ml-2 inline-flex items-center gap-0.5${proof.tone === "warn" ? " font-semibold" : ""}`}
                style={proof.tone === "warn" ? { color: "hsl(var(--amber-ink))" } : undefined}
              >
                <Glyph className="w-2.5 h-2.5 shrink-0" />
                {proof.text}
              </span>
            );
          })()}
          {/* ETA, moved here off the "On the way" step (owner, 2026-09-11:
              "move 12 min into the line below"). Same guard as before — only
              while the helper is genuinely en route and the server has an
              estimate — so this line never carries a stale number once they
              have arrived. `tabular-nums` keeps the digits from reflowing the
              line as the estimate ticks down. */}
          {tracking?.status === "on_the_way" && tracking.eta_minutes != null && (
            <span
              className="ml-2 inline-flex items-center gap-0.5 tabular-nums font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              ~{tracking.eta_minutes} min
            </span>
          )}
        </p>
      )}

      {/* NO TRACKING ROW, SETTLED ARRIVAL, ARRIVED IS THE CURRENT STEP.
          The status line above only exists once a `job_tracking` row does,
          and the map needs one too — but the arrival stamps live on the jobs
          row (a poster's "Confirm they've arrived", or a job whose tracking row
          was never written). When the Arrived step carried "Poster confirmed"
          itself this case still said something; with that caption moved to
          the map (VN-20) it would have said nothing at all. So the fact gets
          the status line's own slot and wording, scoped to exactly when the
          old caption showed (Arrived is the current step). */}
      {!tracking &&
        settledArrivalLabel != null &&
        displaySteps[displayIdx]?.key === "arrived" && (
          <p
            className="text-ds-10 text-muted-foreground text-center"
            data-testid="arrival-fact-fallback"
          >
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {trackingProofCaption(currentArrivalState, null, false, false, !!jobStamps.arrivalVerifiedAt).text}
            </span>
          </p>
        )}
    </>
  );
}
