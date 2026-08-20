import {
  Briefcase, Handshake, Wallet, Scale, ShieldAlert, Receipt, DollarSign,
  CheckCircle, XCircle, AlertTriangle, Ban, Clock, FileText, Shield, Siren,
} from "lucide-react";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
import { HideOnSearch, TldrCard, PolicyFooter } from "./LegalChrome";
// Derive the escrow auto-release schedule instead of restating it in prose.
// These are the platform's binding promises about when money moves, so they
// must follow the config the cron enforces (guarded by escrowTiming.parity.test).
// NOTE: the 72h figures in the DISPUTE steps below are a DIFFERENT deadline
// (dispute_deadline / revision_acceptance_deadline) and are deliberately NOT
// interpolated from TOTAL_TO_PAYOUT_HOURS — they only coincide numerically.
import {
  COPY_AUTO_RELEASE_HOURS,
  TOTAL_TO_PAYOUT_HOURS,
} from "../../../supabase/functions/_shared/escrowTiming";
// Budget limits, cancellation percentages and the new-helper earnings cap are
// binding money figures. They were restated here as literals ("$10", "25%",
// "$100") while the app enforced `moneyLimits.ts` — exactly the drift that file
// exists to prevent — so this page now derives every one of them.
import {
  MIN_JOB_BUDGET_DOLLARS,
  MAX_JOB_BUDGET_DOLLARS,
  LATE_CANCEL_PERCENT,
  VERY_LATE_CANCEL_PERCENT,
  NEW_HELPER_EARNINGS_CAP_DOLLARS,
  formatDollarsWhole,
} from "@/lib/moneyLimits";

/* ─────────────────────  COMMUNITY RULES  ───────────────────── */
export const CommunityContent = () => (
  <div className="space-y-3">
    <TldrCard
      items={[
        `Cancel free 24+ hours ahead. Inside 24h, fees apply (${LATE_CANCEL_PERCENT}% / ${VERY_LATE_CANCEL_PERCENT}%). No-show = permanent ban.`,
        `Payment auto-releases ${COPY_AUTO_RELEASE_HOURS} hours after completion if either side doesn't act.`,
        "If something's wrong, request a revision first → file a dispute → admin decides. Each step has a 72-hour window.",
        "Three strikes = ban. Fraud, harassment, off-platform payments, and identity fraud skip the strikes.",
        "Helprs are independent contractors — taxes are your responsibility. We send 1099s when thresholds are met.",
      ]}
    />

    {/* ── 1. Posting & accepting jobs ── */}
    <PolicySection
      icon={Briefcase}
      title="Posting & accepting jobs"
      subtitle="Setting up the work — limits, edits, and what's locked"
      anchorId="posting-accepting"
    >
      <PolicyRowItem
        icon={DollarSign}
        title={`Job budget limits — ${formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)} minimum, ${formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)} maximum`}
        body={
          <>
            <p><strong className="text-foreground">Minimum: {formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)}.</strong> Jobs below {formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)} cannot be posted.</p>
            <p><strong className="text-foreground">Maximum: {formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}.</strong> For projects exceeding {formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}, split into multiple jobs or contact support.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={CheckCircle}
        title="Editing — before a Helpr is selected"
        body={<p>Freely edit title, description, budget, date, and other details.</p>}
      />
      <PolicyRowItem
        icon={XCircle}
        title="Editing — after a Helpr is selected"
        body={<p>Jobs cannot be edited once a Helpr accepts. This protects Helprs from unexpected scope or budget changes. If adjustments are needed, cancel and repost.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="New Helpr account limits"
        body={
          <>
            <p>New Helpr accounts are limited to:</p>
            <p>• Max <strong className="text-foreground">3 active jobs</strong> at a time</p>
            <p>• Max <strong className="text-foreground">{formatDollarsWhole(NEW_HELPER_EARNINGS_CAP_DOLLARS)} in total earnings</strong></p>
            <p>Lifted after <strong className="text-foreground">3 verified completions with a 4+ star rating</strong>.</p>
          </>
        }
      />
    </PolicySection>

    {/* ── 2. What you owe each other ── */}
    <PolicySection
      icon={Handshake}
      title="What you owe each other"
      subtitle="Cancel windows, response times, and showing up"
      anchorId="cancellations"
    >
      <PolicyRowItem
        icon={CheckCircle}
        title="24+ hours before job — free cancellation"
        body={<p>No fee charged. The Helpr can fill the slot.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title={`Less than 24 hours before — ${LATE_CANCEL_PERCENT}% fee`}
        body={<p><strong className="text-foreground">{LATE_CANCEL_PERCENT}% cancellation fee</strong> applied. The Helpr has already committed their time.</p>}
      />
      <PolicyRowItem
        icon={XCircle}
        title={`Less than 2 hours before — ${VERY_LATE_CANCEL_PERCENT}% fee`}
        body={<p><strong className="text-foreground">{VERY_LATE_CANCEL_PERCENT}% cancellation fee</strong> applied. This is considered a very late cancellation.</p>}
        warning
      />
      <PolicyRowItem
        icon={Ban}
        title="No-show — instant permanent ban"
        body={
          <p>If a Helpr accepts a job and fails to show without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong>. The poster receives a full refund. <strong className="text-foreground">Even a late cancellation is better than a no-show.</strong></p>
        }
        warning
      />
      <PolicyRowItem
        icon={Clock}
        title="Helpr response deadlines"
        body={
          <p>Job offers include a <strong className="text-foreground">1–48 hour response deadline</strong>. Failing to respond or declining multiple offers triggers escalating penalties (see "When trust breaks").</p>
        }
      />
    </PolicySection>

    {/* ── 3. Getting paid ── */}
    <PolicySection
      icon={Wallet}
      title="Getting paid — how your payout works"
      subtitle="How completion turns into a payout"
      anchorId="escrow-release"
    >
      <PolicyRowItem
        icon={CheckCircle}
        title="Mutual confirmation = instant release"
        body={<p>When both poster and Helpr confirm completion, payment releases immediately.</p>}
      />
      <PolicyRowItem
        icon={Clock}
        title={`One-sided confirmation = ${COPY_AUTO_RELEASE_HOURS}-hour window`}
        body={<p>If only one party confirms, the other has {COPY_AUTO_RELEASE_HOURS} hours to confirm or request a revision. Both parties are notified every 12 hours.</p>}
      />
      <PolicyRowItem
        icon={CheckCircle}
        title={`Auto-release after ${COPY_AUTO_RELEASE_HOURS} hours`}
        body={<p>If neither confirmation nor revision is received within {COPY_AUTO_RELEASE_HOURS} hours, the job auto-completes and payment is released to the Helpr (funds reach them about {TOTAL_TO_PAYOUT_HOURS} hours after completion).</p>}
      />
      <PolicyRowItem
        icon={FileText}
        title="Completion requirements"
        body={
          <p>Helprs must upload before/after photos. A minimum <strong className="text-foreground">30-minute job duration</strong> is required before marking complete.</p>
        }
      />
    </PolicySection>

    {/* ── 4. When something goes wrong ── */}
    <PolicySection
      icon={Scale}
      title="When something goes wrong"
      subtitle="Revisions → disputes → admin (must follow in order)"
      warning
      anchorId="disputes"
    >
      <PolicyRowItem
        icon={Clock}
        title="Step 1 — Request a revision (72h)"
        body={
          <>
            <p>If unsatisfied, request a revision first. Include a clear note about what needs to change.</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Helpr has <strong className="text-foreground">72h</strong> to address and mark fixed</li>
              <li>You then have <strong className="text-foreground">72h</strong> to accept or dispute</li>
              <li>No response in 72h → job auto-completes, payment releases</li>
              <li>Helpr doesn't fix in 72h → mark complete or file dispute</li>
            </ul>
          </>
        }
      />
      <PolicyRowItem
        icon={Scale}
        title="Step 2 — File a dispute"
        body={
          <>
            <p>If revision fails, file a formal dispute. Payment is held; <strong className="text-foreground">strict 72h window</strong> begins. Provide:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Specific reason for the dispute</li>
              <li>Photo evidence or documentation</li>
              <li>Description of what went wrong</li>
            </ul>
            <p className="pt-1">Then you have 72h to either Mark Resolved, Escalate to Admin, or do nothing (auto-releases to Helpr).</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Shield}
        title="Step 3 — Admin resolution (final)"
        body={<p>An admin reviews evidence from both parties and makes a final, binding decision: full release, partial refund, or full refund.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Dispute abuse policy"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li>False or frivolous disputes = immediate ban</li>
            <li>3+ disputes in 30 days flags your account</li>
            <li>Ignore the 72h deadline → payment releases, no exceptions</li>
          </ul>
        }
        warning
      />
    </PolicySection>

    {/* ── 5. When trust breaks ── */}
    <PolicySection
      icon={ShieldAlert}
      title="When trust breaks — strikes & bans"
      subtitle="Escalating consequences for bad behavior"
      warning
      anchorId="strikes-bans"
    >
      <PolicyRowItem
        icon={AlertTriangle}
        title="Cancellation strikes (posters)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st strike:</strong> Written warning recorded; admins notified.</li>
            <li><strong className="text-foreground">2nd strike:</strong> Final warning. One more = permanent ban.</li>
            <li><strong className="text-foreground">3rd strike:</strong> Permanent ban. Final, no appeal.</li>
            <li>Cancelling a job <em>before</em> a Helpr is assigned does <strong>not</strong> count toward strikes (timing-based fees still apply).</li>
          </ul>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Job-denial strikes (Helprs)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st strike:</strong> Written warning. Only apply to jobs you can commit to.</li>
            <li><strong className="text-foreground">2nd strike:</strong> Final warning.</li>
            <li><strong className="text-foreground">3rd strike:</strong> Permanent ban.</li>
            <li>Withdrawing your application <em>before</em> being selected does not count.</li>
          </ul>
        }
      />
      <PolicyRowItem
        icon={Ban}
        title="Immediate ban offenses (skip the ladder)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">No-show.</strong> Accepting a job and not showing up.</li>
            <li><strong className="text-foreground">Fraud.</strong> Fake profiles, falsified completion photos, payment manipulation.</li>
            <li><strong className="text-foreground">Harassment or threats.</strong> Abusive language or intimidation.</li>
            <li><strong className="text-foreground">Off-platform payments.</strong> Arranging payment outside Helpr.</li>
            <li><strong className="text-foreground">Identity fraud.</strong> Using someone else's identity or fake ID.</li>
            <li><strong className="text-foreground">Dispute abuse.</strong> Filing false disputes to avoid paying.</li>
          </ul>
        }
        warning
      />
      <PolicyRowItem
        icon={Clock}
        title="Repeat offender ladder (other violations)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st report:</strong> Written warning via email + in-app.</li>
            <li><strong className="text-foreground">2nd report:</strong> 7-day suspension.</li>
            <li><strong className="text-foreground">3rd report:</strong> Permanent ban. Final.</li>
          </ul>
        }
      />
      <PolicyRowItem
        icon={Siren}
        title="How we detect violations"
        body={
          <>
            <p><strong className="text-foreground">GPS proximity check-in:</strong> Within 500 ft of the job location.</p>
            <p><strong className="text-foreground">In-app chat scanning:</strong> Real-time detection of off-platform payment attempts (Venmo, CashApp, phone numbers, etc.).</p>
            <p><strong className="text-foreground">Automated flags:</strong> Jobs completed under 15 min, missing GPS check-ins, repeated disputes on a single account.</p>
          </>
        }
      />
    </PolicySection>

    {/* ── 6. Money & taxes ── */}
    <PolicySection
      icon={Receipt}
      title="Money & taxes"
      subtitle="Federal & Louisiana state obligations"
      anchorId="money-taxes"
    >
      <PolicyRowItem
        icon={Receipt}
        title="Helpr (the platform)"
        body={
          <>
            <p><strong className="text-foreground">1099-K (2026):</strong> Federal threshold reverted to $20,000 AND 200+ transactions. Louisiana follows federal.</p>
            <p><strong className="text-foreground">1099-NEC (2026):</strong> Threshold raised from $600 to $2,000.</p>
            <p><strong className="text-foreground">Marketplace facilitator:</strong> Above $100,000 LA gross revenue, Helpr collects/remits sales tax on the entire transaction.</p>
            <p><strong className="text-foreground">LDR e-filing mandate:</strong> All LA withholding and sales tax returns filed electronically as of Jan 1, 2026.</p>
            <p><strong className="text-foreground">Worker classification:</strong> Helprs qualify as independent contractors under the Economic Reality Test.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={CheckCircle}
        title="Job posters"
        body={
          <>
            <p><strong className="text-foreground">Sales tax:</strong> Helpr collects on your behalf and remits to the state.</p>
            <p><strong className="text-foreground">No payroll obligations:</strong> Workers are independent contractors — no withholding required.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Helprs (workers)"
        body={
          <>
            <p><strong className="text-foreground">Self-employment tax:</strong> Full 15.3% (Social Security + Medicare) on Helpr earnings.</p>
            <p><strong className="text-foreground">Income tax:</strong> Report all Helpr income on state and federal returns.</p>
            <p><strong className="text-foreground">Quarterly estimates:</strong> Significant earnings may require quarterly estimated payments to IRS and LDR.</p>
          </>
        }
        warning
      />
      <PolicyRowItem
        icon={Receipt}
        title="Louisiana parish rates"
        body={<p>LA parishes collect their own sales taxes. Helpr applies the correct rate based on job location.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="General guidance only"
        body={<p>Tax laws change frequently. Consult a CPA for advice specific to your situation.</p>}
      />
    </PolicySection>

    <HideOnSearch>
      <PolicyFooter />
    </HideOnSearch>
  </div>
);
