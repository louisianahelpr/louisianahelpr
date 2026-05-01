import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  Shield, DollarSign, Clock, AlertTriangle, Ban,
  Scale, CheckCircle, XCircle, Receipt
} from "lucide-react";
import Navbar from "@/components/Navbar";
import BackButton from "@/components/BackButton";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";

const PlatformRules = () => {
  usePageTitle("Platform Rules & Policies — Helpr");

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <Navbar />
      <div aria-hidden className="h-14" />

      <main className="container mx-auto px-5 pt-1 pb-8">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="flex items-center gap-2">
            <BackButton to="/profile?tab=legal" />
            <h1 className="text-page-title text-foreground">Platform Rules &amp; Pricing</h1>
          </div>
          <p className="text-[11px] text-muted-foreground pl-12">Last updated: March 2026</p>

          <p className="text-sm text-muted-foreground px-1">
            These rules keep Helpr safe, fair, and reliable for everyone. By using Helpr, you agree to follow these policies.
          </p>

          <PolicySection icon={XCircle} title="Cancellation Policy" subtitle="Fees scale with how late you cancel" warning defaultOpen>
            <PolicyRowItem icon={CheckCircle} title="24+ hours before job" body={<p>Free cancellation — no fee charged.</p>} />
            <PolicyRowItem icon={AlertTriangle} title="Less than 24 hours before" body={<p><strong className="text-foreground">25% cancellation fee</strong> applied. The helpr has already committed their time.</p>} />
            <PolicyRowItem icon={XCircle} title="Less than 2 hours before" body={<p><strong className="text-foreground">50% cancellation fee</strong> applied. This is considered a very late cancellation.</p>} warning />
            <PolicyRowItem icon={AlertTriangle} title="Repeated late cancellations" body={<p>May result in account restrictions. Cancellation fees compensate helprs for lost time and opportunity.</p>} />
          </PolicySection>

          <PolicySection icon={DollarSign} title="Payment & Release Policy" subtitle="How escrow funds are released to helprs">
            <PolicyRowItem icon={CheckCircle} title="Mutual confirmation = instant release" body={<p>When both poster and helpr confirm completion, payment releases immediately.</p>} />
            <PolicyRowItem icon={Clock} title="One-sided confirmation = 72-hour window" body={<p>If only one party confirms, the other has 72 hours to confirm or request a revision. Both parties are notified every 12 hours.</p>} />
            <PolicyRowItem icon={CheckCircle} title="Auto-release after 72 hours" body={<p>If neither confirmation nor revision is received within 72 hours, payment is automatically released to the helpr.</p>} />
          </PolicySection>

          <PolicySection icon={AlertTriangle} title="Cancellation Strikes (Posters)" subtitle="Cancelling after a helpr is selected" warning>
            <PolicyRowItem icon={AlertTriangle} title="1st — Written warning (1/2)" body={<p>Formal warning recorded on your account; admins are notified.</p>} />
            <PolicyRowItem icon={AlertTriangle} title="2nd — Final warning (2/2)" body={<p>Last chance. Another cancellation after selecting a helpr will result in a permanent ban.</p>} />
            <PolicyRowItem icon={Ban} title="3rd — Permanent ban" body={<p>Account permanently removed. This decision is final and cannot be appealed.</p>} warning />
            <PolicyRowItem icon={CheckCircle} title="No helpr assigned yet?" body={<p>Cancelling a job with no helpr assigned does not count toward strikes. Cancellation fees still apply based on timing.</p>} />
          </PolicySection>

          <PolicySection icon={XCircle} title="Job Denial Strikes (Helprs)" subtitle="Declining after being selected" warning>
            <PolicyRowItem icon={AlertTriangle} title="1st — Written warning (1/2)" body={<p>Formal warning recorded. Only apply to jobs you can commit to.</p>} />
            <PolicyRowItem icon={AlertTriangle} title="2nd — Final warning (2/2)" body={<p>Last chance. One more decline will permanently ban your account.</p>} />
            <PolicyRowItem icon={Ban} title="3rd — Permanent ban" body={<p>Account permanently removed. This cannot be reversed.</p>} warning />
            <PolicyRowItem icon={CheckCircle} title="Withdrawing before selection" body={<p>Withdrawing your application <strong className="text-foreground">before</strong> being selected does not count as a decline.</p>} />
          </PolicySection>

          <PolicySection icon={Ban} title="No-Show Policy" subtitle="Zero tolerance — immediate permanent ban" warning>
            <PolicyRowItem icon={Ban} title="No warnings, no exceptions" body={<p>If a helpr accepts a job and fails to show without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong>. The poster receives a full refund.</p>} warning />
            <PolicyRowItem icon={AlertTriangle} title="Can't make it?" body={<p>Cancel ahead of time. Even a late cancellation is better than a no-show.</p>} />
          </PolicySection>

          <PolicySection icon={Shield} title="Immediate Ban Offenses" subtitle="Skip all warnings — instant permanent ban" warning>
            <PolicyRowItem icon={Ban} title="No-show" body={<p>Accepting a job and not showing up.</p>} warning />
            <PolicyRowItem icon={Ban} title="Fraud" body={<p>Fake profiles, falsified completion photos, or payment manipulation.</p>} warning />
            <PolicyRowItem icon={Ban} title="Harassment or threats" body={<p>Abusive language, intimidation, or safety threats toward any user.</p>} warning />
            <PolicyRowItem icon={Ban} title="Off-platform payments" body={<p>Attempting to arrange payment outside of Helpr.</p>} warning />
            <PolicyRowItem icon={Ban} title="Identity fraud" body={<p>Using someone else's identity or fake ID documents.</p>} warning />
            <PolicyRowItem icon={Ban} title="Dispute system abuse" body={<p>Filing false disputes to avoid paying helprs.</p>} warning />
          </PolicySection>

          <PolicySection icon={Clock} title="Job Editing Restrictions" subtitle="What you can change, and when">
            <PolicyRowItem icon={CheckCircle} title="Before a helpr is selected" body={<p>Freely edit title, description, budget, date, and other details.</p>} />
            <PolicyRowItem icon={XCircle} title="After a helpr is selected" body={<p>Jobs cannot be edited once a helpr accepts. This protects helprs from unexpected scope or budget changes. If adjustments are needed, cancel and repost.</p>} />
          </PolicySection>

          <PolicySection icon={Scale} title="Revision, Dispute & Resolution" subtitle="3-step escalation — must follow in order">
            <PolicyRowItem icon={Clock} title="Step 1 — Request a Revision (72h)" body={<><p>If unsatisfied, request a revision first. Include a clear note about what needs to change.</p><ul className="list-disc pl-4 space-y-0.5"><li>Helpr has <strong className="text-foreground">72h</strong> to address and mark fixed</li><li>You then have <strong className="text-foreground">72h</strong> to accept or dispute</li><li>No response in 72h → job auto-completes, payment releases</li><li>Helpr doesn't fix in 72h → mark complete or file dispute</li></ul></>} />
            <PolicyRowItem icon={Scale} title="Step 2 — File a Dispute" body={<><p>If revision fails, file a formal dispute. Payment is held; <strong className="text-foreground">strict 72h window</strong> begins. Provide:</p><ul className="list-disc pl-4 space-y-0.5"><li>Specific reason for the dispute</li><li>Photo evidence or documentation</li><li>Description of what went wrong</li></ul><p className="pt-1">Then you have 72h to either Mark Resolved, Escalate to Admin, or do nothing (auto-releases to helpr).</p></>} />
            <PolicyRowItem icon={Shield} title="Step 3 — Admin Resolution (final)" body={<p>An admin reviews evidence from both parties and makes a final, binding decision: full release, partial refund, or full refund.</p>} />
            <PolicyRowItem icon={AlertTriangle} title="Dispute abuse policy" body={<ul className="list-disc pl-4 space-y-0.5"><li>False or frivolous disputes = immediate ban</li><li>3+ disputes in 30 days flags your account</li><li>Ignore the 72h deadline → payment releases, no exceptions</li></ul>} warning />
          </PolicySection>

          <PolicySection icon={Shield} title="Job Budget Limits" subtitle="$5 minimum, $5,000 maximum">
            <PolicyRowItem icon={DollarSign} title="Minimum: $5" body={<p>Jobs below $5 cannot be posted.</p>} />
            <PolicyRowItem icon={DollarSign} title="Maximum: $5,000" body={<p>For projects exceeding $5,000, split into multiple jobs or contact support.</p>} />
          </PolicySection>

          <PolicySection icon={AlertTriangle} title="Repeat Offender Policy" subtitle="Escalating response for policy violations" warning>
            <PolicyRowItem icon={AlertTriangle} title="1st — Written warning" body={<p>Formal warning via email and in-app notification.</p>} />
            <PolicyRowItem icon={Clock} title="2nd — 7-day suspension" body={<p>Account temporarily suspended. Cannot post or accept jobs during this time.</p>} />
            <PolicyRowItem icon={Ban} title="3rd — Permanent ban" body={<p>Account permanently removed. Decision is final.</p>} warning />
            <PolicyRowItem icon={AlertTriangle} title="Severe violations skip the ladder" body={<p>No-shows, fraud, harassment, and safety threats result in immediate permanent ban.</p>} warning />
          </PolicySection>

          <PolicySection icon={Receipt} title="Tax Responsibilities" subtitle="Federal & Louisiana state obligations">
            <PolicyRowItem icon={Receipt} title="Helpr (the platform)" body={<><p><strong className="text-foreground">1099-K (2026):</strong> Federal threshold reverted to $20,000 AND 200+ transactions. Louisiana follows federal.</p><p><strong className="text-foreground">1099-NEC (2026):</strong> Threshold raised from $600 to $2,000.</p><p><strong className="text-foreground">Marketplace facilitator:</strong> Above $100,000 LA gross revenue, Helpr collects/remits sales tax on the entire transaction.</p><p><strong className="text-foreground">LDR e-filing mandate:</strong> All LA withholding and sales tax returns filed electronically as of Jan 1, 2026.</p><p><strong className="text-foreground">Worker classification:</strong> Helprs qualify as independent contractors under the Economic Reality Test.</p></>} />
            <PolicyRowItem icon={CheckCircle} title="Job Posters (customers)" body={<><p><strong className="text-foreground">Sales tax:</strong> Helpr collects on your behalf and remits to the state.</p><p><strong className="text-foreground">No payroll obligations:</strong> Workers are independent contractors — no withholding required.</p></>} />
            <PolicyRowItem icon={AlertTriangle} title="Helprs (workers)" body={<><p><strong className="text-foreground">Self-employment tax:</strong> Full 15.3% (Social Security + Medicare) on Helpr earnings.</p><p><strong className="text-foreground">Income tax:</strong> Report all Helpr income on state and federal returns.</p><p><strong className="text-foreground">Quarterly estimates:</strong> Significant earnings may require quarterly estimated payments to IRS and LDR.</p></>} warning />
            <PolicyRowItem icon={Receipt} title="Louisiana parish rates" body={<p>LA parishes collect their own sales taxes. Helpr applies the correct rate based on job location.</p>} />
            <PolicyRowItem icon={AlertTriangle} title="General guidance only" body={<p>Tax laws change frequently. Consult a CPA for advice specific to your situation.</p>} />
          </PolicySection>

          <p className="text-xs text-muted-foreground text-center pt-4 pb-8">
            Questions about our policies? <Link to="/support" className="text-primary hover:underline">Contact support</Link>
            <br />
            Also see our <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </div>
  );
};

export default PlatformRules;
