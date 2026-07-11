import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MapPin, CalendarDays, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { categoryColors, categoryLabels } from "@/components/activity/activityConstants";
import { formatPrice, formatShortDate } from "@/lib/format";

/**
 * LandingJobsStrip — horizontally-scrolling row of real open jobs, shown on
 * the marketing landing page between "How it works" and the reviews section
 * (and the scroll target for the nav's "Jobs" link, via `id="jobs"`).
 *
 * It answers the visitor's "is anything actually happening here?" question
 * with live listings rather than a static screenshot. Each card is a glance —
 * category, title, place, date, price — and links to the full public `/jobs`
 * board where they can see everything and sign up to bid.
 *
 * Self-fetches the anon-accessible `get_ranked_open_jobs` RPC (same source
 * as the /jobs page) and, like PayoutTicker, HIDES ITSELF when there's no
 * data to show:
 *   - RPC not deployed yet (PGRST202) → treat as empty → render null.
 *   - zero open jobs (cold start / quiet platform) → render null.
 * so a fresh install never shows an empty rail. It's lazy-loaded from
 * Index.tsx so the Supabase chunk stays out of the landing entry/LCP path.
 */

// Subset of the RPC row we actually render. The RPC returns more (see
// Jobs.tsx's PublicJob), but the strip only needs these fields.
type StripJob = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  budget: number | null;
  date_needed: string | null;
  is_urgent: boolean | null;
  pricing_mode: string | null;
};

const STRIP_LIMIT = 12;

const JobStripCard = ({ job }: { job: StripJob }) => {
  const Icon = getCategoryIcon(job.category);
  const chip = categoryColors[job.category] ?? categoryColors.other;
  const label = categoryLabels[job.category] ?? "Other";
  const isBids = job.pricing_mode === "accept_bids";
  const date = formatShortDate(job.date_needed);

  return (
    <Link
      to="/jobs"
      className="group liquid-glass snap-start shrink-0 w-[15.5rem] rounded-2xl px-4 py-4 flex flex-col gap-2.5 transition-all duration-300 ease-out hover:-translate-y-0.5"
      aria-label={`${label} job: ${job.title}. View on the jobs board.`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${chip.badge}`}
        >
          <Icon className="w-3 h-3" strokeWidth={2} />
          {label}
        </span>
        {job.is_urgent && (
          <span
            className="inline-flex items-center gap-1 text-[0.62rem] font-bold uppercase tracking-wide"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            <Zap className="w-3 h-3" strokeWidth={2.25} fill="currentColor" />
            Urgent
          </span>
        )}
      </div>

      <p
        className="font-display font-bold leading-snug line-clamp-2 min-h-[2.6em]"
        style={{ fontSize: "0.98rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
      >
        {job.title}
      </p>

      <div className="flex flex-col gap-1 text-[0.72rem]" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        {job.location && (
          <span className="inline-flex items-center gap-1.5 truncate">
            <MapPin className="w-3 h-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{job.location}</span>
          </span>
        )}
        {date && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="w-3 h-3 shrink-0" strokeWidth={1.75} />
            {date}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="font-display font-bold flex items-baseline gap-1.5" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
          {job.budget != null ? `$${formatPrice(job.budget)}` : "Open"}
          {job.budget != null && !isBids && (
            /* Explicit "posted" label distinguishes this GROSS budget from
               the /jobs board's NET "You earn" figure (budget × 0.88 at
               the Free-tier fee). Cowork audit 2026-07-08 flagged that
               the same job read at two unlabeled prices across surfaces. */
            <span className="text-[0.6rem] font-sans font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              posted
            </span>
          )}
          {isBids && (
            <span className="text-[0.62rem] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              · bids
            </span>
          )}
        </span>
        <ArrowRight
          className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
          style={{ color: "hsl(var(--bark))" }}
          strokeWidth={2}
        />
      </div>
    </Link>
  );
};

const LandingJobsStrip = () => {
  const { data: jobs } = useQuery<StripJob[]>({
    queryKey: ["jobs", "landing-strip"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ranked_open_jobs", {
        p_limit: STRIP_LIMIT,
        p_offset: 0,
      });
      if (error) {
        // PGRST202 = RPC not deployed to prod yet (between merge and
        // `supabase db push`). Hide silently instead of throwing.
        if (String(error?.code ?? "") === "PGRST202") return [];
        throw error;
      }
      // The generated RPC row type doesn't surface pricing_mode; cast through
      // unknown like Jobs.tsx (PublicJob) does for the same anon RPC.
      return (data ?? []) as unknown as StripJob[];
    },
    staleTime: 60_000,
    retry: false,
  });

  // Hide the whole section when there's nothing live to show — no empty rail.
  if (!jobs || jobs.length === 0) return null;

  return (
    <section
      id="jobs"
      aria-label="Live jobs in Louisiana"
      className="observe-fade-up px-5 sm:px-8 lg:px-12 pt-6 pb-8 scroll-mt-20"
    >
      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <p className="text-display-eyebrow">Fresh today · pulled live</p>
            <h2
              className="font-display italic font-bold tracking-[-0.025em]"
              style={{ fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2.25rem)", color: "hsl(var(--ink-deep))" }}
            >
              Jobs happening near you
            </h2>
          </div>
          <Link
            to="/jobs"
            className="hidden sm:inline-flex items-center gap-1.5 text-ds-13 font-semibold shrink-0 hover:underline"
            style={{ color: "hsl(var(--bark))" }}
          >
            See all jobs
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </Link>
        </div>

        {/* Horizontal scroll rail. `snap-x` gives a gentle card-to-card
            settle on touch; the negative margin + padding lets the first/
            last card breathe to the section edge without clipping shadows.
            The right-edge mask fades the last visible card into the canvas
            (instead of a hard clip) so the rail reads as "more to scroll"
            rather than an abrupt cut-off. A mask (not an overlay) is used so
            the fade works over the mesh-gradient background. */}
        <div
          className="flex gap-3.5 overflow-x-auto snap-x snap-mandatory pb-3 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="list"
          style={{
            maskImage:
              "linear-gradient(to right, black calc(100% - 2.5rem), transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, black calc(100% - 2.5rem), transparent)",
          }}
        >
          {jobs.map((job) => (
            <div role="listitem" key={job.id} className="contents">
              <JobStripCard job={job} />
            </div>
          ))}

          {/* Trailing "see all" card — a natural end-cap to the rail and the
              mobile equivalent of the header link (which is hidden on <sm). */}
          <Link
            to="/jobs"
            className="snap-start shrink-0 w-[11rem] rounded-2xl flex flex-col items-center justify-center gap-2 text-center px-4 py-6 transition-all duration-300 hover:-translate-y-0.5"
            style={{
              background: "hsl(var(--bark) / 0.06)",
              border: "1.5px dashed hsl(var(--bark) / 0.35)",
              color: "hsl(var(--bark))",
            }}
          >
            <ArrowRight className="w-5 h-5" strokeWidth={2} />
            <span className="font-semibold text-ds-13">See all open jobs</span>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default LandingJobsStrip;
