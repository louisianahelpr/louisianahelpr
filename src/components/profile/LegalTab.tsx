import { useState, forwardRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, DollarSign, Shield, FileText, ExternalLink, Clock,
  Crown, XCircle, AlertTriangle, Ban, Scale, ChevronRight as ChevronRightIcon,
} from "lucide-react";

const LegalCard = forwardRef<HTMLDivElement, { icon: React.ReactNode; title: string; children: React.ReactNode; variant?: "warning" }>(({ icon, title, children, variant }, ref) => {
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref} className={`rounded-xl border p-4 transition-colors ${variant === "warning" ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 font-display font-semibold text-foreground text-sm">
          {icon} {title}
        </span>
        <ChevronRightIcon className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="text-sm text-muted-foreground space-y-1.5 mt-3 pt-3 border-t border-border/50">{children}</div>}
    </div>
  );
});
LegalCard.displayName = "LegalCard";

export function LegalTab({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Legal & Policies</h1>
      </div>

      {/* Quick Links */}
      <div className="flex flex-wrap gap-2">
        <Link to="/rules" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
          <FileText className="w-3.5 h-3.5" /> Full Platform Rules
          <ExternalLink className="w-3 h-3" />
        </Link>
        <Link to="/terms" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
          Terms of Service <ExternalLink className="w-3 h-3" />
        </Link>
        <Link to="/privacy" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
          Privacy Policy <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Platform Rules Section */}
      <div>
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Platform Rules</h2>
        <div className="space-y-2">
          <LegalCard icon={<FileText className="w-4 h-4 text-primary" />} title="Terms of Service">
            <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your account and all activity under it.</p>
            <p><strong className="text-foreground">Task Agreements:</strong> When you accept a task or hire a helpr, you enter a binding agreement to complete the work as described and to release payment upon satisfactory completion.</p>
            <p><strong className="text-foreground">Prohibited Conduct:</strong> You may not use Helpr for illegal activities, harassment, fraud, or any conduct that violates the rights of others.</p>
            <p><strong className="text-foreground">Account Termination:</strong> Helpr reserves the right to suspend or terminate accounts that violate these terms.</p>
          </LegalCard>
          <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="Privacy Policy">
            <p><strong className="text-foreground">Data Collection:</strong> We collect information you provide (name, email, location) and usage data to improve the platform.</p>
            <p><strong className="text-foreground">Data Usage:</strong> Your data is used to match you with tasks, process payments, and communicate important updates.</p>
            <p><strong className="text-foreground">Data Sharing:</strong> We share limited information (first name, reviews) with other users. Payment data is handled securely by Stripe. We never sell your personal information.</p>
            <p><strong className="text-foreground">Data Retention:</strong> Your data is retained while your account is active. You can request deletion by contacting support.</p>
          </LegalCard>
          <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="Community Guidelines">
            <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism.</p>
            <p><strong className="text-foreground">Honesty:</strong> Provide accurate information in your profile and job descriptions.</p>
            <p><strong className="text-foreground">Safety:</strong> Never share personal information like home addresses or financial details through messages.</p>
            <p><strong className="text-foreground">Reporting:</strong> Report any suspicious or inappropriate behavior using the report feature.</p>
          </LegalCard>
        </div>
      </div>

      {/* Payments & Fees Section */}
      <div>
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payments & Fees</h2>
        <div className="space-y-2">
          <LegalCard icon={<DollarSign className="w-4 h-4 text-primary" />} title="Payment & Refund Policy">
            <p><strong className="text-foreground">Secure Payments:</strong> Payments are charged upfront via Stripe and held by the platform. The helpr is paid only after both parties confirm the job is complete. Refunds are issued for cancelled jobs (subject to the cancellation policy).</p>
            <p><strong className="text-foreground">Auto-Release:</strong> If a job is not confirmed as complete within 72 hours after one party marks it done, payment is automatically released to the helpr.</p>
            <p><strong className="text-foreground">Revisions:</strong> Posters can request revisions within a 72-hour window before approving completion.</p>
            <p><strong className="text-foreground">Disputes:</strong> If a revision doesn't resolve the issue, file a formal dispute. See the Dispute Resolution card below for the full 3-step process.</p>
          </LegalCard>
          <LegalCard icon={<DollarSign className="w-4 h-4 text-primary" />} title="Platform Fees">
            <p><strong className="text-foreground">Poster Service Fee:</strong> 10% added at checkout on top of the job budget.</p>
            <p><strong className="text-foreground">Helpr Platform Fee:</strong> 10% deducted from the helpr's payout.</p>
            <p><strong className="text-foreground">Total Platform Take:</strong> 20% per transaction (10% from each side).</p>
            <p><strong className="text-foreground">Urgent Job Fee:</strong> $5 fee for posters who mark a job as urgent.</p>
            <p><strong className="text-foreground">Job Boost:</strong> Optional paid boost to increase visibility of your listing.</p>
            <p><strong className="text-foreground">Tipping:</strong> 100% of tips go to the helpr — no platform fee on tips.</p>
            <p><strong className="text-foreground">Sales Tax:</strong> Louisiana state and parish sales tax is collected on platform fees where applicable.</p>
          </LegalCard>
          <LegalCard icon={<DollarSign className="w-4 h-4 text-primary" />} title="Job Budget Limits">
            <p><strong className="text-foreground">Minimum:</strong> $5 per job.</p>
            <p><strong className="text-foreground">Maximum:</strong> $5,000 per job.</p>
          </LegalCard>
          <LegalCard icon={<Crown className="w-4 h-4 text-primary" />} title="Subscription Tiers">
            <p><strong className="text-foreground">Basic ⭐ ($5/mo):</strong> Standard access with basic features.</p>
            <p><strong className="text-foreground">Pro 🔥 ($10/mo):</strong> Priority job access and enhanced visibility.</p>
            <p><strong className="text-foreground">Elite 💎 ($15/mo):</strong> Top-tier access with maximum visibility and early job access.</p>
            <p><strong className="text-foreground">Annual Plans:</strong> Available at ~10x monthly rate (save ~17%).</p>
            <p><strong className="text-foreground">Billing:</strong> One-time, monthly, or annual. Stripe handles billing dates automatically.</p>
          </LegalCard>
        </div>
      </div>

      {/* Cancellations & Strikes Section */}
      <div>
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cancellations & Strikes</h2>
        <div className="space-y-2">
          <LegalCard icon={<XCircle className="w-4 h-4 text-destructive" />} title="Cancellation Policy" variant="warning">
            <p><strong className="text-foreground">Free Cancellation:</strong> Cancel 24+ hours before the job at no charge.</p>
            <p><strong className="text-foreground">Late Cancellation (&lt;24h):</strong> 25% cancellation fee applied.</p>
            <p><strong className="text-foreground">Very Late Cancellation (&lt;2h):</strong> 50% cancellation fee applied.</p>
          </LegalCard>
          <LegalCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} title="Cancellation Strikes (Posters)" variant="warning">
            <p className="mb-1">Cancelling a job <strong className="text-foreground">after a helpr has been selected</strong> triggers escalating penalties:</p>
            <p>• <strong className="text-accent">1st cancellation:</strong> Written warning (Strike 1/2)</p>
            <p>• <strong className="text-accent">2nd cancellation:</strong> Final warning (Strike 2/2)</p>
            <p>• <strong className="text-destructive">3rd cancellation:</strong> Permanent account ban</p>
            <p className="italic text-xs mt-1">Cancelling jobs with no helpr assigned does not count toward strikes.</p>
          </LegalCard>
          <LegalCard icon={<Ban className="w-4 h-4 text-destructive" />} title="Job Denial Strikes (Helprs)" variant="warning">
            <p className="mb-1">Declining a job <strong className="text-foreground">after being selected</strong> triggers escalating penalties:</p>
            <p>• <strong className="text-accent">1st decline:</strong> Written warning (Strike 1/2)</p>
            <p>• <strong className="text-accent">2nd decline:</strong> Final warning (Strike 2/2)</p>
            <p>• <strong className="text-destructive">3rd decline:</strong> Permanent account ban</p>
            <p className="italic text-xs mt-1">Withdrawing your application before being selected does not count.</p>
          </LegalCard>
        </div>
      </div>

      {/* Safety & Enforcement Section */}
      <div>
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Safety & Enforcement</h2>
        <div className="space-y-2">
          <LegalCard icon={<Ban className="w-4 h-4 text-destructive" />} title="No-Show Policy" variant="warning">
            <p>If a helpr accepts a job and fails to show up without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong> immediately. No warnings, no exceptions. The poster receives a full refund.</p>
          </LegalCard>
          <LegalCard icon={<Shield className="w-4 h-4 text-destructive" />} title="Immediate Ban Offenses" variant="warning">
            <p className="mb-1">These skip all warnings and result in an immediate permanent ban:</p>
            <p>• <strong className="text-foreground">No-show</strong> — accepting a job and not showing up</p>
            <p>• <strong className="text-foreground">Fraud</strong> — fake profiles, falsified photos, or payment manipulation</p>
            <p>• <strong className="text-foreground">Harassment or threats</strong> — abusive language, intimidation, or safety threats</p>
            <p>• <strong className="text-foreground">Off-platform payments</strong> — arranging payment outside of Helpr</p>
            <p>• <strong className="text-foreground">Identity fraud</strong> — using someone else's identity or fake ID</p>
            <p>• <strong className="text-foreground">Dispute abuse</strong> — filing false disputes to avoid paying</p>
          </LegalCard>
          <LegalCard icon={<AlertTriangle className="w-4 h-4 text-accent" />} title="Repeat Offender Policy">
            <p><strong className="text-foreground">1st violation:</strong> Written warning via email and in-app notification.</p>
            <p><strong className="text-foreground">2nd violation:</strong> 7-day account suspension.</p>
            <p><strong className="text-foreground">3rd violation:</strong> Permanent ban from the platform.</p>
            <p className="italic text-xs mt-1">Severe violations (no-shows, fraud, harassment) skip this ladder and result in an immediate permanent ban.</p>
          </LegalCard>
          <LegalCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} title="User Report Policy" variant="warning">
            <p className="mb-1">If other users report your account for misconduct:</p>
            <p>• <strong className="text-accent">2 reports:</strong> Account suspension while admins review.</p>
            <p>• <strong className="text-destructive">3rd report:</strong> Permanent ban from the platform.</p>
            <p className="italic text-xs mt-1">All reports are reviewed by admins. False reports may result in action against the reporter.</p>
          </LegalCard>
        </div>
      </div>

      {/* Job Rules Section */}
      <div>
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Job Rules</h2>
        <div className="space-y-2">
          <LegalCard icon={<Clock className="w-4 h-4 text-primary" />} title="Job Editing Restrictions">
            <p><strong className="text-foreground">Before helpr selected:</strong> You can freely edit job details.</p>
            <p><strong className="text-foreground">After helpr selected:</strong> Jobs are locked and cannot be edited. Use addon requests for adjustments, or cancel and repost.</p>
          </LegalCard>
          <LegalCard icon={<Scale className="w-4 h-4 text-primary" />} title="Dispute Resolution">
            <p><strong className="text-foreground">Step 1 — Revision (72h):</strong> Request a revision first. The helpr has 72 hours to fix it; you then have 72 hours to accept or escalate.</p>
            <p><strong className="text-foreground">Step 2 — Formal Dispute (72h):</strong> If the revision fails, file a dispute with evidence. You have a strict 72-hour window to mark resolved or escalate.</p>
            <p><strong className="text-foreground">Step 3 — Admin Review:</strong> An admin makes the final binding decision (full release, partial refund, or full refund).</p>
            <p><strong className="text-foreground">Escrow Hold:</strong> Funds are held securely until resolution. Ignoring a 72-hour deadline auto-releases payment to the helpr.</p>
          </LegalCard>
          <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="New Helper Restrictions">
            <p><strong className="text-foreground">Job Limit:</strong> New helprs are limited to 3 active jobs at a time until they build a track record.</p>
            <p><strong className="text-foreground">Earnings Cap:</strong> Total earnings capped at $100 until 3 verified completions with a 4+ star rating.</p>
            <p><strong className="text-foreground">Response Deadlines:</strong> Helprs must respond to job offers within 1–48 hours (set by the poster).</p>
          </LegalCard>
          <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="Safety & Verification">
            <p><strong className="text-foreground">Age Verification:</strong> All users must be 18+ to use Helpr.</p>
            <p><strong className="text-foreground">ID Verification:</strong> Helprs must upload a valid government-issued ID.</p>
            <p><strong className="text-foreground">GPS Check-in:</strong> Helprs must check in within 500ft of the job location.</p>
          </LegalCard>
        </div>
      </div>
    </div>
  );
}
