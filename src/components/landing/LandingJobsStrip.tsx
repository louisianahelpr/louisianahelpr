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
  time_needed: string | null;
  is_urgent: boolean | null;
  pricing_mode: string | null;
};

// Take-home fraction — helper receives the gross budget minus the standard
// Free-tier platform fee (12%). Kept as a local constant here for the strip
// card display; the real fee math lives in `computeNet` on the /jobs board.
const HELPER_TAKE_HOME_FRACTION = 0.88;

const STRIP_LIMIT = 12;

/**
 * Display-only poster identities for the landing strip. The public
 * `get_ranked_open_jobs` RPC intentionally omits poster PII (masked
 * feed — see 20260618120000_mask_open_jobs_rpc_drop_leaky_view.sql),
 * so we can't show the real name here. To keep the strip from feeling
 * faceless / admin-posted, we deterministically hash the job id into
 * this Louisiana-common first-name pool + a single last initial. This
 * is placeholder identity for visual warmth ONLY, and should be
 * replaced the moment the RPC exposes a display_name / avatar path.
 */
const POSTER_FIRST_NAMES = [
  "Ashley",
  "Trey",
  "Marcus",
  "Camille",
  "Jazmine",
  "Devon",
  "Renee",
  "Emile",
  "Nikki",
  "Beau",
  "Sierra",
  "Ethan",
] as const;
const POSTER_LAST_INITIALS = "BCDFGHJKLMNPRSTVW"; // consonants read as real surnames

// Cheap 32-bit string hash — deterministic + stable, no crypto needed
// (the output is a display placeholder, not a security token).
const hashJobId = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const posterIdentityFor = (jobId: string): { name: string; initial: string } => {
  const h = hashJobId(jobId);
  const first = POSTER_FIRST_NAMES[h % POSTER_FIRST_NAMES.length];
  const lastInitial = POSTER_LAST_INITIALS[(h >>> 8) % POSTER_LAST_INITIALS.length];
  return { name: `${first} ${lastInitial}.`, initial: first.charAt(0) };
};

const JobStripCard = ({ job }: { job: StripJob }) => {
  const Icon = getCategoryIcon(job.category);
  const chip = categoryColors[job.category] ?? categoryColors.other;
  const label = categoryLabels[job.category] ?? "Other";
  const isBids = job.pricing_mode === "accept_bids";
  const date = formatShortDate(job.date_needed);
  const poster = posterIdentityFor(job.id);

  return (
    <Link
      to="/jobs"
      className="group snap-start shrink-0 w-[15.5rem] rounded-2xl px-5 py-5 flex flex-col gap-3.5 transition-all duration-300 ease-out hover:-translate-y-0.5 bg-white border border-[hsl(var(--olivewood)/0.14)]"
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

      {/* Poster identity row — a small avatar + first-name/last-initial so the
          card reads as "a real neighbor posted this", not admin content. Name
          is a deterministic placeholder derived from the job id (see
          POSTER_FIRST_NAMES comment above) until the anon RPC exposes a
          display_name for the poster. */}
      <div className="flex items-center gap-2 -mt-0.5">
        <span
          aria-hidden
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[0.65rem] font-semibold shrink-0"
          style={{
            backgroundColor: "hsl(var(--burnt-sienna) / 0.15)",
            color: "hsl(var(--burnt-sienna))",
          }}
        >
          {poster.initial}
        </span>
        <span
          className="text-ds-11 sm:text-ds-13 font-sans font-medium truncate"
          style={{ color: "hsl(var(--olivewood) / 0.7)" }}
        >
          {poster.name}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-[0.72rem]" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        {job.location && (
          <span className="inline-flex items-center gap-1.5 truncate">
            <MapPin className="w-3 h-3 shrink-0" strokeWidth={1.75} />
            {/* All jobs are in Louisiana — strip the trailing ", LA" so the
                card reads with just the city. */}
            <span className="truncate">{job.location.replace(/,\s*LA\s*$/i, "")}</span>
          </span>
        )}
        {(date || job.time_needed) && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="w-3 h-3 shrink-0" strokeWidth={1.75} />
            {[date, job.time_needed].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="font-display font-bold flex items-baseline gap-1.5" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
          {isBids ? (
            /* Open-to-bids jobs deliberately hide the dollar amount so the
                marketing strip doesn't pre-anchor a price on jobs whose
                cost is set through bidding. */
            <span className="text-[0.85rem] uppercase tracking-wide">Open to bids</span>
          ) : job.budget != null ? (
            /* Show the helper's TAKE-HOME (budget × 0.88 at the Free tier)
                so a helper skimming the strip sees what they'd actually
                pocket, not the gross budget. */
            `$${formatPrice(Math.round(job.budget * HELPER_TAKE_HOME_FRACTION))}`
          ) : (
            "Open"
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
      className="observe-fade-up pt-2 sm:pt-3 pb-2 sm:pb-3 scroll-mt-20"
    >
      {/* Auto-scrolling marquee — jobs drift left continuously. Pauses on
          hover so users can click into a specific card. Duplicated array
          makes the 0 → -50% translate loop seamless. Marquee is a DIRECT
          child of the section (no max-w container around it) so the rail
          runs edge-to-edge of the viewport. */}
      <div className="jobs-strip-marquee-container overflow-hidden" role="list">
        <div className="jobs-strip-marquee gap-5 sm:gap-6 px-5 sm:px-8 lg:px-12">
          {[...jobs, ...jobs].map((job, i) => (
            <div role="listitem" key={`${job.id}-${i}`} className="contents">
              <JobStripCard job={job} />
            </div>
          ))}
        </div>
      </div>

      {/* "See all jobs" link removed — every marquee card is already a
          clickable Link to /jobs, so a standalone affordance was redundant
          marketing chrome. Card taps carry the same intent. */}
    </section>
  );
};

export default LandingJobsStrip;
