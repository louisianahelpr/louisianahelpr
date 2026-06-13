import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useJobsForYou } from "@/hooks/useJobsForYou";
import { categoryColors } from "@/components/activity/activityConstants";
import { getCityState } from "@/lib/locationUtils";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));

interface JobsForYouProps {
  userId: string | undefined;
  profile: Profile | null;
  effectiveFee: number;
}

// ── Skeleton card ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <li
      className="shrink-0 w-56 h-14 rounded-ds-sm animate-pulse"
      style={{ background: "hsl(var(--olivewood) / 0.07)" }}
      aria-hidden
    />
  );
}

// ── Individual recommendation card ────────────────────────────────────────
function RecommendedCard({
  job,
  onSelect,
}: {
  job: EnrichedJob;
  onSelect: (job: EnrichedJob) => void;
}) {
  const colors = categoryColors[job.category] ?? categoryColors["other"];
  const city = getCityState(job.location);
  const timeAgo = job.created_at
    ? formatDistanceToNow(new Date(job.created_at), { addSuffix: false })
    : null;

  return (
    <li className="shrink-0 w-56">
      <button
        type="button"
        onClick={() => onSelect(job)}
        className="w-full h-14 px-3 flex items-center gap-2.5 rounded-ds-sm text-left transition-opacity active:opacity-70"
        style={{
          background: "hsl(var(--parchment) / 0.40)",
          border: "0.5px solid hsl(var(--olivewood) / 0.13)",
        }}
        aria-label={`${job.title}, $${job.budget}${city ? `, ${city}` : ""}`}
      >
        {/* Category dot */}
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${colors.dot}`}
          aria-hidden
        />

        {/* Title + city */}
        <span className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden gap-0.5">
          <span
            className="line-clamp-2 font-sans font-medium leading-tight"
            style={{ fontSize: "0.78rem", color: "hsl(var(--ink-deep))" }}
          >
            {job.title}
          </span>
          <span
            className="font-serif italic leading-none truncate"
            style={{ fontSize: "0.68rem", color: "hsl(var(--olivewood) / 0.65)" }}
          >
            {city ?? "—"}
            {timeAgo ? ` · ${timeAgo}` : ""}
          </span>
        </span>

        {/* Budget */}
        <span
          className="shrink-0 font-sans font-semibold tabular-nums"
          style={{ fontSize: "0.78rem", color: "hsl(var(--bark))" }}
        >
          ${job.budget}
        </span>
      </button>
    </li>
  );
}

/**
 * JobsForYou — "For you" personalized recommendations strip.
 *
 * Renders a horizontal-scroll list of up to 5 open jobs ranked by relevance
 * for the current helper. Hides entirely if: the user is not approved, the
 * query fails (PGRST202), or no matching jobs exist — so the Dashboard never
 * shows an empty placeholder.
 */
export function JobsForYou({ userId, profile, effectiveFee }: JobsForYouProps) {
  const { data: jobs, isLoading, isError } = useJobsForYou(userId, profile);
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);

  // Surface nothing on error (PGRST202 or any other failure).
  if (isError) return null;

  // Loading: 3 ghost skeleton cards.
  if (isLoading) {
    return (
      <section
        aria-label="Jobs for you — loading"
        className="px-4 pt-2 pb-1"
      >
        <SectionHeader />
        <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="list">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </ul>
      </section>
    );
  }

  // Empty: hide section.
  if (!jobs || jobs.length === 0) return null;

  return (
    <>
      <section
        aria-label="Jobs for you"
        className="px-4 pt-2 pb-1"
      >
        <SectionHeader />
        <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="list">
          {jobs.map((job) => (
            <RecommendedCard
              key={job.id}
              job={job}
              onSelect={setDetailJob}
            />
          ))}
        </ul>
      </section>

      {/* Job detail dialog — lazy loaded, only mounted on tap */}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            job={detailJob}
            effectiveFee={effectiveFee}
            onClose={() => setDetailJob(null)}
            onApply={() => setDetailJob(null)}
            onReport={() => setDetailJob(null)}
          />
        </Suspense>
      )}
    </>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5">
        <Sparkles
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: "hsl(var(--burnt-sienna))" }}
          strokeWidth={2.25}
          aria-hidden
        />
        <span
          className="font-display italic font-bold leading-none"
          style={{
            fontSize: "0.82rem",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.01em",
          }}
        >
          For you
        </span>
      </div>
      <Link
        to="/jobs"
        className="font-sans font-medium text-ds-11 active:opacity-70 transition-opacity"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        See all →
      </Link>
    </div>
  );
}
