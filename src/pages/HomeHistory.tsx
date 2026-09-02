import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Calendar, Home, Loader2, Share2 } from "lucide-react";
import AppPage from "@/components/AppPage";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { unwrap } from "@/lib/supabaseResult";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatPriceExact } from "@/lib/format";
import { posterPaidDollars } from "@/lib/posterJobCost";
import { shareFileNative, shareNative } from "@/lib/nativeShare";
import { report } from "@/lib/errorLogger";
import {
  buildHomeHistoryPdf,
  buildHomeHistorySummaryLines,
  formatHelperList,
  formatRecordDate,
  type HomeHistoryDocumentInput,
} from "@/lib/homeHistoryDocument";
import { categoryColors, categoryLabels } from "@/components/activity/activityConstants";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

/** `group_job_helpers` — a group job's full roster, the source `release-payout`
 *  fans transfers across. `jobs.helper_id` only ever holds the lead. */
interface GroupRosterRow {
  job_id: string;
  helper_id: string;
  joined_at: string | null;
}

interface CompletedJobWithHelper extends Job {
  /** EVERY Helpr who did the job, not just the lead. Empty when unresolved. */
  helperNames: string[];
  /** The poster's `profiles.full_name`, for the exported record's header. */
  ownerName: string | null;
}

/**
 * This page bills itself as "your home's permanent service history — who came
 * out, what it cost, and when". Two things follow from that sentence and
 * neither used to hold:
 *
 *  1. "WHEN" is the day the work was DONE, not the day the job was posted.
 *     Every date and every year heading was read off `created_at`, so a job
 *     posted in December and finished in January filed under the wrong year
 *     and showed the wrong date on a record a homeowner may hand to a buyer,
 *     an insurer or an appraiser.
 *  2. The date must be the PLATFORM's day. `formatTimestamp` (lib/format.ts)
 *     formats in the reader's own zone; `src/lib/workRecordDocument.ts` was
 *     fixed for exactly this today, because a job stamped
 *     `2026-08-01T00:00:00Z` printed as July everywhere in the United States.
 *     Grouping had the same bug one level up — `new Date(...).getFullYear()`
 *     is the DEVICE's year, so a job completed at 8pm Central on Dec 31 filed
 *     under the following year.
 */
const PLATFORM_TIME_ZONE = "America/Chicago";

/** The day the work actually happened, best-available. */
function serviceDate(job: Pick<Job, "created_at"> & { poster_completed_at?: string | null; helper_completed_at?: string | null }): string {
  return job.poster_completed_at ?? job.helper_completed_at ?? job.created_at;
}

/* `formatDate` lived here as its own copy of the same
   `toLocaleDateString(..., { timeZone: PLATFORM_TIME_ZONE })` the exported
   record now needs. It moved to `homeHistoryDocument.formatRecordDate` so the
   card and the PDF built FROM that card cannot print two different days for
   one job. */

/** The calendar year of an instant, in the platform's zone. */
function platformYear(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return NaN;
  return Number(d.toLocaleDateString("en-CA", { timeZone: PLATFORM_TIME_ZONE }).slice(0, 4));
}

function groupByYear(jobs: CompletedJobWithHelper[]): { year: number; jobs: CompletedJobWithHelper[] }[] {
  const map = new Map<number, CompletedJobWithHelper[]>();
  // Order by the same instant the headings and labels use, so the list can't
  // read out of sequence against its own dates (the query still sorts by
  // created_at, which is a different ordering once completion dates differ).
  const ordered = [...jobs].sort(
    (a, b) => new Date(serviceDate(b)).getTime() - new Date(serviceDate(a)).getTime(),
  );
  for (const job of ordered) {
    const year = platformYear(serviceDate(job));
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(job);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, jobs]) => ({ year, jobs }));
}

const HomeHistory = () => {
  usePageTitle("Home History — Helpr");
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const userId = user?.id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["home-history", userId],
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      if (!userId) return [] as CompletedJobWithHelper[];

      // Fetch completed jobs where this user is the poster (customer)
      const jobsRes = await supabase
        .from("jobs")
        .select("*")
        .eq("customer_id", userId)
        .eq("status", "completed")
        .order("created_at", { ascending: false });
      const jobs = unwrap(jobsRes) as Job[];

      if (jobs.length === 0) return [] as CompletedJobWithHelper[];

      // WHO CAME OUT — resolved from the CANONICAL columns, in this order.
      //
      // This used to be a single read of `applications WHERE status='accepted'`,
      // which is not where the app records who did a job. It is one of the ways
      // a job can ACQUIRE a helper, and the least universal one:
      //
      //   * INSTANT BOOK and DIRECT OFFERS never create an accepted application
      //     at all — `jobs.helper_id` is stamped straight away — so every one of
      //     those jobs lost its "done by" line entirely, silently, on the record
      //     that exists to say who came out. Measured 2026-09-01 against the
      //     mocked fixture: of three completed jobs, only the one with an
      //     accepted application rendered a name.
      //   * GROUP JOBS put ONE member in `jobs.helper_id` and the whole roster
      //     in `group_job_helpers` — the same split `release-payout/index.ts:162`
      //     and `useProfileTabData.ts:156` already read, because payouts fan out
      //     across that roster. Keyed by job id, the old Map kept whichever
      //     accepted application came last, so a three-Helpr job printed one
      //     name and the other two vanished from the property's history.
      //
      // So: `jobs.helper_id` is the lead, `group_job_helpers` supplies the rest
      // of a group roster, and the accepted application survives ONLY as a
      // fallback for legacy rows whose `helper_id` was never backfilled.
      const jobIds = jobs.map((j) => j.id);
      const groupIds = jobs.filter((j) => j.is_group_job).map((j) => j.id);

      const [appsRes, rosterRes] = await Promise.all([
        supabase
          .from("applications")
          .select("job_id, helper_id")
          .in("job_id", jobIds)
          .eq("status", "accepted"),
        groupIds.length
          ? supabase
              .from("group_job_helpers")
              .select("job_id, helper_id, joined_at")
              .in("job_id", groupIds)
          : Promise.resolve({ data: [] as GroupRosterRow[], error: null }),
      ]);
      const apps = unwrap(appsRes) as { job_id: string; helper_id: string }[];
      const roster = unwrap(rosterRes) as GroupRosterRow[];

      // job_id → helper ids, in the order they should be read out.
      const idsByJob = new Map<string, string[]>();
      const addHelper = (jobId: string, helperId: string | null | undefined) => {
        if (!helperId) return;
        const list = idsByJob.get(jobId) ?? [];
        if (!list.includes(helperId)) list.push(helperId);
        idsByJob.set(jobId, list);
      };
      for (const j of jobs) addHelper(j.id, j.helper_id);
      for (const r of [...roster].sort((a, b) => (a.joined_at ?? "").localeCompare(b.joined_at ?? ""))) {
        addHelper(r.job_id, r.helper_id);
      }
      for (const app of apps) addHelper(app.job_id, app.helper_id);

      // The OWNER's own row rides along with the helpers'. The exported record
      // names the property owner, and the authoritative spelling of that name
      // is `profiles.full_name` — not `user_metadata.full_name`, which is a
      // copy taken at signup and never updated by a profile rename.
      const helperIds = [...new Set([...idsByJob.values()].flat())];
      const profilesRes = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", [...new Set([userId, ...helperIds])]);
      const profiles = unwrap(profilesRes) as { user_id: string; full_name: string | null }[];
      // Full names, not `formatName`'s "Marcus T." — this is a permanent record
      // a homeowner may hand a buyer or an insurer, and an initial is not
      // something a third party can act on. A missing name says so rather than
      // inventing "Someone".
      const profileMap = new Map(
        profiles.map((p) => [p.user_id, (p.full_name ?? "").trim() || "Name not on file"]),
      );

      return jobs.map((j) => ({
        ...j,
        ownerName: profileMap.get(userId) ?? null,
        helperNames: (idsByJob.get(j.id) ?? []).map(
          (id) => profileMap.get(id) ?? "Name not on file",
        ),
      })) as CompletedJobWithHelper[];
    },
  });

  const grouped = useMemo(() => groupByYear(data ?? []), [data]);
  const loading = isLoading && !data;
  const [isSharing, setIsSharing] = useState(false);

  /**
   * Hand the record over as a real FILE.
   *
   * `<a download>`, `blob:`/`data:` URLs and `window.print()` are all inert in
   * the Capacitor WKWebView (CLAUDE.md), so none of them is the export for a
   * page that ships inside the app. This is the same path /work-record uses:
   * build the PDF, hand `shareFileNative` a `.pdf` with a real extension, and
   * let it choose the OS share sheet (Save to Files, Mail, Print, AirDrop) on
   * native or a download on web. Nothing here knows which branch ran.
   */
  /** Reads `grouped`, not the raw rows, so the record's order is the SCREEN's order. */
  function documentInput(): HomeHistoryDocumentInput {
    return {
      ownerName: data?.[0]?.ownerName ?? null,
      generatedAt: new Date(),
      // The SAME order the screen shows, and the same per-job figures — a
      // record that disagrees with the page it was exported from is worse than
      // no record.
      jobs: grouped.flatMap(({ jobs: yearJobs }) =>
        yearJobs.map((j) => ({
          title: j.title,
          category: categoryLabels[j.category ?? "other"] ?? "Other",
          serviceDate: serviceDate(j),
          helpers: j.helperNames,
          paid: posterPaidDollars(j),
          where: j.parish ?? j.location ?? null,
        })),
      ),
    };
  }

  async function handleShare() {
    // Building the PDF is async, so a double tap would stage two files and open
    // two sheets. Same guard, same shape, as /work-record's.
    if (!data || data.length === 0 || isSharing) return;
    setIsSharing(true);
    const input = documentInput();
    try {
      const file = await buildHomeHistoryPdf(input);
      const outcome = await shareFileNative({
        ...file,
        title: "Helpr Home Service Record",
        dialogTitle: "Share my home service record",
        source: "homeHistory",
        // This screen states the download in its own terms below, so the
        // generic confirmation would stack on top of it.
        suppressDownloadConfirmation: true,
      });
      // The web branch is a silent write to ~/Downloads and the page is
      // pixel-identical afterwards — the bare `toast(...)` callable, NOT
      // `toast.success`, which `src/lib/toastPolicy.ts` no-ops app-wide.
      if (outcome === "downloaded") {
        toast("Home record saved", { description: `${file.fileName} — attach it or print it.` });
      }
    } catch (err) {
      // The PDF couldn't be built (offline, chunk-load failure). Fall back to
      // the text summary — and note there is still NO url on it.
      report(err, { severity: "error", tags: { source: "homeHistory.buildPdf" } });
      await shareNative({
        title: "My Helpr home service record",
        text: buildHomeHistorySummaryLines(input).join("\n"),
        dialogTitle: "Share my home service record",
      });
    } finally {
      setIsSharing(false);
    }
  }

  return (
    // AppPage — the shared signed-in sub-screen shell (AppShell + the Profile
    // tab header + the centered content column), the same component the
    // Profile tabs use. The record grows without bound (every completed job,
    // for the life of the house), so it scrolls in AppShell's internal
    // container; `/home-history` must therefore NOT be in
    // DOCUMENT_SCROLL_ROUTES, or a second scroll lock stacks on top of it.
    <AppPage title="Home History" backTo="/profile">
      {/* `space-y-5` preserved from the old body wrapper — it separates the
          per-year timeline sections. */}
      <div className="space-y-5">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}
          </div>
        )}

        {isError && !loading && (
          <ErrorState
            variant="inline"
            title="We couldn't load your home history"
            onRetry={() => refetch()}
          />
        )}

        {/* House empty state — the same eyebrow / title / body / CTA shape
            (and shared card) that Browse and Messages use, instead of the
            bespoke copy of it this page used to carry. Same message, one
            fewer hand-rolled surface. */}
        {!loading && !isError && (data ?? []).length === 0 && (
          <EmptyState
            variant="inline"
            icon={Home}
            eyebrow="Nothing on record yet"
            title="No finished jobs yet"
            body="When a job is done it lands here for good — who came out, what it cost, and when. It's your home's permanent service history."
            action={
              <BarkPillButton onClick={() => navigate("/post-job")}>
                Post your first job
              </BarkPillButton>
            }
          />
        )}

        {/* SHARE THE RECORD — the export this page shipped without.
            /work-record, the helper-side twin on the same `.doc-card` surface,
            has had "Share Record (PDF)" since 2026-08-31; this page promised "a
            permanent service history" a homeowner could hand to a buyer, an
            insurer or an appraiser and gave them no way to hand it to anybody.

            Same control, same treatment, same path as /work-record's — bark
            tint, bark hairline, bark type — so the two records read as one
            product rather than two authors. NOT `btn-grad-primary`: the gloss
            is the app's mark for a primary ACTION on a task screen, and both
            document screens deliberately wear the quieter document-export
            treatment. Parity with the sibling is what decides it.

            POSITION deviates from /work-record on purpose. There the sheet is
            one fixed card, so the control sits under it. Here the record is an
            unbounded list — every completed job for the life of the house — and
            an export parked below forty entries is an export nobody finds. It
            leads, which is also the order someone opening this screen to send
            it to their insurer actually wants. */}
        {!loading && !isError && (data ?? []).length > 0 && (
          <div data-print-hide className="flex">
            <button
              type="button"
              onClick={() => { void handleShare(); }}
              disabled={isSharing}
              aria-busy={isSharing}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-ds-lg py-3.5 px-5 text-ds-14 font-semibold active:scale-[0.99] transition-all disabled:opacity-60"
              style={{
                background: "hsl(var(--bark) / 0.10)",
                border: "1px solid hsl(var(--bark) / 0.30)",
                color: "hsl(var(--bark))",
              }}
            >
              {isSharing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
              {isSharing ? "Preparing record\u2026" : "Share Record (PDF)"}
            </button>
          </div>
        )}

        {/* The year rule is a DIVIDER, so it only earns its place when there
            is something to divide. With a single year on the page it labels
            the whole list twice over — every card already prints its own full
            date — and "2026 ——— 1 job" was heavier chrome than the one entry
            underneath it. Two or more years and it goes back to doing real
            work. */}
        {!loading && !isError && grouped.map(({ year, jobs }) => (
          <section key={year}>
            {grouped.length > 1 && (
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="font-sans font-semibold text-ds-13 tabular-nums"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {year}
                </span>
                <div className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
                <span className="text-ds-10 text-muted-foreground">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</span>
              </div>
            )}

            {/* Timeline. The spine (dot + connector line) is only drawn once
                there are at least TWO entries to connect: with one card the
                line has nothing to run between and the lone dot reads as a
                stray UI artifact hanging off the left edge rather than as a
                timeline. Below the threshold the group renders as a plain
                stack and reclaims the 20px rail. */}
            <div className={jobs.length > 1 ? "relative pl-5" : "relative"}>
              {/* Vertical connector line */}
              {jobs.length > 1 && (
                <div
                  className="absolute left-[7px] top-3 bottom-3 w-px"
                  style={{ background: "hsl(var(--olivewood) / 0.15)" }}
                />
              )}

              <div className="space-y-3">
                {jobs.map((job) => {
                  const Icon = getCategoryIcon(job.category);
                  const cat = job.category ?? "other";
                  const colors = categoryColors[cat] ?? categoryColors["other"];
                  const label = categoryLabels[cat] ?? "Other";

                  return (
                    <div key={job.id} className="relative">
                      {/* Timeline dot */}
                      {jobs.length > 1 && (
                        <div
                          className="absolute -left-5 top-4 w-3.5 h-3.5 rounded-full border-2 z-10"
                          style={{
                            background: "hsl(var(--parchment))",
                            borderColor: "hsl(var(--bark) / 0.35)",
                          }}
                        />
                      )}

                      {/* Job card. DELIBERATE deviation from the
                          `rounded-2xl liquid-glass p-5` card convention — a
                          plain white liquid-glass fill would make these
                          timeline entries read as app cards floating over the
                          page rather than as entries on a single record
                          sheet. Uses `.doc-card`, the SAME document-surface
                          material /work-record uses (the
                          document surface ladder in index.css) — this used
                          to hand-roll a `parchment/0.70` fill that measured
                          2-6/255 from the page canvas (a card that did not
                          read as a sheet, just a slightly different patch of
                          page), the exact contrast bug already fixed on its
                          two siblings. `.doc-card` sets material only
                          (fill/border/shadow); the geometry classes below are
                          unchanged. */}
                      <div
                        className="doc-card rounded-ds-lg p-4 space-y-2.5"
                      >
                        {/* Top row: category badge + title */}
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`shrink-0 w-9 h-9 rounded-ds-md flex items-center justify-center ${colors.badge} border`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                              <span
                                className={`inline-flex items-center text-ds-10 font-semibold rounded-full px-2 py-0.5 border ${colors.badge}`}
                              >
                                {label}
                              </span>
                            </div>
                            <p className="text-ds-14 font-semibold leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
                              {job.title}
                            </p>
                            {job.helperNames.length > 0 && (
                              <p className="text-ds-11 text-muted-foreground mt-0.5">
                                done by{" "}
                                <span className="font-semibold" style={{ color: "hsl(var(--bark))" }}>
                                  {formatHelperList(job.helperNames)}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Meta row */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
                            <Calendar className="w-3 h-3 shrink-0" />
                            {formatRecordDate(serviceDate(job))}
                          </span>
                          {/* A currency symbol is typography, not an icon: the
                              "$" belongs in the same text node as the digits.
                              A DollarSign glyph beside the amount rendered as
                              "$ 200" — wrong stroke weight, a gap in the
                              middle of the figure, and no tabular alignment. */}
                          {/* WHAT IT COST, not what it was listed at. This
                              printed `job.budget` under a page that promises
                              "what it cost" — but the poster's card was charged
                              budget + service fee + urgent tip + LA sales tax
                              (see posterJobCost.ts). On a $640 job at an 11%
                              fee that is a $70 gap on a document a homeowner
                              may hand an insurer. `formatPriceExact`, not
                              `formatPrice`: a derived total carries cents (tax
                              does), and rounding a record's figure to whole
                              dollars is how it stops reconciling. The word
                              "paid" is part of the number — an unlabelled
                              figure here reads as the listing price, which is
                              exactly the thing it no longer is. */}
                          {posterPaidDollars(job) > 0 && (
                            <span className="inline-flex items-center gap-1 text-ds-11 font-medium tabular-nums" style={{ color: "hsl(var(--bark))" }}>
                              ${formatPriceExact(posterPaidDollars(job))}
                              <span className="font-normal text-muted-foreground">paid</span>
                            </span>
                          )}
                          {job.location && (
                            <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {job.parish ?? job.location}
                            </span>
                          )}
                        </div>

                        {/* Description excerpt */}
                        {job.description?.trim() && (
                          <p
                            className="font-serif italic text-ds-12 leading-snug line-clamp-2"
                            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                          >
                            {job.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>
    </AppPage>
  );
};

export default HomeHistory;
