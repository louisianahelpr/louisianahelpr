import { ClipboardList, Hammer } from "lucide-react";
import { Link } from "react-router-dom";
import { useAgeGate } from "@/hooks/useAgeGate";
import { isExpiredListing } from "@/lib/expiredListing";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { formatShortDate, formatCategory, formatPrice } from "@/lib/format";
import { jobStatusLabel } from "@/lib/statusLabels";
import type { ProfileJob } from "./types";

type Props = {
  jobs: ProfileJob[];
  variant: "posted" | "worked";
  /**
   * How many jobs of this kind EXIST, from `get_public_profile_stats`. Not the
   * same as `jobs.length`: the count is a public aggregate, the rows are `jobs`
   * records that RLS scopes to the two parties — so a visitor who is shown a
   * truthful "3 Jobs completed" tile and taps it can load none of them.
   */
  knownCount?: number;
  /** The signed-in viewer. Only jobs they were a party to are listed. */
  viewerId: string | null;
  /** Hides the "only your jobs are shown" line on your own profile. */
  isOwnProfile?: boolean;
};

/**
 * The rows a viewer may see on a profile: jobs the VIEWER was part of (posted
 * or worked), and nothing else (A3-C8, app audit 2026-10-29).
 *
 * "Jobs posted" said "Helpr keeps the details private" while "Jobs completed"
 * listed job titles, dates and prices. The rows come from `jobs`, whose RLS
 * (read on prod 2026-10-29: own jobs, selected helpers, a pending direct
 * offer, admins) already scopes a member to jobs they are part of; on the
 * audited profile every listed job was the viewer's own. But an admin, or a
 * crew mate admitted by user_may_see_job_address, could be shown jobs between
 * OTHER people. Filtering on the parties makes the rule the page states true
 * for every viewer: no other person's job titles or prices on a public
 * profile. On your own profile every row is yours.
 */
export function jobsViewerWasPartOf(jobs: ProfileJob[], viewerId: string | null): ProfileJob[] {
  if (!viewerId) return [];
  return jobs.filter((j) => j.customer_id === viewerId || j.helper_id === viewerId);
}

export const JobsList = ({ jobs: allRows, variant, knownCount = 0, viewerId, isOwnProfile = false }: Props) => {
  // Repost opens Post a job: the same under-18 gate as every Post a job entry (Q1586(c)).
  const { underAge, explain, gatedProps } = useAgeGate();
  const jobs = jobsViewerWasPartOf(allRows, viewerId);
  // Some of this person's jobs exist but are not listed: say so, the same way
  // on both tiles, instead of listing some and withholding others silently.
  const moreWithheld = !isOwnProfile && jobs.length > 0 && knownCount > jobs.length;
  const EmptyIcon = variant === "posted" ? ClipboardList : Hammer;
  /* AN EMPTY LIST MEANS TWO DIFFERENT THINGS, and this panel used to say the
     wrong one. "No completed jobs yet" printed under a tile reading "3 Jobs
     completed" is not a soft edge case — it is the page contradicting itself
     in two adjacent elements, the same failure as "New · No reviews yet" beside
     "100% Clients who rebooked".

     Nothing here changes what is withheld. Who hired whom, job titles and
     addresses stay private, deliberately — a sibling lane spent today closing
     an address leak. What changes is that the page now says it is withholding
     them rather than reporting them as an absence of work. */
  const withheld = jobs.length === 0 && knownCount > 0;
  const emptyCopy = withheld
    ? variant === "posted"
      ? `${knownCount} job${knownCount === 1 ? "" : "s"} posted — Helpr keeps the details private`
      : `${knownCount} job${knownCount === 1 ? "" : "s"} completed — Helpr keeps the details private`
    : variant === "posted"
    ? "No posted jobs yet"
    : "No completed jobs yet";

  return (
    <div className="space-y-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
      {moreWithheld && (
        <p className="text-ds-11 text-muted-foreground px-1" data-testid="profile-jobs-only-yours">
          Only jobs you were part of are shown. Helpr keeps the rest private.
        </p>
      )}
      {jobs.length > 0 ? jobs.map((job) => (
        // p-3, not the card convention's p-5: these are compact repeated list
        // rows (one line of title + meta), and card padding would turn a
        // 20-job history into a wall of mostly-empty tiles.
        <div key={job.id} className="rounded-2xl liquid-glass p-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-ds-13 font-medium text-foreground truncate">{job.title}</p>
            <p className="text-muted-foreground text-ds-11">{formatShortDate(job.created_at)} · {formatCategory(job.category)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-ds-13 font-bold" style={{ color: "hsl(var(--accent-ink))" }}>${formatPrice(job.budget)}</span>
            {isExpiredListing(job) ? (
              // Expired is not cancelled (owner 10-31): never "Cancelled"; only
              // its poster sees it, with Repost.
              <>
                <span className="text-ds-10 font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Expired</span>
                {job.customer_id === viewerId && (
                  <Link
                    to={`/post-job?rebook=${job.id}`}
                    {...gatedProps("post")}
                    onClick={(e) => {
                      if (!underAge) return;
                      e.preventDefault();
                      explain("post");
                    }}
                    className="text-ds-11 font-semibold underline underline-offset-2" style={{ color: "hsl(var(--accent-ink))" }}>
                    Repost
                  </Link>
                )}
              </>
            ) : (
              <span className={`text-ds-10 font-semibold px-2 py-0.5 rounded-full ${jobStatusColorClasses(job.status)}`}>{jobStatusLabel(job.status)}</span>
            )}
          </div>
        </div>
      )) : (
        // p-6 over p-5: icon-over-caption empty state, matching ReviewsSection.
        <div className="rounded-2xl liquid-glass p-6 text-center">
          <EmptyIcon className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-ds-11 text-muted-foreground max-w-[46ch] mx-auto">{emptyCopy}</p>
          {withheld && (
            <p className="text-ds-11 text-muted-foreground mt-1">
              Who hired whom stays between them.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
