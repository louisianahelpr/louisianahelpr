import { useState } from "react";
import { Link } from "react-router-dom";
import {
  DollarSign, Shield, FileText, ChevronRight, Clock,
  Crown, XCircle, AlertTriangle, Ban, Scale,
  Building2, Wallet, HeartPulse, Siren, Download, Loader2,
} from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { report } from "@/lib/errorLogger";
import { hapticError } from "@/lib/haptics";
import { toast } from "sonner";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { BUSINESS_SEAT_TIERS, formatSeatPriceMonthly } from "@/lib/businessSeatTiers";
import {
  MIN_JOB_BUDGET_DOLLARS,
  MAX_JOB_BUDGET_DOLLARS,
  URGENT_FEE_FLOOR_DOLLARS,
  LATE_CANCEL_PERCENT,
  VERY_LATE_CANCEL_PERCENT,
  NEW_HELPER_EARNINGS_CAP_DOLLARS,
  formatDollarsWhole,
} from "@/lib/moneyLimits";

// Pull tier pricing/fees from the single source of truth so the Legal copy
// can never drift from the Subscription page or the in-feed fee math (LH-30).
const fmtMo = (n: number | null) => (n == null ? "free" : `$${n.toFixed(2)}/mo`);

// This tab reuses the shared PolicySection / PolicyRowItem from
// CollapsedPolicy.tsx — the same accordion primitives the /legal page
// renders — so the Profile Legal tab and /legal are visually identical.
// Those components read PolicySearchContext, which defaults to "" when
// no provider is mounted, so they work here without any search UI.

// ---------- Data rights ----------

/**
 * GDPR Art. 20 / CCPA data portability — the "Download your data" control.
 *
 * MERGED HERE 2026-08-18 from the standalone `/data-rights` page. That route
 * had been reduced to a single button once its inert CCPA "do not sell or
 * share" toggle came out (7e62af5f), and a whole route for one control is
 * not a screen. `/data-rights` now redirects here (App.tsx) rather than 404 —
 * the Privacy Policy promises this export IN WRITING and links to it, and the
 * iOS App Store privacy listing points at the URL too, so the old address has
 * to keep resolving somewhere that actually offers the download.
 *
 * Deliberately NOT here: account deletion (GDPR Art. 17 erasure). It lives on
 * the Profile landing / Settings screen only, so there is exactly ONE entry
 * point to an irreversible action rather than two that can drift apart.
 *
 * Own component (not inlined into LegalTab) purely so the `exporting` state
 * transition re-renders this card instead of the whole policy document below.
 */
function DataExportCard() {
  // Derive the user id from the app-wide auth snapshot (getSession-backed,
  // local, offline-safe) rather than a network getUser() call. The null guard
  // remains because a failed getUser() round-trip used to leave `userId` null
  // and the export button permanently disabled even with a valid local session.
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!userId) return;
    setExporting(true);
    try {
      const [profileRes, jobsRes, applicationsRes, reviewsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("jobs").select("*").or(`customer_id.eq.${userId},helper_id.eq.${userId}`),
        supabase.from("applications").select("*").eq("helper_id", userId),
        supabase.from("reviews").select("*").or(`reviewer_id.eq.${userId},reviewee_id.eq.${userId}`),
      ]);

      // Never drop the Supabase `error` — a swallowed failure would hand the
      // user a JSON file full of `null` and call it their data export.
      const firstError = profileRes.error || jobsRes.error || applicationsRes.error || reviewsRes.error;
      if (firstError) throw firstError;

      const payload = {
        exported_at: new Date().toISOString(),
        profile: profileRes.data,
        jobs: jobsRes.data,
        applications: applicationsRes.data,
        reviews: reviewsRes.data,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `helpr-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Your data has been downloaded");
    } catch (err) {
      report(err, { tags: { source: "LegalTab.exportData" } });
      hapticError();
      toast.error("We couldn't put your data together just now — try again or email support.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Same card anatomy as the three anchor-doc rows above (liquid-glass
          squircle, 10x10 primary icon badge, display title + muted body) so
          the tab reads as one surface — but no hover-lift, because this card
          ACTS rather than navigates and shouldn't borrow a link's affordance. */}
      <section className="rounded-2xl liquid-glass squircle p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Download className="w-4 h-4" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-foreground leading-tight text-ds-15">
              Download your data
            </h2>
            <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
              Get a complete copy of your Helpr data — profile, posted jobs, applications, and reviews — as a single JSON file.
            </p>
          </div>
        </div>
        {/* flex-wrap lets the format hint and the button stack on a narrow
            phone instead of squeezing the 44px-tall button below target size. */}
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3"
          style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
        >
          <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            JSON file
          </span>
          <Button
            onClick={handleExport}
            disabled={exporting || !userId}
            aria-busy={exporting}
            variant="primary"
            size="sm"
            className="shrink-0"
          >
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />Preparing…</> : "Download my data"}
          </Button>
        </div>
      </section>

      {/* The GDPR/CCPA footnote travels WITH the export control — it is the
          legal context for why the right exists, and it carries the contact
          route for every privacy question the button doesn't answer. Routes
          to the in-app support form, not a raw `mailto:` (which needs a
          configured mail client and does nothing inside the native app). */}
      <p className="text-ds-11 leading-relaxed px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Under the EU GDPR and California CCPA, you have specific rights about how Helpr handles your personal data.
        For any other privacy question,{" "}
        <Link to="/support" className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>contact support</Link>.
      </p>
    </div>
  );
}

// ---------- Page ----------

export function LegalTab({ onBack }: { onBack: () => void }) {
  return (
    // Safe-area-aware bottom padding (~6rem) so the bottom section
    // ("Operations & Safety") scrolls clear of the MobileNav dock + FAB
    // on iPhone without leaving a large empty dead-zone below it.
    <div
      className="space-y-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
    >
      <ProfileTabHeader
        title="Legal &amp; policies"
        onBack={onBack}
      />

      {/* Anchor docs — dedicated full-text pages.
          AFFORDANCE: these three rows NAVIGATE IN-APP. `/rules`, `/terms` and
          `/privacy` are <Navigate> redirects to `/legal?tab=…` (see App.tsx),
          which renders inside AppShell on native — nothing leaves the app, no
          browser opens, no new window. They carried an `ExternalLink` (↗)
          glyph, which promised exactly that. On a legal screen, where the
          whole question is where your data goes, a lying affordance is worse
          than cosmetic, so they now carry the app's forward chevron (›) — the
          same glyph SupportInline's "Browse the Help Center" row uses for the
          same behaviour.

          The screen's three affordances, kept distinct:
            ›  chevron-right  → navigates in-app        (these three rows)
            ⌄  chevron-down   → expands in place        (PolicySection /
                                                         PolicyRowItem below)
            ↗  external-link  → opens outside the app   (nothing on this
                                                         screen does; if a row
                                                         ever does, it keeps ↗) */}
      <div>
        <div className="space-y-2">
          {([
            { to: "/rules", icon: FileText, title: "Platform rules", body: "How Helpr works — every guideline that governs jobs, payments, and conduct." },
            { to: "/terms", icon: Scale, title: "Terms of service", body: "The contract between you and Helpr when you use the platform." },
            { to: "/privacy", icon: Shield, title: "Privacy policy", body: "What we collect, how we use it, and how we keep it safe." },
          ]).map(({ to, icon: Icon, title, body }) => (
            <Link
              key={to}
              to={to}
              className="glass-press block rounded-2xl liquid-glass squircle p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" strokeWidth={2.25} />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Clean font-display heading — matches the shared
                      PolicySection cards below so the whole tab speaks
                      one type language. */}
                  <p className="font-display font-bold text-foreground leading-tight text-ds-15">
                    {title}
                  </p>
                  <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
                    {body}
                  </p>
                </div>
                {/* aria-hidden: the row's accessible name already comes from
                    the title + body text ("Platform rules, How Helpr works —
                    …"), which describes in-app navigation and never claims a
                    new window. The glyph is decoration on top of that. */}
                <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Data rights sit directly under the anchor docs, ABOVE the collapsed
          quick-reference sections. The Privacy Policy row is right above it
          and links here for portability ("Download a complete copy of your
          data…"), so the control it promises has to be reachable without
          scrolling past four accordions to find it. */}
      <DataExportCard />

      {/* Quick reference — concise summaries of platform-specific
          policies. Uses the shared PolicySection / PolicyRowItem so
          this tab is visually identical to the /legal page. */}
      <div className="space-y-2.5">

      {/* Community Guidelines — opened by default so the tab doesn't
          read as empty when every section is collapsed. */}
      <PolicySection
        icon={Building2}
        title="Community guidelines"
        subtitle="Respect, honesty, safety, and reporting"
        defaultOpen
      >
        <PolicyRowItem
          icon={Shield}
          title="The basics"
          body={
            <>
              <p><strong className="text-foreground">Respect:</strong> Treat every user with professionalism.</p>
              <p><strong className="text-foreground">Honesty:</strong> Accurate profiles and job descriptions only.</p>
              <p><strong className="text-foreground">Safety:</strong> Never share home addresses or financial details through messages.</p>
              <p><strong className="text-foreground">Reporting:</strong> Use the report button for anything suspicious.</p>
            </>
          }
        />
      </PolicySection>

      {/* 2. Financials */}
      <PolicySection
        icon={Wallet}
        title="Financials"
        subtitle="Payments, fees, budgets, and subscriptions"
      >
        <PolicyRowItem
          icon={DollarSign}
          title="Payment & Refund Policy"
          body={
            <>
              <p><strong className="text-foreground">Secure Payments:</strong> Payments are charged upfront via Stripe and held by the platform. The Helpr is paid only after both parties confirm the job is complete. Refunds are issued for cancelled jobs (subject to the cancellation policy).</p>
              <p><strong className="text-foreground">Auto-Release:</strong> If a job is not confirmed as complete within 48 hours after one party marks it done, it auto-completes and payment is released to the Helpr (funds typically reach them about 72 hours after completion).</p>
              <p><strong className="text-foreground">Revisions:</strong> Posters can request revisions within that same 48-hour confirmation window before approving completion.</p>
              <p><strong className="text-foreground">Disputes:</strong> If a revision doesn't resolve the issue, file a formal dispute. See Dispute Resolution for the full 3-step process.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={DollarSign}
          title="Platform Fees"
          body={
            <>
              <p><strong className="text-foreground">Poster Service Fee:</strong> added at checkout based on your plan — {TIER_PERKS.free.platformFeePercent}% on Free, {TIER_PERKS.basic.platformFeePercent}% on Basic, {TIER_PERKS.pro.platformFeePercent}% on Pro, {TIER_PERKS.elite.platformFeePercent}% on Elite, {TIER_PERKS.business.platformFeePercent}% on Business (a minimum applies so small jobs still cover card processing).</p>
              <p><strong className="text-foreground">Helpr Platform Fee:</strong> deducted from the Helpr's payout based on plan — {TIER_PERKS.free.platformFeePercent}% on Free, {TIER_PERKS.basic.platformFeePercent}% on Helpr Basic, {TIER_PERKS.pro.platformFeePercent}% on Helpr Pro, {TIER_PERKS.elite.platformFeePercent}% on Helpr Elite, {TIER_PERKS.business.platformFeePercent}% on Business.</p>
              <p><strong className="text-foreground">Total Platform Take:</strong> the poster's plan-based service fee plus the Helpr's plan-based fee above.</p>
              <p><strong className="text-foreground">Urgent Job Fee:</strong> {formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)} fee for posters who mark a job as urgent.</p>
              <p><strong className="text-foreground">Job Boost:</strong> Optional paid boost to increase visibility of your listing.</p>
              <p><strong className="text-foreground">Tipping:</strong> 100% of tips go to the Helpr — no platform fee on tips.</p>
              <p><strong className="text-foreground">Sales Tax:</strong> Louisiana state and parish sales tax is collected on platform fees where applicable.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={DollarSign}
          title="Job Budget Limits"
          body={
            <>
              <p><strong className="text-foreground">Minimum:</strong> {formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)} per job.</p>
              <p><strong className="text-foreground">Maximum:</strong> {formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)} per job.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Crown}
          title="Membership Tiers"
          body={
            <>
              <p><strong className="text-foreground">Free ⭐:</strong> Standard access with a {TIER_PERKS.free.platformFeePercent}% platform fee on earnings.</p>
              <p><strong className="text-foreground">{TIER_PERKS.basic.name} 🌱 ({fmtMo(TIER_PERKS.basic.price)}):</strong> Instant payouts, 5-min early job access, 20% off job boosts, and a reduced {TIER_PERKS.basic.platformFeePercent}% platform fee.</p>
              <p><strong className="text-foreground">{TIER_PERKS.pro.name} 🔥 ({fmtMo(TIER_PERKS.pro.price)}):</strong> Everything in Basic plus priority placement, portfolio showcase, 10-min early access, and a reduced {TIER_PERKS.pro.platformFeePercent}% platform fee.</p>
              <p><strong className="text-foreground">{TIER_PERKS.elite.name} 💎 ({fmtMo(TIER_PERKS.elite.price)}):</strong> Everything in Pro plus a featured badge, early job access, dedicated support, and the lowest {TIER_PERKS.elite.platformFeePercent}% platform fee.</p>
              <p><strong className="text-foreground">{TIER_PERKS.business.name} 🏢:</strong> Team management with per-seat pricing ({BUSINESS_SEAT_TIERS.map((t) => `${t.name} ${formatSeatPriceMonthly(t.priceLabel)}`).join(" · ")}), a verified business badge, priority support, and a {TIER_PERKS.business.platformFeePercent}% platform fee across all seat plans.</p>
              <p><strong className="text-foreground">Annual Plans:</strong> Billed yearly at a discount (about 2 months free).</p>
              <p><strong className="text-foreground">Billing:</strong> One-time, monthly, or annual. Stripe handles billing dates automatically.</p>
            </>
          }
        />
      </PolicySection>

      {/* 3. Account Health (warning tint) */}
      <PolicySection
        icon={HeartPulse}
        title="Account Health"
        subtitle="Cancellations, strikes, and no-shows"
        warning
      >
        <PolicyRowItem
          icon={XCircle}
          warning
          title="Cancellation Policy"
          body={
            <>
              <p><strong className="text-foreground">Free Cancellation:</strong> Cancel 24+ hours before the job at no charge.</p>
              <p><strong className="text-foreground">Late Cancellation (&lt;24h):</strong> {LATE_CANCEL_PERCENT}% cancellation fee applied.</p>
              <p><strong className="text-foreground">Very Late Cancellation (&lt;2h):</strong> {VERY_LATE_CANCEL_PERCENT}% cancellation fee applied.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={AlertTriangle}
          warning
          title="Cancellation Strikes (Posters)"
          body={
            <>
              <p className="mb-1">Cancelling a job <strong className="text-foreground">after a Helpr has been selected</strong> triggers escalating penalties:</p>
              <p>• <strong className="text-accent">1st cancellation:</strong> Written warning (Strike 1/2)</p>
              <p>• <strong className="text-accent">2nd cancellation:</strong> Final warning (Strike 2/2)</p>
              <p>• <strong className="text-destructive">3rd cancellation:</strong> Permanent account ban</p>
              <p className="italic text-ds-11 mt-1">Cancelling jobs with no Helpr assigned does not count toward strikes.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Ban}
          warning
          title="Job Denial Strikes (Helprs)"
          body={
            <>
              <p className="mb-1">Declining a job <strong className="text-foreground">after being selected</strong> triggers escalating penalties:</p>
              <p>• <strong className="text-accent">1st decline:</strong> Written warning (Strike 1/2)</p>
              <p>• <strong className="text-accent">2nd decline:</strong> Final warning (Strike 2/2)</p>
              <p>• <strong className="text-destructive">3rd decline:</strong> Permanent account ban</p>
              <p className="italic text-ds-11 mt-1">Withdrawing your application before being selected does not count.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Ban}
          warning
          title="No-Show Policy"
          body={
            <p>If a Helpr accepts a job and fails to show up without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong> immediately. No warnings, no exceptions. The poster receives a full refund.</p>
          }
        />
        <PolicyRowItem
          icon={AlertTriangle}
          title="Repeat Offender Policy"
          body={
            <>
              <p><strong className="text-foreground">1st violation:</strong> Written warning via email and in-app notification.</p>
              <p><strong className="text-foreground">2nd violation:</strong> 7-day account suspension.</p>
              <p><strong className="text-foreground">3rd violation:</strong> Permanent ban from the platform.</p>
              <p className="italic text-ds-11 mt-1">Severe violations (no-shows, fraud, harassment) skip this ladder and result in an immediate permanent ban.</p>
            </>
          }
        />
      </PolicySection>

      {/* 4. Operations & Safety (warning tint) */}
      <PolicySection
        icon={Siren}
        title="Operations & Safety"
        subtitle="Bans, reports, disputes, and verification"
        warning
      >
        <PolicyRowItem
          icon={Shield}
          warning
          title="Immediate Ban Offenses"
          body={
            <>
              <p className="mb-1">These skip all warnings and result in an immediate permanent ban:</p>
              <p>• <strong className="text-foreground">No-show</strong> — accepting a job and not showing up</p>
              <p>• <strong className="text-foreground">Fraud</strong> — fake profiles, falsified photos, or payment manipulation</p>
              <p>• <strong className="text-foreground">Harassment or threats</strong> — abusive language, intimidation, or safety threats</p>
              <p>• <strong className="text-foreground">Off-platform payments</strong> — arranging payment outside of Helpr</p>
              <p>• <strong className="text-foreground">Identity fraud</strong> — using someone else's identity or fake ID</p>
              <p>• <strong className="text-foreground">Dispute abuse</strong> — filing false disputes to avoid paying</p>
            </>
          }
        />
        <PolicyRowItem
          icon={AlertTriangle}
          warning
          title="User Report Policy"
          body={
            <>
              <p className="mb-1">If other users report your account for misconduct:</p>
              <p>• <strong className="text-accent">2 reports:</strong> Account suspension while admins review.</p>
              <p>• <strong className="text-destructive">3rd report:</strong> Permanent ban from the platform.</p>
              <p className="italic text-ds-11 mt-1">All reports are reviewed by admins. False reports may result in action against the reporter.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Clock}
          title="Job Editing Restrictions"
          body={
            <>
              <p><strong className="text-foreground">Before Helpr selected:</strong> You can freely edit job details.</p>
              <p><strong className="text-foreground">After Helpr selected:</strong> Jobs are locked and cannot be edited. Use addon requests for adjustments, or cancel and repost.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Scale}
          title="Dispute Resolution"
          body={
            <>
              <p><strong className="text-foreground">Step 1 — Revision (72h):</strong> Request a revision first. The Helpr has 72 hours to fix it; you then have 72 hours to accept or escalate.</p>
              <p><strong className="text-foreground">Step 2 — Formal Dispute (72h):</strong> If the revision fails, file a dispute with evidence. You have a strict 72-hour window to mark resolved or escalate.</p>
              <p><strong className="text-foreground">Step 3 — Admin Review:</strong> An admin makes the final binding decision (full release, partial refund, or full refund).</p>
              <p><strong className="text-foreground">Payment hold:</strong> Funds are held securely until resolution. Ignoring a 72-hour deadline auto-releases payment to the Helpr.</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Shield}
          title="New Helpr Restrictions"
          body={
            <>
              <p><strong className="text-foreground">Job Limit:</strong> New Helprs are limited to 3 active jobs at a time until they build a track record.</p>
              <p><strong className="text-foreground">Earnings Cap:</strong> Total earnings capped at {formatDollarsWhole(NEW_HELPER_EARNINGS_CAP_DOLLARS)} until 3 verified completions with a 4+ star rating.</p>
              <p><strong className="text-foreground">Response Deadlines:</strong> Helprs must respond to job offers within 1–48 hours (set by the poster).</p>
            </>
          }
        />
        <PolicyRowItem
          icon={Shield}
          title="Safety & Verification"
          body={
            <>
              <p><strong className="text-foreground">Age Verification:</strong> All users must be 18+ to use Helpr.</p>
              <p><strong className="text-foreground">ID Verification:</strong> Helprs must upload a valid government-issued ID.</p>
              <p><strong className="text-foreground">GPS Check-in:</strong> Helprs must check in within 500ft of the job location.</p>
            </>
          }
        />
      </PolicySection>
      </div>
    </div>
  );
}
