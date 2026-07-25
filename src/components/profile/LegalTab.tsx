import { Link } from "react-router-dom";
import {
  DollarSign, Shield, FileText, ExternalLink, Clock,
  Crown, XCircle, AlertTriangle, Ban, Scale,
  Building2, Wallet, HeartPulse, Siren,
} from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
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

// ---------- Page ----------

export function LegalTab({ onBack }: { onBack: () => void }) {
  return (
    // Safe-area-aware bottom padding (~6rem) so the bottom section
    // ("Operations & Safety") scrolls clear of the MobileNav dock + FAB
    // on iPhone without leaving a large empty dead-zone below it.
    <div
      className="space-y-6"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
    >
      <ProfileTabHeader
        title="Legal &amp; policies"
        onBack={onBack}
      />

      {/* Anchor docs — dedicated full-text pages */}
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
                <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>

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
              <p><strong className="text-foreground">Escrow Hold:</strong> Funds are held securely until resolution. Ignoring a 72-hour deadline auto-releases payment to the Helpr.</p>
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
