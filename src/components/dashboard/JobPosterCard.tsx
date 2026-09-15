import { hasPerk, tierDisplayName } from "@/lib/subscriptionTiers";
import { tierBadgeStyle } from "@/lib/tierBadgeStyle";
import { TrustRow } from "@/components/TrustRow";
import { PersonTile } from "@/components/PersonTile";
import type { EnrichedJob } from "./types";

interface JobPosterCardProps {
  /** The job whose poster is shown. */
  job: EnrichedJob;
  /** Completed jobs between the current helper and this poster. */
  repeatJobs: number;
  /** Logged-out viewer. Sends the tile to /signup instead of a profile that
   *  guests can't open anyway. */
  guest?: boolean;
}

/**
 * JobPosterCard — the "Posted by" mini-profile tile in JobDetailDialog:
 * avatar, name, rating, and the trust-signal row (ID-verified, Pro/Elite
 * poster, repeat customer). POSTER-side and account-level signals only —
 * never the helper career ladder; see the note in the body.
 *
 * Extracted verbatim from JobDetailDialog.tsx.
 */
export function JobPosterCard({ job, repeatJobs, guest = false }: JobPosterCardProps) {
  // Nothing to show. The guest /jobs feed comes from `get_ranked_open_jobs`,
  // whose RETURNS TABLE has no `customer_id` — so this tile rendered with a
  // blank name, a "U" fallback avatar, and a link to a literal `/user/` with no
  // id. An empty shell pointing at a dead route is worse than no tile, so it is
  // omitted entirely rather than dressed up. (/jobs/:id reads
  // `open_jobs_browse`, which DOES return customer_id, so the tile still shows
  // there with real content.)
  if (!job.customer_id) return null;

  /* NO `computeBadges` HERE ANY MORE. Owner, 2026-09-11: badges must say which
     capacity they were earned in, and this tile is about the person AS A
     POSTER. Passing no `helprTier` meant the only group this call could render
     was the helper performance group — "Trusted", "On Fire", "Fast Responder",
     "Community Fav" — helper-career language printed beside the words "Posted
     by". That group was deleted from the public profile the same day
     (69135b1f2), so this tile was also the last surface where a reader could
     meet it, on the one screen where it was least true.

     It was mostly dead on top of that: `posterCompletedJobs` is hardcoded to 0
     at every call site that builds an `EnrichedJob` (useDashboardData.ts:455,
     DashboardGuest.tsx:320, JobDetail.tsx) — no query supplies it — so the
     three job-count badges could never fire and only "Highly Rated" /
     "Community Fav" ever reached the screen.

     What replaces it is what is REAL and poster-side or account-level:
     the paid tier and the repeat-hire relationship. (`posterIdVerified` was a
     third signal here until owner, 2026-09-14 moved the ID-verified pill to
     the profile only — VN-1.) */
  const posterInitials = (job.posterName || "User")
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  // Any paying tier opens the trust row. This was a literal
  // elite/pro/basic list and it dropped Plus (CC-019), so a $15/mo poster's
  // tile rendered as if they were on the free plan.
  const posterTierBadge = tierBadgeStyle(job.posterSubscriptionTier);
  const hasTier = hasPerk(job.posterSubscriptionTier, "tierBadge");
  /* THE RATING IS PRINTED ONCE, BESIDE THE NAME.
     It used to be printed twice in this one tile: "★ 4.8 (5)" inline next to
     the poster's name, and "4.8★ (5)" again in the TrustRow directly below it
     — same number, two different formats, ~20px apart. The inline one wins
     because it is the one attached to the person it describes; TrustRow's copy
     was `hasReviews` (>=3 reviews) being passed straight through as
     `avgRating`/`reviewCount`, which is the same fact a second time rather
     than a second signal.
     `hasReviews` went with it: reviews alone no longer justify opening the
     trust row, or a poster with reviews and nothing else would get an empty
     bordered band under their name. */
  // NO ID-VERIFIED CHIP ON THIS TILE (owner, 2026-09-14, VN-1: "id verified
  // does not need to show here. only in their profile"). The pill lives on the
  // poster's profile (RecognitionRow) only, so it no longer opens the trust
  // row either — otherwise a verified poster with no tier and no repeat jobs
  // would get an empty bordered band under their name.
  const showTrustRow = hasTier || repeatJobs >= 2;

  return (
    /* The tile itself is the shared PersonTile (lifted out of this file with
       its markup unchanged, owner 2026-09-14 VN-22), so the poster's Posts card
       can show its Helpr the same way. */
    <PersonTile
      userId={job.customer_id}
      // Guests can't open a profile — /user/:id is behind auth — so the tap
      // goes where it can actually lead somewhere.
      to={guest ? "/signup" : `/user/${job.customer_id}`}
      name={job.posterName}
      avatarUrl={job.posterAvatarUrl}
      initials={posterInitials}
      eyebrow="Posted by"
      rating={job.posterAvgRating}
      reviewCount={job.posterReviewCount}
      subline={
        (job.posterCompletedJobs ?? 0) > 0 && (
          <p className="font-sans text-ds-11 leading-tight" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {job.posterCompletedJobs} {job.posterCompletedJobs === 1 ? "job" : "jobs"}
          </p>
        )
      }
    >
      {/* Trust signal row — poster tier (Pro/Elite) is rendered inline;
          poster-data signals (Trusted, Worked together) go through the
          shared TrustRow component. Hidden entirely when a poster has no
          tier and no trust data, so new posters don't get an empty band. */}
      {showTrustRow && (
        <div
          className="flex items-center justify-center gap-3 mt-2 pt-2"
          style={{
            borderTop: "0.5px solid hsl(var(--bark) / 0.12)",
          }}
        >
          {/* ONE derived badge, not a per-tier chain. The three hand-written
              blocks this replaces covered elite/pro/basic only, so a Plus
              poster opened the trust row and then rendered nothing in it
              (CC-019). Treatment comes from tierBadgeStyle, which every tier
              badge in the app now reads. */}
          {posterTierBadge && (
            <span
              className="inline-flex items-center gap-1 text-ds-10 font-sans font-semibold uppercase"
              style={{ color: posterTierBadge.color, letterSpacing: "0.06em" }}
            >
              <posterTierBadge.icon className="w-3.5 h-3.5" strokeWidth={2.25} />
              {tierDisplayName(job.posterSubscriptionTier)} Member
            </span>
          )}
          {/* Poster-data trust signals via the reusable TrustRow component.
              "Worked together N×" maps to repeatHirePercent (≥2 jobs → 100%).
              NO avgRating/reviewCount here — TrustRow renders those as a
              rating chip, which is the number already printed beside the name
              two rows up. See `showTrustRow`. */}
          <TrustRow repeatHirePercent={repeatJobs >= 2 ? 100 : undefined} />
        </div>
      )}
    </PersonTile>
  );
}
