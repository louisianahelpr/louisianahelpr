import {
  Briefcase, Handshake, Wallet, Scale, ShieldAlert, Receipt, DollarSign,
  CheckCircle, XCircle, AlertTriangle, Ban, Clock, FileText, Shield, Siren,
} from "lucide-react";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
import { HideOnSearch, TldrCard, PolicyFooter } from "./LegalChrome";
import { LAST_UPDATED } from "./legalSections";
// The reliability ladder is stated ONCE, in reliabilityLadder.ts, which
// reliabilityLadder.parity.test.ts pins to the SQL that enforces it. This page
// used to restate it as its own three-bullet list ending in an automatic
// permanent ban at the 3rd strike — the SQL has four rungs and, since
// 20260829010000, never bans automatically at all. Binding copy in a legal
// document is the LAST place a restated consequence should live.
// Same rule for the no-show ladder, which this page stated as "instant
// permanent ban" — never true (the first report has always been a warning) and
// doubly false since 20260831183302 moved the second report onto the shared
// reviewable rung. Binding copy in a legal document is the LAST place a
// restated consequence should live.
import { RELIABILITY_LADDER_RUNGS, NO_SHOW_LADDER_SENTENCE, CANCELLATION_LADDER_RUNGS } from "@/lib/reliabilityLadder";
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
// Budget limits and cancellation percentages are binding money figures. They
// were restated here as literals ("$10", "25%") while the app enforced
// `moneyLimits.ts` — exactly the drift that file exists to prevent — so this
// page now derives every one of them.
import {
  MIN_JOB_BUDGET_DOLLARS,
  MAX_JOB_BUDGET_DOLLARS,
  LATE_CANCEL_PERCENT,
  VERY_LATE_CANCEL_PERCENT,
  FORM_1099K_TRANSACTION_THRESHOLD,
  form1099kGrossLabel,
  formatDollarsWhole,
} from "@/lib/moneyLimits";

/* ─────────────────────  COMMUNITY RULES  ───────────────────── */
export const CommunityContent = () => (
  <div className="space-y-3">
    <TldrCard
      items={[
        `Cancel free 24+ hours ahead. Inside 24h, fees apply (${LATE_CANCEL_PERCENT}% / ${VERY_LATE_CANCEL_PERCENT}%). A no-show is a final warning, then a 7-day restriction an admin reviews.`,
        `Payment auto-releases ${COPY_AUTO_RELEASE_HOURS} hours after completion if either side doesn't act.`,
        "If something's wrong, request a revision first → file a dispute → admin decides. Each step has a 72-hour window.",
        // WAS "Three strikes = ban." — false, and the single most consequential
        // sentence on the page, sitting in the TL;DR a restricted user reads
        // first. No ladder in the app bans anyone: all four call
        // `apply_consequence_ladder` with `p_permanent_requires_review => true`
        // (20260829030000:298,373,466 and 20260831183302), which converts the
        // 'permanent' effect into a 7-day restriction plus a
        // `pending_ban_review` violation an admin resolves in
        // /admin?view=banreview. The rung lists three screens down
        // (CANCELLATION_LADDER_RUNGS / RELIABILITY_LADDER_RUNGS) already said
        // so; the TL;DR contradicted them. It survived the ladder guard because
        // that guard matches "Nth strike" + a consequence on one line, and this
        // sentence says neither.
        "Strikes ladder up to a 7-day restriction while an admin reviews — a permanent ban is never automatic. Fraud, harassment, off-platform payments, and identity fraud skip the ladder and go straight to an admin.",
        "Helprs are independent contractors — taxes are your responsibility. We send 1099s when thresholds are met.",
      ]}
    />

    {/* ── 0. The basics ──
        MOVED HERE from the Profile → Legal tab, which used to carry its own
        paraphrased copy of the platform's conduct rules. These four lines were
        the one part of that tab stated nowhere else, so they were promoted into
        the canonical Community Rules rather than deleted alongside the
        duplicates. Verbatim — no wording changed in the move. */}
    <PolicySection
      icon={Shield}
      title="The basics"
      subtitle="Respect, honesty, safety, and reporting"
      anchorId="basics"
    >
      <PolicyRowItem
        icon={Shield}
        title="What every user owes the platform"
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
        title="No-show — final warning, then admin review"
        body={
          <p>If a Helpr accepts a job and fails to show without prior cancellation, {NO_SHOW_LADDER_SENTENCE}. The poster receives a full refund. <strong className="text-foreground">Even a late cancellation is better than a no-show.</strong></p>
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
        // WAS "Both parties are notified every 12 hours." — false twice over,
        // in a binding document. `payment-confirm-reminder` inserts ONE
        // notification, to `job.customer_id` only (index.ts:222-243) — the
        // Helpr is never notified at all — and it is idempotent by design: the
        // row is stamped `payment_confirm_notif_sent` immediately after
        // (index.ts:257-260) and the next tick's query filters that flag out,
        // so there is no recurring 12-hour cadence to be on. 12 is the DELAY
        // (`REMIND_AFTER_HOURS`, index.ts:73), not a period. Corrected to the
        // one nudge that actually exists.
        //
        // SEPARATE, UNFIXED, REPORTED: the cron runs once daily (`15 15 * * *`,
        // 20260829010000) against an eligibility window only 12 hours wide, so
        // roughly half of submissions age out of it and are never reminded at
        // all. The function computes this itself (`SCHEDULE_LEAVES_A_HOLE`,
        // index.ts:82) and prescribes a six-hourly schedule. Copy cannot fix a
        // schedule — owner's call.
        //
        // LINE COMMENTS ON PURPOSE. This block was a /* … */ comment, and the
        // six-hourly cron expression it quoted contains a `*` followed by a
        // slash — which CLOSED the comment early and turned the rest of the
        // element into unparseable JSX. The file failed `parsecheck --all`
        // while it sat in the tree. Never quote a cron step value inside a
        // block comment.
        body={<p>If only one party confirms, the other has {COPY_AUTO_RELEASE_HOURS} hours to confirm or request a revision. We send the poster a reminder about 12 hours in.</p>}
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
          /* Transcribed from what apply_cancellation_violation_consequence
             ACTUALLY does (20260829010000). This list used to promise an
             automatic, unappealable ban on the 3rd strike; the ladder has
             never done that — it applies a REVERSIBLE 7-day restriction
             and notifies admins to decide. The in-app CancellationDialog
             already said so, so the legal page was the odd one out. */
          <ul className="list-disc pl-4 space-y-0.5">
            {CANCELLATION_LADDER_RUNGS.map((rung) => (
              <li key={rung}>{rung}</li>
            ))}
            <li>Cancelling a job <em>before</em> a Helpr is assigned does <strong>not</strong> count toward strikes (timing-based fees still apply).</li>
          </ul>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Job-denial strikes (Helprs)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            {RELIABILITY_LADDER_RUNGS.map((rung) => (
              <li key={rung}>{rung}</li>
            ))}
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
          /* Transcribed from what `auto_restrict_repeat_violators` ACTUALLY does
             on the live database, read 2026-08-21 — not from memory. The old
             version said "report" where the trigger counts confirmed
             VIOLATIONS, and promised a permanent ban at the 3rd, which the
             trigger never does automatically: it suspends 30 days and notifies
             admins to decide. Stating an automatic permanent ban that no code
             performs is the kind of promise a suspended user quotes back. */
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st violation:</strong> Final warning — email + in-app, telling you the next one is a 7-day suspension.</li>
            <li><strong className="text-foreground">2nd violation:</strong> 7-day suspension.</li>
            <li><strong className="text-foreground">3rd violation:</strong> 30-day suspension.</li>
            <li><strong className="text-foreground">4th and beyond:</strong> Reviewed by a human for a permanent ban — it is never automatic.</li>
            <li className="!list-none pl-0 pt-1 text-muted-foreground">Counts <em>confirmed violations</em>, not reports made against you. Admin actions, cancellations with a helper assigned, off-platform flags, job denials and no-shows are handled separately and do not feed this ladder.</li>
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
            <p><strong className="text-foreground">1099-K (2025 and later):</strong> Federal threshold is {form1099kGrossLabel()} AND {FORM_1099K_TRANSACTION_THRESHOLD}+ transactions — restored by the One Big Beautiful Bill, which repealed the planned $2,500 and $600 step-downs. Louisiana follows federal.</p>
            <p><strong className="text-foreground">1099-NEC (2026):</strong> Threshold raised from $600 to $2,000.</p>
            <p><strong className="text-foreground">Marketplace facilitator:</strong> Above $100,000 LA gross revenue, Helpr collects and remits sales tax as the marketplace facilitator. Louisiana taxes only the services it enumerates in LA R.S. 47:301(14), so tax applies to the job's labor line in taxable categories only — never to Helpr's fees, and not to most categories (cleaning, yard work, moving, errands, pet care, delivery are not enumerated taxable services).</p>
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
      <PolicyFooter updated={LAST_UPDATED.community} />
    </HideOnSearch>
  </div>
);
