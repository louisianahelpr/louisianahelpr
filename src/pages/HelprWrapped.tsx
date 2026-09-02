import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Gift, Loader2, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { shareNative } from "@/lib/nativeShare";
import { report } from "@/lib/errorLogger";
import { formatCategory, formatPrice, formatPriceFloor, wrappedSeasonLabel } from "@/lib/format";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { jobLocalMidnightMs } from "../../supabase/functions/_shared/cancellationFee";

const YEAR = new Date().getFullYear();
// "Wrapped" in December, "so far" the rest of the year (see LH-39).
const SEASON = wrappedSeasonLabel();

// NO HOURS TILE. The "earned" card used to carry a "~26 hrs" sublabel computed
// as `totalEarned / 15` — an undisclosed $15/hr assumption rendered in the same
// grid, at the same weight, as the figures that are actually measured. Nothing
// in this app records hours: not the job row, not the tracker, not the payout.
// So the number was a guess wearing a measurement's clothes, on the ONE screen
// built to be screenshotted and posted publicly, where a caption cannot travel
// with it. Disclosing the rate in the sublabel was the alternative and it is
// not enough — "~26 hrs (at $15/hr)" still leaves "26 hrs" as the thing a
// reader repeats. It is gone rather than annotated.

interface WrappedStats {
  jobsPosted: number;
  totalSpent: number;
  jobsCompleted: number;
  totalEarned: number;
  uniquePeople: number;
  topCategory: string | null;
  avgRating: number | null;
  reviewsGiven: number;
  reviewsReceived: number;
  /** True when at least one (but not every) stat query failed, so the
   *  numbers below are an undercount rather than the whole year. */
  incomplete: boolean;
}

async function fetchWrappedStats(userId: string): Promise<WrappedStats> {
  // The year window is the PLATFORM's year, not UTC's. `${YEAR}-01-01T00:00Z`
  // is 6pm on Dec 31 of the previous year in Louisiana, so the UTC bounds
  // silently pulled in the last six hours of last year and dropped the last
  // six hours of this one — including New Year's Eve, which is exactly when a
  // "year in review" gets opened. `jobLocalMidnightMs` resolves a YYYY-MM-DD
  // at midnight America/Chicago, the same primitive the job-date comparisons
  // use, so Wrapped and the rest of the app agree on which day a job was.
  const yearStart = new Date(jobLocalMidnightMs(`${YEAR}-01-01`)).toISOString();
  const yearEnd = new Date(jobLocalMidnightMs(`${YEAR + 1}-01-01`) - 1).toISOString();

  const [postedRes, completedRes, reviewsGivenRes, reviewsReceivedRes, profileRes] = await Promise.all([
    supabase
      .from("jobs")
      // `status` is selected so the MONEY figure below can be scoped to jobs
      // that actually happened. The row count stays every posted job.
      .select("id, budget, category, helper_id, status")
      .eq("customer_id", userId)
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("jobs")
      .select("id, budget, category, customer_id, helper_fee_percent, platform_fee_amount, urgent_fee, helpers_needed, is_group_job, payment_status")
      .eq("helper_id", userId)
      .eq("status", "completed")
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("reviews")
      .select("id, rating")
      .eq("reviewer_id", userId)
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    // Reviews RECEIVED must obey the two filters `src/lib/reviewStats.ts`
    // names as the single source of truth: past the anti-retaliation reveal
    // (`feedback_visible_at`), and not attached to a cancelled job. Without
    // them this screen counted reviews the recipient is not yet allowed to
    // see. Measured on the seeded helper 2026-08-31: /profile showed
    // "5.0 · 1 review" while /wrapped showed "2 REVIEWS RECEIVED", because
    // review c3ee22a8 is embargoed until 2026-09-14 — and `bestRating` below
    // surfaced its score too. Wrapped is the app's most screenshotted screen,
    // so it was the one place the embargo leaked.
    supabase
      .from("reviews")
      .select("id, rating, jobs!inner(status)")
      .eq("reviewee_id", userId)
      .lte("feedback_visible_at", new Date().toISOString())
      .neq("jobs.status", "cancelled")
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("profiles")
      .select("subscription_tier, subscription_expires_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  for (const [label, res] of [
    ["posted", postedRes],
    ["completed", completedRes],
    ["reviews_given", reviewsGivenRes],
    ["reviews_received", reviewsReceivedRes],
    ["profile", profileRes],
  ] as const) {
    if (res.error) {
      report(res.error, {
        severity: "warning",
        tags: { area: `helpr_wrapped.${label}` },
        context: { user_id: userId },
      });
    }
  }

  // The four stat queries above are the page's whole substance — `profile`
  // only supplies a fee-percent fallback. If EVERY one of them failed this
  // isn't a quiet year, it's an outage: throw so React Query flags isError
  // and the page can offer a retry instead of telling someone with a full
  // year of history "No activity yet". If only some failed, hand back an
  // `incomplete` flag so the render side can say the numbers are partial
  // rather than presenting an undercount as the truth.
  const coreErrors = [
    postedRes.error,
    completedRes.error,
    reviewsGivenRes.error,
    reviewsReceivedRes.error,
  ].filter((e): e is NonNullable<typeof e> => !!e);

  if (coreErrors.length === 4) {
    throw new Error(coreErrors[0].message || "Couldn't load your Helpr year.");
  }

  const posted = postedRes.data ?? [];
  const completed = completedRes.data ?? [];
  const reviewsGiven = reviewsGivenRes.data ?? [];
  const reviewsReceived = reviewsReceivedRes.data ?? [];

  // Total spent — COMPLETED posted jobs only. This renders as "invested in
  // community", which is a claim about money that moved, so it cannot be
  // summed over `open`, `cancelled`, `disputed` and `pending_approval` jobs
  // the way it used to be: a poster who listed four $200 jobs and cancelled
  // all four was told they had invested $800 in their neighbours. Every other
  // money aggregate in the app scopes the same way (AdminExport, Admin
  // analytics, money-reconciliation all `.eq("status","completed")`).
  // `jobsPosted` below intentionally still counts every posted job — that one
  // is an activity count, not a money claim.
  const totalSpent = posted
    .filter((j) => j.status === "completed")
    .reduce((acc, j) => acc + (j.budget ?? 0), 0);
  // Total earned = helper take-home (net of the platform fee), so the same
  // $75 job reads the same here as on analytics/work-record/Earnings. The
  // per-job resolution (stamped fee → frozen per-job % → tier rate, plus the
  // net urgent bonus, divided across a group job's roster) lives in
  // `helperEarnings.ts` so this page and /work-record can't drift apart again.
  // The group split is why `helpers_needed, is_group_job` are selected above:
  // a $300 job needing 3 helpers paid this helper ~$100, not $300.
  const feeFallbackPct = tierFeePercent(
    profileRes.data?.subscription_tier ?? null,
    profileRes.data?.subscription_expires_at ?? null,
  );
  const totalEarned = sumHelperTakeHomeDollars(completed, feeFallbackPct);

  // Unique people worked with — union of helper_ids from posted jobs (who accepted)
  // and customer_ids from completed helper jobs
  const peopleWorkedWith = new Set<string>([
    ...posted.map((j) => j.helper_id).filter(Boolean) as string[],
    ...completed.map((j) => j.customer_id).filter(Boolean) as string[],
  ]);

  // Top category by count across both sides
  const categoryCount: Record<string, number> = {};
  for (const j of [...posted, ...completed]) {
    if (j.category) categoryCount[j.category] = (categoryCount[j.category] ?? 0) + 1;
  }
  const topCategory =
    Object.keys(categoryCount).sort((a, b) => (categoryCount[b] ?? 0) - (categoryCount[a] ?? 0))[0] ?? null;

  // AVERAGE rating received, not the best one.
  //
  // This was `Math.max(...receivedRatings)`, labelled "best rating". A helper
  // with 5, 3 and 4 read "5.0" — the same 5.0 their /profile prints only when
  // every review is a five. A max over a rating set is not a fact about the
  // year, it is a fact about the single kindest reviewer, and on a card built
  // to be shared it is the number a stranger reads as the person's standing.
  // The mean is what /profile, the applicant list and every other rating
  // surface show (`get_public_profile_stats` / `reviewStats.ts`), so this now
  // agrees with them instead of quietly out-ranking them.
  const receivedRatings = reviewsReceived.map((r) => r.rating).filter((r): r is number => typeof r === "number");
  const avgRating =
    receivedRatings.length > 0
      ? receivedRatings.reduce((acc, r) => acc + r, 0) / receivedRatings.length
      : null;

  return {
    jobsPosted: posted.length,
    totalSpent,
    jobsCompleted: completed.length,
    totalEarned,
    uniquePeople: peopleWorkedWith.size,
    topCategory,
    avgRating,
    reviewsGiven: reviewsGiven.length,
    reviewsReceived: reviewsReceived.length,
    incomplete: coreErrors.length > 0,
  };
}

interface StatCardProps {
  label: string;
  value: string;
}

const StatCard = ({ label, value }: StatCardProps) => (
  <div
    className="rounded-ds-md p-4 text-center space-y-1 flex flex-col items-center justify-center"
    style={{
      background: "rgba(255,255,255,0.28)",
      backdropFilter: "blur(12px) saturate(150%)",
      WebkitBackdropFilter: "blur(12px) saturate(150%)",
      border: "0.5px solid rgba(255,255,255,0.5)",
      boxShadow:
        "inset 0 1px 1px 0 rgba(255,255,255,0.6), 0 2px 8px -2px hsl(var(--olivewood) / 0.12)",
    }}
  >
    <p
      className="text-ds-28 font-display italic font-bold tabular-nums leading-none"
      style={{ color: "hsl(var(--ink-deep))" }}
    >
      {value}
    </p>
    <p className="text-ds-11 font-sans font-semibold uppercase tracking-wider leading-tight" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {label}
    </p>
  </div>
);

const HelprWrapped = () => {
  // Both branches say what the h1 says (`Your ${SEASON.title}`) and both keep
  // the "— Helpr" suffix every other title carries. The December branch used
  // to drop the suffix AND reorder the words ("Helpr Wrapped 2026"), so the
  // one month the feature is at its most shareable was the one month its tab
  // stopped looking like the rest of the app.
  usePageTitle(`Your ${SEASON.title} — Helpr`);
  const navigate = useNavigate();
  const { user, isReady } = useAuthReady();
  const [isSharing, setIsSharing] = useState(false);

  // Guard: redirect to /login once auth resolves with no user.
  // Must be an effect — can't call navigate() before all hooks.
  useEffect(() => {
    if (isReady && !user) {
      navigate("/login", { replace: true });
    }
  }, [isReady, user, navigate]);

  const { data: stats, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["helpr-wrapped", user?.id, YEAR],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: () => fetchWrappedStats(user!.id),
  });

  const handleShare = async () => {
    // A double tap opened TWO share sheets: `shareNative` is async and nothing
    // guarded re-entry, so the second tap ran the whole ladder again while the
    // first sheet was still resolving. Same guard, same shape, as
    // /work-record's `isSharing` (WorkRecord.tsx) — one implementation of "a
    // share is in flight" across the two screens that share.
    if (isSharing) return;
    setIsSharing(true);
    try {
      await shareWrapped();
    } finally {
      setIsSharing(false);
    }
  };

  const shareWrapped = async () => {
    // Posting a job isn't helping a neighbor — only completed jobs count as
    // "helped"; posts get their own clause so the share text stays honest.
    const helped = stats?.jobsCompleted ?? 0;
    const posted = stats?.jobsPosted ?? 0;
    const earned = stats?.totalEarned ?? 0;
    const parts: string[] = [];
    if (helped > 0) parts.push(`helped ${helped} neighbor${helped !== 1 ? "s" : ""}`);
    if (posted > 0) parts.push(`posted ${posted} job${posted !== 1 ? "s" : ""}`);
    // `formatPriceFloor`, the SAME formatter the "earned" tile uses. This was
    // `earned.toLocaleString()`, which prints the raw take-home: a $382.50 year
    // read "$382" in the tile and "$382.5" in the message sent about the tile.
    // Two numbers for one figure, on the screen whose entire output is a
    // sentence about that figure.
    if (earned > 0) parts.push(`earned $${formatPriceFloor(earned)}`);
    const summary =
      parts.length === 0
        ? "was part of the community"
        : parts.length === 1
          ? parts[0]
          : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    // NO `url`. This passed `https://www.louisianahelpr.com` — the marketing
    // homepage — which is the identical defect to the Work Record bug: iOS
    // prefers a URL over text and renders ITS link preview, so the recipient
    // got "Helpr — Louisiana's Local Job Partner | Hire or Find Work" and the
    // generic site blurb where the person's year was supposed to be. There is
    // no public page that shows someone's Wrapped, so per the contract on
    // `ShareContent.url` there is nothing real to link to and the field is
    // omitted. The summary is the whole point of this share, and without a
    // URL competing for the preview it is what actually gets sent.
    // The OUTCOME is read, not discarded. `shareNative` already speaks for the
    // clipboard and last-ditch tiers and toasts its own hard failure, so the
    // only rung with nothing to say is `failed` — where a second toast would
    // stack on the one it just showed. What this must NOT do is report success
    // it did not get, which is what ignoring the return value amounts to.
    const outcome = await shareNative({
      title: `My ${YEAR} on Helpr`,
      text: `I ${summary} on @LouisianaHelpr this year! 🎉`,
      dialogTitle: SEASON.isYearEnd ? "Share your Helpr Wrapped" : "Share your Helpr year",
    });
    if (outcome === "failed") {
      report(new Error("wrapped share failed on every tier"), {
        severity: "warning",
        tags: { area: "helpr_wrapped.share" },
        context: { user_id: user?.id ?? null },
      });
    }
  };

  // Stat cards to render — only show if value > 0
  const statCards: StatCardProps[] = [];

  if (!isLoading && stats) {
    const helpersHired = stats.jobsPosted;
    const jobsDone = stats.jobsCompleted;

    if (helpersHired > 0) {
      statCards.push({
        value: String(helpersHired),
        label: helpersHired === 1 ? "job posted" : "jobs posted",
      });
    }
    if (jobsDone > 0) {
      statCards.push({
        value: String(jobsDone),
        label: jobsDone === 1 ? "neighbor helped" : "neighbors helped",
      });
    }
    if (stats.totalEarned > 0) {
      statCards.push({
        // Take-home (sumHelperTakeHomeDollars) → floor. `totalSpent` below
        // stays on formatPrice: that is what a poster PAID, not a payout owed
        // to anyone, so ordinary rounding is right for it.
        value: `$${formatPriceFloor(stats.totalEarned)}`,
        label: "earned",
      });
    }
    // Spend and earnings are INDEPENDENT facts. This used to read
    // `stats.totalSpent > 0 && stats.totalEarned === 0`, so the moment a poster
    // also helped once, the money they had spent hiring their neighbours
    // vanished from their own year — and it vanished silently, which made the
    // card look complete. Anyone who works both sides of this marketplace, the
    // exact person the "Louisiana Helpr Community" framing is about, never saw
    // this tile. Both sides show; the tile below already names which is which.
    if (stats.totalSpent > 0) {
      statCards.push({
        value: `$${formatPrice(stats.totalSpent)}`,
        label: "invested in community",
      });
    }
    if (stats.uniquePeople > 0) {
      statCards.push({
        value: String(stats.uniquePeople),
        label: stats.uniquePeople === 1 ? "person worked with" : "people worked with",
      });
    }
    if (stats.topCategory) {
      statCards.push({
        value: formatCategory(stats.topCategory),
        label: "top category",
      });
    }
    if (stats.avgRating !== null && stats.avgRating > 0) {
      statCards.push({
        // One decimal, the same shape /profile prints ("5.0 · 1 review").
        value: stats.avgRating.toFixed(1),
        label: "average rating",
      });
    }
    if (stats.reviewsReceived > 0) {
      statCards.push({
        value: String(stats.reviewsReceived),
        label: stats.reviewsReceived === 1 ? "review received" : "reviews received",
      });
    }
    // Reviews WRITTEN. `reviewsGiven` was queried on every load of this page
    // and then dropped on the floor — fetched, counted, returned, never
    // rendered. Leaving a review is the one contribution here that costs the
    // member something and earns them nothing, and this card's whole subject is
    // what a person put into the community, so it belongs on it. (The other
    // option was deleting the query; it is cheaper to show a true number than
    // to keep paying for one nobody sees.)
    if (stats.reviewsGiven > 0) {
      statCards.push({
        value: String(stats.reviewsGiven),
        label: stats.reviewsGiven === 1 ? "review written" : "reviews written",
      });
    }
  }

  const hasActivity = statCards.length > 0;

  // "No activity yet" is a claim about the user's year — only make it when
  // we actually know. A hard failure (every stat query down), or a partial
  // failure that left us with nothing to show, both render as a retryable
  // error instead. `incomplete` alongside real cards is footnoted below.
  const loadFailed = isError || (!!stats?.incomplete && !hasActivity);

  return (
    <AppPage title={`Your ${SEASON.title}`} backTo="/profile">
      {/* AppPage owns the shell (AppShell + title + the one centered content
          column), so this page adds only the card's own centering. No
          `page-measure`/gutter wrapper here — that would be a second
          max-width inside AppPage's. */}
      <div className="py-2 flex flex-col items-center">
        <div
          className="w-full max-w-[420px] rounded-ds-lg overflow-hidden"
          style={{
            background: "linear-gradient(135deg, hsl(var(--bark) / 0.08) 0%, hsl(var(--burnt-sienna) / 0.08) 100%)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.45), " +
              "0 4px 24px -6px hsl(var(--olivewood) / 0.18), " +
              "0 24px 48px -12px hsl(var(--olivewood) / 0.12)",
          }}
        >
          {/* Header band */}
          <div
            className="px-6 pt-8 pb-4 text-center"
            style={{
              backgroundImage:
                "radial-gradient(80% 60% at 50% 0%, hsl(var(--burnt-sienna) / 0.10) 0%, transparent 100%)",
            }}
          >
            <Gift
              className="w-10 h-10 mx-auto mb-3"
              style={{ color: "hsl(var(--burnt-sienna) / 0.75)" }}
            />
            {/* The canonical PageHeader above already names the year — it
                renders the page's <h1> ("Your {SEASON.title}"). This card used
                to repeat it ("Your {YEAR} on Helpr."), so two headings restated
                each other on screen at once. It now leads INTO the stats grid
                below instead of re-announcing the page, and stays an <h2> so
                the heading order still descends from the page title. Season-
                neutral on purpose: it has to read correctly under both "Your
                {YEAR} Wrapped" (December) and "Your {YEAR} so far". */}
            <h2
              className="text-ds-28 font-display italic font-bold leading-tight"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Here's how it added up.
            </h2>
            <p
              className="mt-1 font-serif italic text-ds-13"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Louisiana Helpr Community
            </p>
          </div>

          {/* Stats grid */}
          <div className="px-5 pb-5">
            {isLoading || !isReady ? (
              <div className="grid grid-cols-2 gap-2.5">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="rounded-ds-md p-4 h-20 motion-safe:animate-pulse"
                    style={{ background: "rgba(255,255,255,0.20)" }}
                  />
                ))}
              </div>
            ) : loadFailed ? (
              <div className="flex py-2">
                <ErrorState
                  variant="inline"
                  title={`Couldn't load your ${YEAR}.`}
                  body="Your jobs, earnings and reviews are all still there — we just couldn't add them up right now. Tap Try again."
                  onRetry={() => void refetch()}
                  retryDisabled={isFetching}
                />
              </div>
            ) : !hasActivity ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-ds-15 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                  No activity yet in {YEAR}
                </p>
                <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Post a job or help a neighbor to start building your story.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  {statCards.map((card, i) => (
                    <StatCard key={i} {...card} />
                  ))}
                </div>
                {/* Part of the year failed to load — say so rather than let
                    an undercount pass for the full picture. */}
                {stats?.incomplete && (
                  <p
                    className="text-center text-ds-11 font-serif italic"
                    style={{ color: "hsl(var(--burnt-sienna) / 0.85)" }}
                  >
                    Some of your {YEAR} didn't load, so these numbers may be low.{" "}
                    <button
                      type="button"
                      onClick={() => void refetch()}
                      disabled={isFetching}
                      className="underline underline-offset-2 disabled:opacity-60"
                    >
                      Try Again
                    </button>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Share button */}
          {hasActivity && (
            <div className="px-5 pb-7 space-y-3">
              <Button
                variant="primary" shimmer
                size="lg"
                className="w-full squircle"
                onClick={() => { void handleShare(); }}
                disabled={isSharing}
                aria-busy={isSharing}
              >
                {isSharing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Share2 className="w-4 h-4 mr-2" />
                )}
                {isSharing
                  ? "Opening\u2026"
                  : SEASON.isYearEnd
                    ? "Share Your Wrapped"
                    : "Share Your Year"}
              </Button>
              {/* The "See yours" anchor that sat here preventDefault-ed into
                  nothing — a dead link directly under the real Share button.
                  A plain caption says the same thing without pretending to
                  be a second control. */}
              <p
                className="text-center text-ds-11 font-serif italic"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Share it with the community
              </p>
            </div>
          )}
        </div>
      </div>
    </AppPage>
  );
};

export default HelprWrapped;
