import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle,
  Star,
  Share2,
  Printer,
  Briefcase,
  Calendar,
  DollarSign,
  Award,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { unwrap } from "@/lib/supabaseResult";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { categoryLabels } from "@/components/activity/activityConstants";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { ErrorState } from "@/components/ui/ErrorState";
import { shareNative } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";
import { toast } from "sonner";
import { formatPrice } from "@/lib/format";
import HelprMark from "@/components/HelprMark";
import type { Database } from "@/integrations/supabase/types";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { sumHelperTakeHomeDollars } from "@/lib/helperEarnings";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface WorkRecordData {
  profile: {
    full_name: string | null;
    approval_status: string;
    idv_status: string | null;
    created_at: string;
  };
  completedJobs: Job[];
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
  topCategories: string[];
  dateRange: { first: string; last: string } | null;
}

function formatMonthYear(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Why the Print button is conditional: `window.print()` is a NO-OP in every
// WKWebView-hosted context this record actually gets opened from. The shipped
// app has no `server.url` (capacitor.config.ts), so it runs the bundled dist/
// inside WKWebView, which ships no print dialog at all; an iOS home-screen
// install hits the same wall, because manifest.webmanifest declares
// `display: standalone` and standalone WebKit has no print UI either. The tap
// fired, nothing happened, and a helper standing in a leasing office concluded
// the app was broken. So detect those contexts and never render a control that
// promises a printer that isn't there — route them to the share path instead
// (which already works: Capacitor Share → OS share sheet) and say plainly where
// the printable copy lives.
const isIosStandalonePwa =
  typeof navigator !== "undefined" &&
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const canPrintDocument =
  !isNativePlatform &&
  !isIosStandalonePwa &&
  typeof window !== "undefined" &&
  typeof window.print === "function";


const WorkRecord = () => {
  usePageTitle("Work Record — Helpr");
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const userId = user?.id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["work-record", userId],
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<WorkRecordData> => {
      if (!userId) throw new Error("Not authenticated");

      // Fetch profile + the helper's subscription tier. The tier rate is ONLY
      // the fallback for legacy rows with no recorded fee — expiry is read too
      // so a lapsed paid tier reverts to the free rate, exactly as
      // /wrapped and /profile resolve it.
      const profileRes = await supabase
        .from("profiles")
        .select("full_name, approval_status, idv_status, created_at, subscription_tier, subscription_expires_at")
        .eq("user_id", userId)
        .single();
      const profileRow = unwrap(profileRes) as {
        full_name: string | null;
        approval_status: string;
        idv_status: string | null;
        created_at: string;
        subscription_tier: string | null;
        subscription_expires_at: string | null;
      };
      const profile = {
        full_name: profileRow.full_name,
        approval_status: profileRow.approval_status,
        idv_status: profileRow.idv_status,
        created_at: profileRow.created_at,
      };
      const feeFallbackPercent = tierFeePercent(
        profileRow.subscription_tier,
        profileRow.subscription_expires_at,
      );

      // Fetch completed jobs where this user was the helper
      const jobsRes = await supabase
        .from("jobs")
        .select("*")
        .eq("helper_id", userId)
        .eq("status", "completed")
        .order("created_at", { ascending: false });
      const completedJobs = unwrap(jobsRes) as Job[];

      // Fetch reviews received as helper
      const reviewsRes = await supabase
        .from("reviews")
        .select("rating")
        .eq("reviewee_id", userId);
      const reviews = unwrap(reviewsRes) as { rating: number }[];

      const reviewCount = reviews.length;
      const avgRating =
        reviewCount > 0
          ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10
          : null;

      // Total earnings, resolved PER JOB by the shared helper: the fee stamped
      // at payout wins, then the % frozen on the row, then (legacy rows only)
      // the tier rate — plus the net urgent bonus the helper was actually
      // paid, and a group job's budget divided across its roster. This is an
      // official employment/earnings document, so it must report what each job
      // really paid, not today's tier applied backwards or a group job's full
      // budget when only 1/N of it was transferred.
      const totalEarnings = sumHelperTakeHomeDollars(completedJobs, feeFallbackPercent);

      // Top categories by frequency
      const catCounts = new Map<string, number>();
      for (const j of completedJobs) {
        const cat = j.category ?? "other";
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
      }
      const topCategories = Array.from(catCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([cat]) => cat);

      // Date range
      let dateRange: { first: string; last: string } | null = null;
      if (completedJobs.length > 0) {
        const sorted = [...completedJobs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        dateRange = {
          first: sorted[0].created_at,
          last: sorted[sorted.length - 1].created_at,
        };
      }

      return {
        profile,
        completedJobs,
        totalEarnings,
        avgRating,
        reviewCount,
        topCategories,
        dateRange,
      };
    },
  });

  const loading = isLoading && !data;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // There is NO public work-record route or share token: /work-record is
  // ProtectedRoute-wrapped and always renders the VIEWER's own record, so the
  // old `${origin}/work-record` link sent the recipient to their own record —
  // or a login wall — never the sharer's. Rather than invent a token/route,
  // share the record's verifiable claims as self-contained text plus the same
  // verification address the document footer prints, and point the link at the
  // Helpr homepage (a page that really does exist and really is about Helpr).
  //
  // The dollar figure is deliberately NOT in the share text: a share sheet can
  // land anywhere, and the original text disclosed only a job count. Anyone who
  // needs income verification uses Print (→ Save as PDF), which carries the
  // full document.
  async function handleShare() {
    if (!data) return;
    const jobs = data.completedJobs.length;
    const period = data.dateRange
      ? ` (${formatMonthYear(data.dateRange.first)} – ${formatMonthYear(data.dateRange.last)})`
      : "";
    const lines = [
      `Helpr Work Record — ${data.profile.full_name ?? "Helpr Member"}`,
      `${jobs} job${jobs === 1 ? "" : "s"} completed on Helpr${period}`,
      data.avgRating !== null
        ? `${data.avgRating.toFixed(1)}★ average across ${data.reviewCount} review${data.reviewCount === 1 ? "" : "s"}`
        : null,
      data.profile.idv_status === "verified" ? "ID verified by Helpr" : null,
      "Verify this record: admin@louisianahelpr.com",
    ].filter((l): l is string => !!l);

    await shareNative({
      title: "My Helpr Work Record",
      text: lines.join("\n"),
      url: window.location.origin,
      dialogTitle: "Share my Helpr Work Record",
    });
  }

  // Even where a print dialog is supposed to exist, a throwing `print()` must
  // not read as a dead tap — say so and point at the control that does work.
  function handlePrint() {
    try {
      window.print();
    } catch {
      toast.error("Couldn't open the print dialog.", {
        description: "Use Share summary to send this record instead.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Work Record"
        eyebrow="Employment & Earnings"
        backTo="/profile"
        // No `width` — the header takes its `default` geometry, which IS the
        // body class below, so title and content share one edge at every size.
      />

            {/* CANONICAL DOCUMENT-SCROLL SHELL — identical on every page that wears
          it: `min-h-screen bg-premium-page pb-safe-nav` > <PageHeader> (default
          width) > `page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8`.
          The header's `default` width IS this body class, so the title and the
          content share one left edge at every breakpoint. Owner: these pages
          "should share layouts ... there should not be any off from the rest",
          so do not give this page its own max-width or gutter ladder. */}
      <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8 space-y-5">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}
          </div>
        )}

        {isError && !loading && (
          <ErrorState
            variant="inline"
            title="Couldn't load your work record"
            onRetry={() => refetch()}
          />
        )}

        {!loading && !isError && data && (
          <>
            {/* Official Document Card — the SHEET surface, `.doc-card` from
                the document surface ladder in index.css (see the block comment
                there). Still a deliberate deviation from the `rounded-2xl
                liquid-glass p-5` card convention: this is a printed letterhead
                whose sections bleed edge-to-edge, so it needs a material
                without geometry, which is exactly what `.doc-card` is.

                It replaces a hand-rolled `parchment/0.90` fill that composited
                to within 2-6/255 of the page canvas — a document that did not
                read as a sheet of paper on a desk, just as a slightly
                different patch of desk. `print:shadow-none` came off with it:
                the ladder's own @media print rule drops the shadow, and the
                class could no longer win against `.doc-card` anyway. */}
            <div className="doc-card rounded-ds-lg overflow-hidden">
              {/* Document header */}
              <div
                className="px-5 pt-5 pb-4"
                style={{ borderBottom: "1px solid var(--doc-hairline)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <HelprMark size="md" />
                    <h2
                      className="font-display italic font-bold mt-3 text-ds-20 leading-tight"
                      style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
                    >
                      Employment &amp; Earnings Record
                    </h2>
                    <p className="font-serif italic text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                      Generated {today}
                    </p>
                  </div>
                  <div
                    className="shrink-0 w-14 h-14 rounded-ds-lg flex items-center justify-center"
                    style={{ background: "hsl(var(--bark) / 0.10)" }}
                  >
                    <Award className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} />
                  </div>
                </div>
              </div>

              {/* Identity section */}
              <div
                className="px-5 py-4 space-y-2"
                style={{ borderBottom: "1px solid var(--doc-hairline)" }}
              >
                {/* ONE ROW, THREE FACTS (owner: "remove platform, make issued
                    to / id pending / member since 1 line"). This was a 2x2
                    grid whose fourth cell read "Platform · Helpr (Louisiana)"
                    — the name of the document you are already holding, on the
                    document. With it gone the three real facts fit one line.

                    Three EVEN columns rather than a flex run: on a document,
                    field labels line up. Bunched at the left they left two
                    thirds of the sheet empty and read as a fragment of a row
                    rather than the row itself (owner: "space this out
                    better"). */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Issued to
                    </p>
                    <p className="text-ds-14 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      {data.profile.full_name ?? "Helpr Member"}
                    </p>
                  </div>
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      ID Verified
                    </p>
                    <p className="text-ds-13 font-semibold inline-flex items-center gap-1">
                      {data.profile.idv_status === "verified" ? (
                        <>
                          <CheckCircle className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
                          <span style={{ color: "hsl(var(--bark))" }}>Verified</span>
                        </>
                      ) : (
                        <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>Pending</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Member since
                    </p>
                    <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
                      {formatMonthYear(data.profile.created_at)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary stats. The "WORK SUMMARY" label is now a real BAND —
                  a full-bleed strip filled one value step below the sheet
                  (`.doc-band`) with its own bottom rule — instead of a line of
                  small caps floating in the same fill as the content under it.
                  A section header that shares its background with its own
                  contents is not a header; it is the first row. */}
              <div style={{ borderBottom: "1px solid var(--doc-hairline)" }}>
                <div className="doc-band px-5 py-2">
                  <p
                    className="doc-band-ink font-serif italic uppercase text-ds-9"
                    style={{ letterSpacing: "0.18em" }}
                  >
                    Work Summary
                  </p>
                </div>
                <div className="px-5 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Jobs completed */}
                    <StatBlock
                      icon={<Briefcase className="w-4 h-4" />}
                      label="Jobs Completed"
                      value={String(data.completedJobs.length)}
                    />
                    {/* Total earnings */}
                    <StatBlock
                      icon={<DollarSign className="w-4 h-4" />}
                      label="Total Earnings"
                      value={`$${formatPrice(data.totalEarnings)}`}
                      sub="after platform fee"
                    />
                    {/* Date range */}
                    <StatBlock
                      icon={<Calendar className="w-4 h-4" />}
                      label="Active Period"
                      value={
                        data.dateRange
                          ? `${formatMonthYear(data.dateRange.first)} – ${formatMonthYear(data.dateRange.last)}`
                          : "—"
                      }
                    />
                    {/* Rating */}
                    <StatBlock
                      icon={<Star className="w-4 h-4" />}
                      label="Avg Rating"
                      value={
                        data.avgRating !== null
                          ? `${data.avgRating.toFixed(1)} ★ (${data.reviewCount})`
                          : "No reviews yet"
                      }
                    />
                  </div>

                  {/* NO "TOP CATEGORIES" (owner: "remove"). The Work Record
                      is a verification document — the thing a helpr hands a
                      landlord or a lender — and a row of category pills is
                      profile decoration, not a record of work. Everything else
                      on this card is a countable fact (jobs completed, amount
                      earned, active period, rating); this was a tag cloud
                      derived from them. `topCategories` stays in the data for
                      the analytics surfaces that do use it. */}
                </div>
              </div>

              {/* The per-job "RECENT JOBS" table (title / category / amount /
                  date, ten rows) was removed deliberately. This sheet exists to
                  be handed to a landlord or a lender as proof of work and
                  income, and the WORK SUMMARY above — jobs completed, total
                  earnings, active period, rating, top categories — is the whole
                  of what that recipient needs to verify. An itemised list of who
                  the helper worked for and what they did in each home is client
                  detail with no bearing on the claim being proved, so printing
                  it just leaked other people's business to a third party. */}

              {/* No jobs empty state inside the document */}
              {data.completedJobs.length === 0 && (
                <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
                  <Briefcase className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-ds-13 text-muted-foreground font-serif italic">
                    No completed helper jobs yet. Once you complete your first job, your work record will fill in automatically.
                  </p>
                  <BarkPillButton onClick={() => navigate("/dashboard")} className="mt-1">
                    Browse jobs
                  </BarkPillButton>
                </div>
              )}

              {/* Document footer — same band rung as the section headers, so
                  the sheet has exactly two surface values inside it (sheet and
                  band) instead of a third one-off `bark/0.04` wash that read
                  as neither. */}
              <div
                className="px-5 py-4 text-center"
                style={{ background: "var(--doc-band)" }}
              >
                {/* TWO LINES (owner). Two things had to give: the measure and
                    the copy. A 62ch cap balanced the old sentence into THREE
                    even lines — balancing distributes, it does not shorten — so
                    the cap comes off and the sentence is cut to what a landlord
                    or lender actually needs: when it was generated, what it is
                    generated from, what Helpr is, and where to verify it. */}
                <p
                  className="font-serif italic text-ds-11 leading-relaxed mx-auto"
                  style={{ color: "hsl(var(--olivewood) / 0.8)", textWrap: "balance" }}
                >
                  {/* "verified" is only true of an account whose identity Helpr
                      actually checked. This sheet gets handed to landlords and
                      lenders, so on a Pending account it states what it can
                      support — the job history — and nothing more. */}
                  {data.profile.idv_status === "verified" ? (
                    <>This record was generated from Helpr&rsquo;s verified job history on {today}.</>
                  ) : (
                    <>
                      This record was generated from this member&rsquo;s completed job history on
                      Helpr on {today}. Identity verification is still pending.
                    </>
                  )}{" "}
                  Helpr is a Louisiana-based labor marketplace.
                  For verification inquiries:{" "}
                  <a
                    href="mailto:admin@louisianahelpr.com"
                    className="underline"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    admin@louisianahelpr.com
                  </a>
                </p>
              </div>
            </div>

            {/* Share CTA. `data-print-hide` (the app-wide print-chrome hook —
                see the @media print block in index.css) keeps the Share/Print
                controls off the saved PDF: this record is printed as an
                income/employment document, and an interactive button row on
                page 1 undercuts that. */}
            <div data-print-hide className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => { void handleShare(); }}
                className="flex-1 flex items-center justify-center gap-2 rounded-ds-lg py-3.5 text-ds-14 font-semibold active:scale-[0.99] transition-all"
                style={{
                  background: "hsl(var(--bark) / 0.10)",
                  border: "1px solid hsl(var(--bark) / 0.30)",
                  color: "hsl(var(--bark))",
                }}
              >
                <Share2 className="w-4 h-4" />
                Share Summary
              </button>
              {canPrintDocument && (
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex items-center justify-center gap-2 rounded-ds-lg py-3.5 px-5 text-ds-14 font-semibold active:scale-[0.99] transition-all"
                  style={{
                    background: "transparent",
                    border: "1px solid hsl(var(--bark) / 0.32)",
                    color: "hsl(var(--bark))",
                  }}
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
              )}
            </div>

            {/* No print dialog here (see `canPrintDocument` above). Rather than
                leave the helper guessing why the button vanished, name the one
                place a printable PDF really can be made. */}
            {!canPrintDocument && (
              <p
                data-print-hide
                className="font-serif italic text-ds-12 text-center leading-relaxed px-2"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Printing isn&rsquo;t available inside the app. Share the summary above, or
                open louisianahelpr.com in a browser and sign in to print or save
                this record as a PDF.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

interface StatBlockProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function StatBlock({ icon, label, value, sub }: StatBlockProps) {
  return (
    // `.doc-tile` — the inset-well rung of the document surface ladder. The
    // old `parchment/0.55` fill composited to within 0.3/255 of the card it
    // sat on, so the four stats read as loose text floating in the sheet
    // rather than as four tiles; on a document meant to be handed to a
    // landlord or a lender, that is the difference between a figure and a
    // stated figure.
    <div className="doc-tile rounded-ds-md px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: "hsl(var(--bark))" }}>{icon}</span>
        <span className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-ds-15 font-bold leading-tight" style={{ color: "hsl(var(--ink-deep))" }}>
        {value}
      </p>
      {sub && (
        <p className="text-ds-10 text-muted-foreground mt-0.5">{sub}</p>
      )}
    </div>
  );
}

export default WorkRecord;
