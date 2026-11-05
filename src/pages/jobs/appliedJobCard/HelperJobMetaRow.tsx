import { JobCardMetaRow } from "../../../components/job-card/JobCardMetaRow";
import type { Job } from "../../../components/job-card/activityConstants";

  /**
   * Location · date · time — built once, placed twice. Desktop puts it on the
   * TITLE row; phone keeps it below. Mirrors PostedJobCard exactly, which is
   * the point: these two cards sit in the same two tabs of the same screen.
   */
export function HelperJobMetaRow({ job, isOffered, isConfirmed, isActive, isDisputed, isExpanded, isPending }: {
  job: Job; isOffered: boolean; isConfirmed: boolean; isActive: boolean; isDisputed: boolean; isExpanded: boolean; isPending: boolean;
}) {
  return (
    <>
      {/* Who posted the job is NOT drawn in this little meta area any more.
          It is shown as a PersonTile UNDER the description when the card is
          expanded (owner V6, 2026-09-15: "same as the poster side") — matching
          VN-22, which moved the Helpr's profile out of exactly this spot into a
          tile under the description on the poster card, so the two cards state
          the other party the same way. See the PersonTile in the body below. */}
      <JobCardMetaRow
        dateNeeded={job.date_needed} dateWindowEnd={job.date_window_end ?? null}
        startTime={job.start_time}
        /* An anonymised job carries no address (see `posterId` above); the
           location chip's own normaliser already treats "" as absent. */
        location={job.location ?? ""}
        /* TAP EXPANDS, HOLD OPENS THE MAP — the same prop PostedJobCard has
           carried since 2026-09-14, now on this card too.
           (Owner, 2026-09-21, pointing at a /jobs card: "any time i click
           in this job card, it opens apple maps. ths is not correct.")

           WHY IT WAS SO EASY TO HIT HERE, with the arithmetic. The location
           slot was an `<a href="https://maps.apple.com/…">`, and once
           `showFullAddress` below is true the location takes `basis-full` — a
           line of its own inside the wrapping meta row. That class lands on
           the ANCHOR, so the link box became the whole row: measured on prod
           (helper-e2e, Chromium at 375, this checkout's build) every card was
           301x139 with a live 267x32 maps anchor in it — 89% of the card's
           width, directly under the title, painted exactly like the plain date
           text beside it. 15% of the card's in-viewport area left the app. The
           same probe on /posts scored 0%, because My Posts already had this
           prop; the note on it says "opt-in per card so My Jobs is untouched",
           and untouched is what the owner is reporting.

           The stopPropagation guards on the maps controls were never going to
           help: propagation is what makes the CARD also toggle when the map
           opens. An anchor's own default action is the navigation, so the card
           tap never reached the card — it activated a link.

           What the prop changes: the visible element becomes a <button> that
           does not stop the click, so JobCardShell's wrapper onClick expands
           the card exactly as a tap anywhere else on it does, and the map
           moves behind a deliberate 500ms hold plus the focus-only anchor that
           keyboard and screen-reader users already had. Directions are not
           lost either way — DirectionsButton is a real control in the action
           row of every state that needs it. Guarded by
           AppliedJobCard.locationTapExpands.test.tsx (contract) and
           e2e/prod-audit/card-maps-hit-area.spec.ts (the geometry). */
        locationPressToMap
        /* THE FULL ADDRESS TAKES THE CITY'S PLACE (owner, 2026-09-19, with a
           screenshot of /jobs: "this shouldnt show 2 addresses... the full
           address needs to go where the city place is. not be on a whole
           nother line").

           The card used to print BOTH - `getCity(location)` in this row, and
           the whole street address again on a row of its own below it
           (`JobAddressLine`, VN-55). That second row is deleted and its
           condition moved here VERBATIM: the same four states, so nothing is
           newly revealed and nothing that was visible is lost.

           WHY A CLIENT GATE AT ALL, when the server already masks. It is not
           an entitlement check - `get_jobs_for_my_applications` rewrites
           `location` through `user_may_see_job_address` and hands a pending
           applicant "City, ST" - it is the SECOND lock this card has always
           had. Until today the meta row could only ever print a city, so a
           server that leaked could not leak through it; printing `location`
           whole removes that. Keeping the old mount's condition keeps it.
           src/test/enRouteAddressVisible.test.tsx pins both halves. */
        showFullAddress={isOffered || isConfirmed || isActive || isDisputed} oneLine={!isExpanded}
        latitude={job.latitude}
        longitude={job.longitude}
        expiresAt={isPending && !job.helper_id ? job.expires_at : null}
        /* "👥 3", inline right after the time (owner, 2026-08-30: "3 helprs
           needed goes to the right of time"). It used to be a line of its own
           at the very BOTTOM of the card, under the Edit/Withdraw row, in the
           photos/recurring footer — a fact about the JOB stranded below the
           helper's own actions, reading like small print. The browse feed
           already stated it in the meta row; this is the same chip, in the
           same place, on both surfaces. */
        helpersNeeded={job.is_group_job ? (job.helpers_needed ?? 2) : null}
      />
    </>
  );
}
