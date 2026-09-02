import { useState } from "react";
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
  Loader2,
} from "lucide-react";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { unwrap } from "@/lib/supabaseResult";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { ErrorState } from "@/components/ui/ErrorState";
import { shareNative, shareFileNative } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { formatPriceFloor } from "@/lib/format";
import HelprMark from "@/components/HelprMark";
import type { Database } from "@/integrations/supabase/types";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import {
  buildWorkRecordPdf,
  buildWorkRecordSummaryLines,
  formatMonthYear,
  formatWorkDayMonthYear,
  formatLongDate,
  resolveWorkDayRange,
  type WorkRecordDocumentInput,
} from "@/lib/workRecordDocument";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface WorkRecordData {
  profile: {
    full_name: string | null;
    approval_status: string;
    stripe_identity_verified: boolean | null;
    created_at: string;
  };
  completedJobs: Job[];
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
  topCategories: string[];
  /** First/last DAY WORKED, `YYYY-MM-DD`. See `resolveWorkDayRange`. */
  workDays: { first: string; last: string } | null;
}

// `formatMonthYear` now lives in `@/lib/workRecordDocument` alongside the rest
// of the document's content rules, so the shared PDF and this screen cannot
// render the same date two ways.

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


/**
 * WorkRecord — the Profile "Work Record" tab body.
 *
 * Was the standalone route `/work-record` until 2026-09-02. It was only ever
 * reached from Profile's own chrome, so it was a Profile tab implemented as a
 * route.
 *
 * Renders the canonical tab body — `space-y-4` under a ProfileTabHeader — and
 * NOT AppPage. AppPage is AppShell + that header, and Profile.tsx already owns
 * the AppShell; keeping it here would nest two 100dvh viewport locks.
 */
const WorkRecord = ({ onBack }: { onBack?: () => void }) => {
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
        .select("full_name, approval_status, stripe_identity_verified, created_at, subscription_tier, subscription_expires_at")
        .eq("user_id", userId)
        .single();
      const profileRow = unwrap(profileRes) as {
        full_name: string | null;
        approval_status: string;
        stripe_identity_verified: boolean | null;
        created_at: string;
        subscription_tier: string | null;
        subscription_expires_at: string | null;
      };
      const profile = {
        full_name: profileRow.full_name,
        approval_status: profileRow.approval_status,
        stripe_identity_verified: profileRow.stripe_identity_verified,
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

      // The Active Period, resolved by the shared document rule rather than
      // here: min/max of the day each job was WORKED (`date_needed`), not the
      // day it was posted (`created_at`), which is what this sorted `created_at`
      // range used to report. `resolveWorkDayRange` owns the null-`date_needed`
      // fallback and the zone handling, and lives beside the formatter that
      // prints the result so the screen and the PDF cannot diverge.
      const workDays = resolveWorkDayRange(completedJobs);

      return {
        profile,
        completedJobs,
        totalEarnings,
        avgRating,
        reviewCount,
        topCategories,
        workDays,
      };
    },
  });

  const loading = isLoading && !data;
  const today = formatLongDate(new Date());

  // WHAT GETS SHARED: THE RECORD, AS A PDF.
  //
  // This used to pass `{ text: <good summary>, url: getPublicSiteUrl() }`. iOS
  // prefers the URL when it is handed both — so the share sheet rendered the
  // link preview for the marketing homepage and the summary was buried or
  // dropped. Owner: "Just shared the website not their work history."
  //
  // No URL could have been right. `/work-record` is ProtectedRoute-wrapped and
  // always renders the VIEWER's own record; `/user/:userId` is protected too;
  // there is no share token, no public record route, nothing to link to. A
  // fabricated link would 404 or show the recipient their own empty record,
  // which is worse than no link — so the homepage is not swapped for another
  // URL, it is removed.
  //
  // What a leasing office, a lender or an employer can actually act on is a
  // document, which is what this sheet already claims to be. So: build the
  // record as a PDF and hand the OS the file — the same idiom calendarExport.ts
  // uses, files-only so iOS offers Save to Files / Mail / Print instead of
  // link targets. The text summary survives as the FALLBACK for when the PDF
  // can't be built (offline, chunk load failure), now with no `url` at all.
  const [isSharing, setIsSharing] = useState(false);

  function documentInput(d: WorkRecordData): WorkRecordDocumentInput {
    return {
      fullName: d.profile.full_name,
      memberSince: d.profile.created_at,
      // Stripe Connect's own verdict only (see the footer comment below).
      identityVerified: d.profile.stripe_identity_verified === true,
      jobsCompleted: d.completedJobs.length,
      totalEarnings: d.totalEarnings,
      avgRating: d.avgRating,
      reviewCount: d.reviewCount,
      firstWorkDay: d.workDays?.first ?? null,
      lastWorkDay: d.workDays?.last ?? null,
      generatedAt: new Date(),
    };
  }

  async function handleShare() {
    // Guarding on `isSharing` matters: building the PDF is async, and a double
    // tap would stage two files and open two sheets.
    if (!data || isSharing) return;
    setIsSharing(true);
    const input = documentInput(data);
    try {
      const file = await buildWorkRecordPdf(input);
      const outcome = await shareFileNative({
        ...file,
        title: "Helpr Employment & Earnings Record",
        dialogTitle: "Share my Helpr Work Record",
        source: "workRecord",
        // `shareFileNative` confirms its own web downloads now; this screen
        // opts out and says it in the terms that matter HERE — what the file is
        // for, on the page whose whole purpose is handing it to a third party.
        suppressDownloadConfirmation: true,
      });
      // The web branch is a download: the page is pixel-identical afterwards
      // and desktop Safari writes to ~/Downloads in silence, so this is the
      // ONLY thing that tells the user the record exists.
      //
      // The bare `toast(...)` callable, NOT `toast.success` — which is what
      // this was, and which `src/lib/toastPolicy.ts` no-ops app-wide for any
      // payload without an `action`. The line read as live and rendered
      // nothing, on the exact branch it was written to cover.
      if (outcome === "downloaded") {
        toast("Work record saved", { description: `${file.fileName} — attach or print it.` });
      }
    } catch (err) {
      // The PDF itself couldn't be built. Fall back to the text summary — and
      // note there is still NO url on it. Whatever else goes wrong, the one
      // thing that must never happen again is sending the homepage.
      report(err, { severity: "error", tags: { source: "workRecord.buildPdf" } });
      await shareNative({
        title: "My Helpr Work Record",
        text: buildWorkRecordSummaryLines(input).join("\n"),
        dialogTitle: "Share my Helpr Work Record",
      });
    } finally {
      setIsSharing(false);
    }
  }

  // Even where a print dialog is supposed to exist, a throwing `print()` must
  // not read as a dead tap — say so and point at the control that does work.
  function handlePrint() {
    try {
      window.print();
    } catch {
      toast.error("Couldn't open the print dialog.", {
        description: "Use Share Record (PDF) to send this record instead.",
      });
    }
  }

  return (
    // The canonical Profile tab body: `space-y-4` under a ProfileTabHeader,
    // matching every other tab. NOT AppPage — that is AppShell + this header,
    // and Profile.tsx already owns the AppShell. The old "Employment &
    // Earnings" eyebrow has no equivalent on this header; the document card
    // below already prints "Employment & Earnings Record" as its own heading.
    <div className="space-y-4">
      <ProfileTabHeader title="Work Record" onBack={onBack} />
      {/* `space-y-5` preserved from the old body wrapper — it spaces the
          document card from the share/print controls under it. */}
      <div className="space-y-5">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}
          </div>
        )}

        {isError && !loading && (
          <ErrorState
            variant="inline"
            title="We couldn't load your work record"
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
                      ID verified by Stripe
                    </p>
                    <p className="text-ds-13 font-semibold inline-flex items-center gap-1">
                      {data.profile.stripe_identity_verified === true ? (
                        <>
                          <CheckCircle className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
                          <span style={{ color: "hsl(var(--bark))" }}>Verified</span>
                        </>
                      ) : (
                        <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>Not verified</span>
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
                    {/* Total earnings. Floored: on a document a helpr shows a
                        prospective client as a record of what they were paid,
                        this is the one number that must never read a cent
                        above the transfers.

                        The figure is take-home and stays take-home. It carried
                        an "after platform fee" sub-label, removed from the PDF
                        and then from here on 2026-08-31 (owner) so the two
                        surfaces say the same thing. Only the caption went. */}
                    <StatBlock
                      icon={<DollarSign className="w-4 h-4" />}
                      label="Total Earnings"
                      value={`$${formatPriceFloor(data.totalEarnings)}`}
                    />
                    {/* Active Period — the months WORKED (`date_needed`), not
                        the months the jobs were posted in. `workDays` holds
                        bare `YYYY-MM-DD` calendar days, so it must go through
                        `formatWorkDayMonthYear`, which applies no offset;
                        `formatMonthYear` would shift a day-1 value back into
                        the previous month. */}
                    <StatBlock
                      icon={<Calendar className="w-4 h-4" />}
                      label="Active Period"
                      value={
                        data.workDays
                          ? `${formatWorkDayMonthYear(data.workDays.first)} – ${formatWorkDayMonthYear(data.workDays.last)}`
                          : "—"
                      }
                    />
                    {/* Rating */}
                    <StatBlock
                      icon={<Star className="w-4 h-4" />}
                      label="Avg Rating"
                      value={
                        data.avgRating !== null
                          ? `${data.avgRating.toFixed(1)} (${data.reviewCount})`
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
                    Browse Jobs
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
                  {/* "verified" is only true of an account whose identity
                      STRIPE actually checked (profiles.stripe_identity_verified,
                      cached from the account.updated webhook). It is NOT
                      `idv_status` — that is an upload/admin state nobody
                      reviews, so it could never support this claim. This sheet
                      gets handed to landlords and lenders, so on an unverified
                      account it states what it can support — the job history —
                      and nothing more. */}
                  {data.profile.stripe_identity_verified === true ? (
                    <>
                      This record was generated from Helpr&rsquo;s job history on {today}. This
                      member&rsquo;s identity was verified by Stripe.
                    </>
                  ) : (
                    <>
                      This record was generated from this member&rsquo;s completed job history on
                      Helpr on {today}. This member&rsquo;s identity has not been verified by
                      Stripe.
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
                page 1 undercuts that.

                HIDDEN ENTIRELY UNTIL THERE IS A RECORD TO SHARE.

                With zero completed jobs the button worked perfectly and
                produced a truthful, signed-looking PDF reading "Jobs Completed
                0 / Total Earnings $0 / Active Period —". There is no reader
                for that document. Its only audience is a landlord, a lender or
                an employer, and handing one a formal sheet stating you have
                never worked is strictly worse for the helper than handing them
                nothing — it converts "no history yet" into a filed, dated
                claim about them.

                So it is hidden rather than relabelled. Different copy on the
                button ("Share anyway", "Share empty record") only moves the
                trap one tap later: the PDF it produces is the same PDF, and
                the person most likely to press through a warning is the one
                who least understands what the sheet will say about them.

                Nothing is left dangling by hiding it, which is the test for
                whether hiding is honest: the empty state directly above
                already explains the state ("No completed helper jobs yet …
                your work record will fill in automatically") and offers the
                action that actually helps — Browse Jobs. That is the correct
                primary control for someone with no history, and with the share
                row gone it is the only one, instead of competing with a button
                that leads somewhere harmful.

                Print goes with it for the same reason and one more: it prints
                this same empty sheet. */}
            {data.completedJobs.length > 0 && (
            <div data-print-hide className="flex flex-col sm:flex-row gap-3">
              {/* "Share Record", not "Share Summary" — what leaves the app is
                  now the document itself (a PDF of this sheet), not a blurb.
                  The label has to match, because the helper is standing in a
                  leasing office deciding whether this button will produce
                  something the clerk will accept. */}
              <button
                type="button"
                onClick={() => { void handleShare(); }}
                disabled={isSharing}
                aria-busy={isSharing}
                className="flex-1 flex items-center justify-center gap-2 rounded-ds-lg py-3.5 text-ds-14 font-semibold active:scale-[0.99] transition-all disabled:opacity-60"
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
            )}

            {/* No print dialog here (see `canPrintDocument` above). The share
                path is no longer a consolation prize — it now hands over a PDF
                of this exact document — so say that, instead of the old line
                that sent people to a desktop browser to get a real file.

                Gated on having a record too: with no completed jobs there is no
                Share Record button for this sentence to explain, so it would be
                describing a control that isn't on the screen. */}
            {!canPrintDocument && data.completedJobs.length > 0 && (
              <p
                data-print-hide
                className="font-serif italic text-ds-12 text-center leading-relaxed px-2"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Printing isn&rsquo;t available inside the app, so Share Record sends this
                document as a PDF you can save to Files, attach to an email, or hand
                to a landlord or lender.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// No `sub` slot. Its only caller was Total Earnings' "after platform fee"
// caption, removed 2026-08-31 to match the PDF; an unused optional prop is a
// standing invitation to put the caption back on this surface alone.
interface StatBlockProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatBlock({ icon, label, value }: StatBlockProps) {
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
    </div>
  );
}

export default WorkRecord;
