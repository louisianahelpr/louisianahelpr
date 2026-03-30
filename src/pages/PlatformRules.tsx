import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { 
  Shield, DollarSign, Clock, AlertTriangle, Ban, 
  Scale, ArrowLeft, CheckCircle, XCircle, Timer 
} from "lucide-react";

const PlatformRules = () => {
  usePageTitle("Platform Rules & Policies — Helpr");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <div className="space-y-2 mb-12">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-xl h-9 w-9 shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-3xl font-display font-bold text-foreground">Platform Rules & Policies</h1>
          </div>
          <p className="text-muted-foreground">
            These rules keep Helpr safe, fair, and reliable for everyone. By using Helpr, you agree to follow these policies.
          </p>
          <p className="text-xs text-muted-foreground">Last updated: March 2026</p>
        </div>

        {/* Cancellation Policy */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Cancellation Policy</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              We understand plans change. However, last-minute cancellations impact helprs who've set aside time for your job. 
              Fees are calculated as a percentage of the job budget.
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <CheckCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">24+ hours before job</p>
                  <p className="text-xs text-muted-foreground">Free cancellation — no fee charged.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <AlertTriangle className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Less than 24 hours before job</p>
                  <p className="text-xs text-muted-foreground">25% cancellation fee applied. The helpr has already committed their time.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                <XCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Less than 2 hours before job</p>
                  <p className="text-xs text-muted-foreground">50% cancellation fee applied. This is considered a very late cancellation.</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Cancellation fees compensate helprs for lost time and opportunity. Repeated late cancellations may result in account restrictions.
            </p>
          </div>
        </section>

        {/* Payment & Release Policy */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Payment & Release Policy</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Mutual confirmation = instant release</p>
                  <p className="text-xs text-muted-foreground">When both the poster and helpr confirm the job is complete, payment is released immediately.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">One-sided confirmation = 72-hour window</p>
                  <p className="text-xs text-muted-foreground">
                    If only one party confirms, the other has 72 hours to confirm or request a revision. 
                    Both parties are notified every 12 hours during this window.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">3</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Auto-release after 72 hours</p>
                  <p className="text-xs text-muted-foreground">
                    If neither confirmation nor revision is received within 72 hours, payment is automatically released to the helpr.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Cancellation Strike System */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Cancellation Strike System (Posters)</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Cancelling a job <strong className="text-foreground">after a helpr has already been selected</strong> is taken seriously. 
              Helprs commit their time and may turn down other opportunities. The following escalation applies:
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <span className="text-sm font-bold text-accent mt-0.5 shrink-0">1st</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Written warning (Strike 1/2)</p>
                  <p className="text-xs text-muted-foreground">You'll receive a formal warning. The cancellation is recorded on your account and admins are notified.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <span className="text-sm font-bold text-accent mt-0.5 shrink-0">2nd</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Final warning (Strike 2/2)</p>
                  <p className="text-xs text-muted-foreground">This is your last chance. Another cancellation after selecting a helpr will result in a permanent ban.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                <span className="text-sm font-bold text-destructive mt-0.5 shrink-0">3rd</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Permanent ban</p>
                  <p className="text-xs text-muted-foreground">Your account is permanently removed from Helpr. This decision is final and cannot be appealed.</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Note: Cancelling a job that has <strong>no helpr assigned yet</strong> does not count toward strikes. 
              Cancellation fees still apply based on timing regardless of strikes.
            </p>
          </div>
        </section>

        {/* Job Denial Strike System */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Job Denial Strike System (Helprs)</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              If you're <strong className="text-foreground">selected for a job and decline it</strong>, it impacts the poster who chose you 
              and delays their task. Declining after being selected follows the same escalation:
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <span className="text-sm font-bold text-accent mt-0.5 shrink-0">1st</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Written warning (Strike 1/2)</p>
                  <p className="text-xs text-muted-foreground">A formal warning is recorded. Consider only applying to jobs you can commit to.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <span className="text-sm font-bold text-accent mt-0.5 shrink-0">2nd</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Final warning (Strike 2/2)</p>
                  <p className="text-xs text-muted-foreground">This is your last chance. One more decline will permanently ban your account.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                <span className="text-sm font-bold text-destructive mt-0.5 shrink-0">3rd</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Permanent ban</p>
                  <p className="text-xs text-muted-foreground">Your account is permanently removed from Helpr. This cannot be reversed.</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Tip: Only apply to jobs you're confident you can complete. Withdrawing your application <strong>before</strong> being selected does not count as a decline.
            </p>
          </div>
        </section>

        {/* No-Show Policy */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <Ban className="w-5 h-5 text-destructive" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">No-Show Policy</h2>
          </div>
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 space-y-3">
            <p className="text-sm font-semibold text-foreground">Zero tolerance — immediate permanent ban</p>
            <p className="text-sm text-muted-foreground">
              If a helpr accepts a job and fails to show up without prior cancellation, their account will be 
              <strong className="text-destructive"> permanently banned</strong> from Helpr. No warnings. No exceptions.
            </p>
            <p className="text-sm text-muted-foreground">
              The poster will receive a full refund. If you can't make it, cancel the job ahead of time — 
              even a late cancellation is better than a no-show.
            </p>
          </div>
        </section>

        {/* Immediate Ban Offenses */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-destructive" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Immediate Ban Offenses</h2>
          </div>
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              The following actions skip all warnings and result in an <strong className="text-destructive">immediate permanent ban</strong>:
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" /> <span><strong className="text-foreground">No-show</strong> — accepting a job and not showing up</span></li>
              <li className="flex items-start gap-2"><Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" /> <span><strong className="text-foreground">Fraud</strong> — fake profiles, falsified completion photos, or payment manipulation</span></li>
              <li className="flex items-start gap-2"><Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" /> <span><strong className="text-foreground">Harassment or threats</strong> — abusive language, intimidation, or safety threats toward any user</span></li>
              <li className="flex items-start gap-2"><Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" /> <span><strong className="text-foreground">Off-platform payments</strong> — attempting to arrange payment outside of Helpr</span></li>
              <li className="flex items-start gap-2"><Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" /> <span><strong className="text-foreground">Identity fraud</strong> — using someone else's identity or fake ID documents</span></li>
              <li className="flex items-start gap-2"><Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" /> <span><strong className="text-foreground">Dispute system abuse</strong> — filing false disputes to avoid paying helprs</span></li>
            </ul>
          </div>
        </section>

        {/* Job Editing Restrictions */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Job Editing Restrictions</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <CheckCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Before a helpr is selected</p>
                <p className="text-xs text-muted-foreground">You can freely edit your job title, description, budget, date, and other details.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
              <XCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">After a helpr is selected</p>
                <p className="text-xs text-muted-foreground">
                  Jobs cannot be edited once a helpr has been accepted. This protects helprs from unexpected scope or budget changes. 
                  If adjustments are needed, use the addon request feature or cancel and repost.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Revision, Dispute & Resolution Process */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Scale className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Revision, Dispute & Resolution Process</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <p className="text-sm text-muted-foreground">
              Helpr uses a <strong className="text-foreground">3-step escalation process</strong> to resolve issues fairly. 
              You must follow these steps in order — disputes cannot be filed without first requesting a revision.
            </p>

            {/* Step 1: Revision */}
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Request a Revision</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    If you're not satisfied with the work, request a revision first. This gives the helpr a chance to fix the issue. 
                    Include a clear note about what needs to change. The helpr can then address the problem and resubmit.
                  </p>
                </div>
              </div>
            </div>

            {/* Step 2: Dispute */}
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-accent">2</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">File a Dispute (if revision fails)</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    If the revision doesn't resolve the issue, you can file a formal dispute. This puts the payment on hold and starts a 
                    <strong className="text-foreground"> strict 72-hour resolution window</strong>. You must provide:
                  </p>
                  <ul className="text-xs text-muted-foreground mt-1 list-disc pl-4 space-y-0.5">
                    <li>A specific reason for the dispute</li>
                    <li>Photo evidence or documentation (recommended)</li>
                    <li>A description of what went wrong</li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">
                    The helpr can respond with their side of the story. You then have 72 hours to either:
                  </p>
                  <ul className="text-xs text-muted-foreground mt-1 list-disc pl-4 space-y-0.5">
                    <li><strong className="text-foreground">Mark Resolved</strong> — releases payment to the helpr</li>
                    <li><strong className="text-foreground">Escalate to Admin</strong> — an admin will make the final decision</li>
                    <li><strong className="text-destructive">Do nothing</strong> — payment auto-releases to the helpr after 72 hours</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Step 3: Admin */}
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                <div className="w-7 h-7 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-destructive">3</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Admin Resolution (final step)</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    If escalated, an admin reviews all evidence from both parties and makes a final, binding decision. 
                    This may result in full payment release, partial refund, or full refund depending on the circumstances.
                  </p>
                </div>
              </div>
            </div>

            {/* Anti-abuse warnings */}
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4 space-y-2">
              <p className="text-sm font-semibold text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Dispute Abuse Policy
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>Filing <strong className="text-foreground">false or frivolous disputes</strong> to avoid paying is an immediate ban offense</li>
                <li><strong className="text-foreground">3+ disputes in 30 days</strong> automatically flags your account for admin review</li>
                <li>If you <strong className="text-foreground">ignore the 72-hour deadline</strong>, payment is released to the helpr — no exceptions</li>
                <li>The dispute system exists to protect both parties — not to be used as a negotiation tactic</li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground italic">
              By using Helpr, you agree to this dispute resolution process. During any dispute, funds are held securely until resolution.
            </p>
          </div>
        </section>

        {/* Job Budget Limits */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Job Budget Limits</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-2xl font-bold text-foreground">$5</p>
                <p className="text-xs text-muted-foreground">Minimum per job</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-2xl font-bold text-foreground">$5,000</p>
                <p className="text-xs text-muted-foreground">Maximum per job</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Jobs outside this range cannot be posted. For projects exceeding $5,000, consider splitting into milestones or contact support.
            </p>
          </div>
        </section>

        {/* Repeat Offender Policy */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">Repeat Offender Policy</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Helpr uses an escalating response system for policy violations. Severity depends on the type and frequency of infractions.
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <span className="text-sm font-bold text-accent mt-0.5">1st</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Written warning</p>
                  <p className="text-xs text-muted-foreground">You'll receive a formal warning via email and in-app notification.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                <span className="text-sm font-bold text-accent mt-0.5">2nd</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">7-day suspension</p>
                  <p className="text-xs text-muted-foreground">Your account will be temporarily suspended. You cannot post or accept jobs during this time.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                <span className="text-sm font-bold text-destructive mt-0.5">3rd</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Permanent ban</p>
                  <p className="text-xs text-muted-foreground">Your account will be permanently removed from Helpr. This decision is final.</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Severe violations (no-shows, fraud, harassment, safety threats) skip the escalation ladder and result in an immediate permanent ban.
            </p>
          </div>
        </section>

        <div className="border-t border-border pt-8 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Questions about our policies? <Link to="/support" className="text-primary hover:underline">Contact support</Link>
          </p>
          <p className="text-xs text-muted-foreground">
            Also see our <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PlatformRules;
