import { RefreshCw } from "lucide-react";
import { JobCardMetaRow } from "@/components/job-card/JobCardMetaRow";
import { formatRecurrenceInterval } from "@/lib/format";
import { listingExpiryShown } from "./crewRefill";
import type { PostedJobCardProps } from "./types";

/* Moved out of PostedJobCard.tsx unchanged (Q806). */
/**
 * Location · date · time — built ONCE and placed twice.
 *
 * On the desktop website it rides the TITLE row (owner: "move these up to
 * the right of the title to free up space, but only in webpage"): a wide
 * card gave the title a third of one row and this a tenth of the next, so
 * the card spent two rows on what fits comfortably in one. On phone it stays
 * exactly where it was — there is no spare width to move anything into.
 * Same node either way, so the two placements cannot drift apart.
 */
export function PostedJobMetaRow({
  job,
  initialGroupHelpers,
}: {
  job: PostedJobCardProps["job"];
  initialGroupHelpers: PostedJobCardProps["initialGroupHelpers"];
}) {
  return (
    <>
      {/* NO HELPR NAME ROW HERE (owner, 2026-09-14, VN-22: "the person
          working the job should show when it's expanded, not like
          that"). This reverses the earlier "one fact, one treatment"
          ruling that kept a 16px monogram + name link on the collapsed
          card and deferred to the tracker header when expanded. The
          Helpr now appears once, as a PersonTile under the description,
          on the expanded card only. */}
      <JobCardMetaRow
        dateNeeded={job.date_needed}
        dateWindowEnd={job.date_window_end ?? null}
        startTime={job.start_time}
        // The poster's own tick is what licenses the word "Flexible" —
        // the row used to print it for any job with no start time,
        // which is a promise the poster never made. Nothing is shown
        // when there is neither a time nor the flag.
        isFlexibleSchedule={job.is_flexible_schedule}
        flexibleLabel="Flexible time"
        // A job whose poster deleted their account is anonymised, not
        // removed (20260901033011), so it stands with no address. The
        // chip's normaliser already treats "" as absent.
        location={job.location ?? ""}
        // Tap opens the job (board 14), HOLD opens the map (owner:
        // "I keep tapping it on accident"); see JobCardMetaRow.
        locationPressToMap
        /* THE FULL ADDRESS GOES WHERE THE CITY WAS (owner, 2026-09-19,
           pointing at /jobs: "the full address needs to go where the
           city place is"). The poster is always entitled to their own
           job's address — `user_may_see_job_address` lists them first —
           so this is unconditional here, where on the Helpr's card it
           rides the same gate the old address LINE did. */
        showFullAddress
        latitude={job.latitude}
        longitude={job.longitude}
        expiresAt={listingExpiryShown(job, initialGroupHelpers) ? job.expires_at : null}
        // "👥 3", right after the time — the same chip and the same
        // slot the browse feed and the applied card now use.
        helpersNeeded={job.is_group_job ? (job.helpers_needed ?? 2) : null}
        // "View details" costs no row of its own: pinned right of the meta line (~8px, not a 54px row). Its
        // 44px touch target is kept larger than the box (`py-3.5` grows the hit area, `-my-2.5` pulls the
        // layout back); the overhang lands on the card's padding and the status stripe, never another control.
      >
        {/* The applicant COUNT deliberately does not appear here.
            An open job with applicants used to state the same number
            three times inside ~120px of one card: this chip, the state
            pill above it ("2 applicants · pick someone"), and the
            primary "Applicants (2)" button below. The button is the
            one that keeps it — it is the actionable one, and it is
            where a poster goes to act on the number. The pill now says
            only "Pick someone" (see postedActiveState). */}
        {/* The view count is deliberately NOT here either. It was
            stated twice on one card — this chip and the Activity
            panel below the tracker — and the owner's ruling on the
            pair was "show only when applicants is clicked". Both are
            gone; reach now lives solely in the Applicants panel. */}
         {/* Interval word only when the SeriesStrip isn't already
             stating the full shape (owner: less hectic — one series
             statement per card, not two). */}
         {job.is_recurring && !(job.recurrence_days && job.recurrence_days.length > 0) && (
           <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 shrink-0 text-primary" /> {formatRecurrenceInterval(job.recurrence_interval)}</span>
         )}
         {/* The group-size chip is NOT a child any more — it is
             JobCardMetaRow's own `helpersNeeded` prop, which pins it
             directly after the TIME (owner: "3 helprs needed goes to
             the right of time"). As a child it landed last, after the
             recurring chip and the expiry countdown, and the applied
             card stated the same fact in a footer line at the bottom of
             the card. One chip, one position, both surfaces. */}
       </JobCardMetaRow>
    </>
  );
}
