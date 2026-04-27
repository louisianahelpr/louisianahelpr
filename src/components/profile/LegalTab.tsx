import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, DollarSign, Shield, FileText, ExternalLink, Clock,
  Crown, XCircle, AlertTriangle, Ban, Scale, ChevronDown, ChevronRight,
  Building2, Wallet, HeartPulse, Siren,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ---------- Policy detail rows ----------

type PolicyRow = {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
  warning?: boolean;
};

const RowItem = ({ icon: Icon, title, body, warning }: PolicyRow) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={`group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors btn-press ${
          warning
            ? "hover:bg-destructive/10"
            : "hover:bg-primary/5"
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span
            className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
              warning ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            }`}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
          </span>
          <span className="text-sm font-semibold text-foreground truncate">{title}</span>
        </span>
        <ChevronRight
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
        <div className="px-3 pt-2 pb-3 text-sm text-muted-foreground space-y-1.5 border-l-2 border-border/40 ml-5 my-1">
          {body}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// ---------- Group section ----------

const Section = ({
  icon: Icon,
  title,
  subtitle,
  warning,
  defaultOpen = true,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  warning?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={`rounded-2xl border squircle overflow-hidden transition-colors ${
          warning
            ? "border-destructive/20 bg-destructive/5"
            : "border-border bg-card"
        }`}
      >
        <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left btn-press">
          <span className="flex items-center gap-3 min-w-0">
            <span
              className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
                warning ? "bg-destructive/15 text-destructive" : "bg-primary/12 text-primary"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={2.25} />
            </span>
            <span className="min-w-0">
              <p className="text-sm font-display font-bold text-foreground leading-tight">{title}</p>
              <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className="px-2 pb-2 pt-1 space-y-0.5 border-t border-border/50">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

// ---------- Page ----------

export function LegalTab({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Legal & Policies</h1>
      </div>

      {/* Sticky Quick Access chip bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-1 bg-background/80 backdrop-blur-md">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Link
            to="/rules"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full squircle bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors btn-press"
          >
            <FileText className="w-3.5 h-3.5" /> Full Platform Rules
            <ExternalLink className="w-3 h-3" />
          </Link>
          <Link
            to="/terms"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full squircle bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors btn-press"
          >
            Terms of Service <ExternalLink className="w-3 h-3" />
          </Link>
          <Link
            to="/privacy"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full squircle bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors btn-press"
          >
            Privacy Policy <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* 1. Foundation */}
      <Section
        icon={Building2}
        title="Foundation"
        subtitle="Terms, privacy, and community basics"
      >
        <RowItem
          icon={FileText}
          title="Terms of Service"
          body={
            <>
              <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your account and all activity under it.</p>
              <p><strong className="text-foreground">Task Agreements:</strong> When you accept a task or hire a helpr, you enter a binding agreement to complete the work as described and to release payment upon satisfactory completion.</p>
              <p><strong className="text-foreground">Prohibited Conduct:</strong> You may not use Helpr for illegal activities, harassment, fraud, or any conduct that violates the rights of others.</p>
              <p><strong className="text-foreground">Account Termination:</strong> Helpr reserves the right to suspend or terminate accounts that violate these terms.</p>
            </>
          }
        />
        <RowItem
          icon={Shield}
          title="Privacy Policy"
          body={
            <>
              <p><strong className="text-foreground">Data Collection:</strong> We collect information you provide (name, email, location) and usage data to improve the platform.</p>
              <p><strong className="text-foreground">Data Usage:</strong> Your data is used to match you with tasks, process payments, and communicate important updates.</p>
              <p><strong className="text-foreground">Data Sharing:</strong> We share limited information (first name, reviews) with other users. Payment data is handled securely by Stripe. We never sell your personal information.</p>
              <p><strong className="text-foreground">Data Retention:</strong> Your data is retained while your account is active. You can request deletion by contacting support.</p>
            </>
          }
        />
        <RowItem
          icon={Shield}
          title="Community Guidelines"
          body={
            <>
              <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism.</p>
              <p><strong className="text-foreground">Honesty:</strong> Provide accurate information in your profile and job descriptions.</p>
              <p><strong className="text-foreground">Safety:</strong> Never share personal information like home addresses or financial details through messages.</p>
              <p><strong className="text-foreground">Reporting:</strong> Report any suspicious or inappropriate behavior using the report feature.</p>
            </>
          }
        />
      </Section>

      {/* 2. Financials */}
      <Section
        icon={Wallet}
        title="Financials"
        subtitle="Payments, fees, budgets, and subscriptions"
      >
        <RowItem
          icon={DollarSign}
          title="Payment & Refund Policy"
          body={
            <>
              <p><strong className="text-foreground">Secure Payments:</strong> Payments are charged upfront via Stripe and held by the platform. The helpr is paid only after both parties confirm the job is complete. Refunds are issued for cancelled jobs (subject to the cancellation policy).</p>
              <p><strong className="text-foreground">Auto-Release:</strong> If a job is not confirmed as complete within 72 hours after one party marks it done, payment is automatically released to the helpr.</p>
              <p><strong className="text-foreground">Revisions:</strong> Posters can request revisions within a 72-hour window before approving completion.</p>
              <p><strong className="text-foreground">Disputes:</strong> If a revision doesn't resolve the issue, file a formal dispute. See Dispute Resolution for the full 3-step process.</p>
            </>
          }
        />
        <RowItem
          icon={DollarSign}
          title="Platform Fees"
          body={
            <>
              <p><strong className="text-foreground">Poster Service Fee:</strong> 10% added at checkout on top of the job budget.</p>
              <p><strong className="text-foreground">Helpr Platform Fee:</strong> 10% deducted from the helpr's payout.</p>
              <p><strong className="text-foreground">Total Platform Take:</strong> 20% per transaction (10% from each side).</p>
              <p><strong className="text-foreground">Urgent Job Fee:</strong> $5 fee for posters who mark a job as urgent.</p>
              <p><strong className="text-foreground">Job Boost:</strong> Optional paid boost to increase visibility of your listing.</p>
              <p><strong className="text-foreground">Tipping:</strong> 100% of tips go to the helpr — no platform fee on tips.</p>
              <p><strong className="text-foreground">Sales Tax:</strong> Louisiana state and parish sales tax is collected on platform fees where applicable.</p>
            </>
          }
        />
        <RowItem
          icon={DollarSign}
          title="Job Budget Limits"
          body={
            <>
              <p><strong className="text-foreground">Minimum:</strong> $5 per job.</p>
              <p><strong className="text-foreground">Maximum:</strong> $5,000 per job.</p>
            </>
          }
        />
        <RowItem
          icon={Crown}
          title="Subscription Tiers"
          body={
            <>
              <p><strong className="text-foreground">Basic ⭐ ($5/mo):</strong> Standard access with basic features.</p>
              <p><strong className="text-foreground">Pro 🔥 ($10/mo):</strong> Priority job access and enhanced visibility.</p>
              <p><strong className="text-foreground">Elite 💎 ($15/mo):</strong> Top-tier access with maximum visibility and early job access.</p>
              <p><strong className="text-foreground">Annual Plans:</strong> Available at ~10x monthly rate (save ~17%).</p>
              <p><strong className="text-foreground">Billing:</strong> One-time, monthly, or annual. Stripe handles billing dates automatically.</p>
            </>
          }
        />
      </Section>

      {/* 3. Account Health (warning tint) */}
      <Section
        icon={HeartPulse}
        title="Account Health"
        subtitle="Cancellations, strikes, and no-shows"
        warning
      >
        <RowItem
          icon={XCircle}
          warning
          title="Cancellation Policy"
          body={
            <>
              <p><strong className="text-foreground">Free Cancellation:</strong> Cancel 24+ hours before the job at no charge.</p>
              <p><strong className="text-foreground">Late Cancellation (&lt;24h):</strong> 25% cancellation fee applied.</p>
              <p><strong className="text-foreground">Very Late Cancellation (&lt;2h):</strong> 50% cancellation fee applied.</p>
            </>
          }
        />
        <RowItem
          icon={AlertTriangle}
          warning
          title="Cancellation Strikes (Posters)"
          body={
            <>
              <p className="mb-1">Cancelling a job <strong className="text-foreground">after a helpr has been selected</strong> triggers escalating penalties:</p>
              <p>• <strong className="text-accent">1st cancellation:</strong> Written warning (Strike 1/2)</p>
              <p>• <strong className="text-accent">2nd cancellation:</strong> Final warning (Strike 2/2)</p>
              <p>• <strong className="text-destructive">3rd cancellation:</strong> Permanent account ban</p>
              <p className="italic text-xs mt-1">Cancelling jobs with no helpr assigned does not count toward strikes.</p>
            </>
          }
        />
        <RowItem
          icon={Ban}
          warning
          title="Job Denial Strikes (Helprs)"
          body={
            <>
              <p className="mb-1">Declining a job <strong className="text-foreground">after being selected</strong> triggers escalating penalties:</p>
              <p>• <strong className="text-accent">1st decline:</strong> Written warning (Strike 1/2)</p>
              <p>• <strong className="text-accent">2nd decline:</strong> Final warning (Strike 2/2)</p>
              <p>• <strong className="text-destructive">3rd decline:</strong> Permanent account ban</p>
              <p className="italic text-xs mt-1">Withdrawing your application before being selected does not count.</p>
            </>
          }
        />
        <RowItem
          icon={Ban}
          warning
          title="No-Show Policy"
          body={
            <p>If a helpr accepts a job and fails to show up without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong> immediately. No warnings, no exceptions. The poster receives a full refund.</p>
          }
        />
        <RowItem
          icon={AlertTriangle}
          title="Repeat Offender Policy"
          body={
            <>
              <p><strong className="text-foreground">1st violation:</strong> Written warning via email and in-app notification.</p>
              <p><strong className="text-foreground">2nd violation:</strong> 7-day account suspension.</p>
              <p><strong className="text-foreground">3rd violation:</strong> Permanent ban from the platform.</p>
              <p className="italic text-xs mt-1">Severe violations (no-shows, fraud, harassment) skip this ladder and result in an immediate permanent ban.</p>
            </>
          }
        />
      </Section>

      {/* 4. Operations & Safety (warning tint) */}
      <Section
        icon={Siren}
        title="Operations & Safety"
        subtitle="Bans, reports, disputes, and verification"
        warning
      >
        <RowItem
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
        <RowItem
          icon={AlertTriangle}
          warning
          title="User Report Policy"
          body={
            <>
              <p className="mb-1">If other users report your account for misconduct:</p>
              <p>• <strong className="text-accent">2 reports:</strong> Account suspension while admins review.</p>
              <p>• <strong className="text-destructive">3rd report:</strong> Permanent ban from the platform.</p>
              <p className="italic text-xs mt-1">All reports are reviewed by admins. False reports may result in action against the reporter.</p>
            </>
          }
        />
        <RowItem
          icon={Clock}
          title="Job Editing Restrictions"
          body={
            <>
              <p><strong className="text-foreground">Before helpr selected:</strong> You can freely edit job details.</p>
              <p><strong className="text-foreground">After helpr selected:</strong> Jobs are locked and cannot be edited. Use addon requests for adjustments, or cancel and repost.</p>
            </>
          }
        />
        <RowItem
          icon={Scale}
          title="Dispute Resolution"
          body={
            <>
              <p><strong className="text-foreground">Step 1 — Revision (72h):</strong> Request a revision first. The helpr has 72 hours to fix it; you then have 72 hours to accept or escalate.</p>
              <p><strong className="text-foreground">Step 2 — Formal Dispute (72h):</strong> If the revision fails, file a dispute with evidence. You have a strict 72-hour window to mark resolved or escalate.</p>
              <p><strong className="text-foreground">Step 3 — Admin Review:</strong> An admin makes the final binding decision (full release, partial refund, or full refund).</p>
              <p><strong className="text-foreground">Escrow Hold:</strong> Funds are held securely until resolution. Ignoring a 72-hour deadline auto-releases payment to the helpr.</p>
            </>
          }
        />
        <RowItem
          icon={Shield}
          title="New Helper Restrictions"
          body={
            <>
              <p><strong className="text-foreground">Job Limit:</strong> New helprs are limited to 3 active jobs at a time until they build a track record.</p>
              <p><strong className="text-foreground">Earnings Cap:</strong> Total earnings capped at $100 until 3 verified completions with a 4+ star rating.</p>
              <p><strong className="text-foreground">Response Deadlines:</strong> Helprs must respond to job offers within 1–48 hours (set by the poster).</p>
            </>
          }
        />
        <RowItem
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
      </Section>
    </div>
  );
}
