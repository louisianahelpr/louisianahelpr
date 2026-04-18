import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Shield, DollarSign, Users, AlertTriangle, Clock, Zap, CreditCard, Ban, MapPin, Crown, Scale, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";

const TermsOfService = () => {
  const navigate = useNavigate();
  usePageTitle("Terms & Policies — Helpr");

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-8">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-xl h-9 w-9 shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h1 className="text-3xl font-display font-bold text-foreground">Terms & Policies</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-2 ml-11">Last updated: March 2026</p>
          </div>

          {/* Terms of Use */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Terms of Use
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>By accessing or using the Helpr platform ("Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
              <p><strong className="text-foreground">Eligibility:</strong> You must be at least 18 years old to use Helpr. Age verification is mandatory during signup. By creating an account, you represent that you meet this requirement.</p>
              <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your account credentials and all activity that occurs under your account.</p>
              <p><strong className="text-foreground">Account Approval:</strong> All new accounts are subject to review. Your account will remain in a pending state until approved by our team. Denied accounts will receive an explanation and may reapply.</p>
              <p><strong className="text-foreground">Task Agreements:</strong> When you accept a task or hire a helpr, you enter a binding agreement to complete the work as described and to release payment upon satisfactory completion.</p>
              <p><strong className="text-foreground">Dispute Resolution:</strong> All disputes follow a mandatory 3-step process: (1) Request a revision, (2) File a formal dispute with a 72-hour resolution window, (3) Escalate to admin for a final decision. If you file a dispute and do not resolve or escalate within 72 hours, payment is automatically released to the helpr. Filing false disputes to avoid payment is grounds for immediate permanent ban. Full details are in our <a href="/rules" className="text-primary hover:underline">Platform Rules</a>.</p>
              <p><strong className="text-foreground">Prohibited Conduct:</strong> You may not use Helpr for illegal activities, harassment, fraud, discrimination, off-platform payment solicitation, or any conduct that violates the rights of others.</p>
              <p><strong className="text-foreground">Account Termination:</strong> Helpr reserves the right to suspend or terminate accounts that violate these terms, at our sole discretion.</p>
              <p><strong className="text-foreground">Intellectual Property:</strong> All content, branding, and technology on the Helpr platform are owned by Helpr. You may not copy, modify, or distribute any part of the Service without permission.</p>
              <p><strong className="text-foreground">Limitation of Liability:</strong> Helpr acts as a marketplace connecting customers and helprs. We are not responsible for the quality, safety, or legality of tasks performed through the platform.</p>
            </div>
          </section>

          {/* Payment, Escrow & Fees */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" /> Payment, Escrow & Fees
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4 text-sm text-muted-foreground">
              <div>
                <p className="font-semibold text-foreground mb-1">Payment System</p>
                <p>All payments are processed immediately via Stripe at the time of booking. Funds are charged to the customer upfront and held by the platform. A Stripe transfer to the helpr's connected account is initiated only after both parties confirm job completion. Refunds are issued if a job is cancelled before completion.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Split Fee Model</p>
                <p>Helpr uses a split fee model: customers pay a <strong className="text-foreground">10% service fee</strong> added at checkout, and helpers pay a <strong className="text-foreground">10% commission</strong> deducted from their payout. The total platform take is 20% per transaction.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Payout Schedule</p>
                <p>After dual completion confirmation, payouts are scheduled with a <strong className="text-foreground">24–48 hour delay</strong> to accommodate potential disputes before funds are transferred.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Auto-Release</p>
                <p>If one party confirms completion but the other does not respond, payment is automatically released to the helpr after <strong className="text-foreground">72 hours</strong>.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Stripe Connect Requirement</p>
                <p>Helpers must link a <strong className="text-foreground">Stripe Connect Express account</strong> before they can accept job offers and receive payouts.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Urgent Job Fee</p>
                <p>Customers may pay a <strong className="text-foreground">$5 Urgent Job fee</strong> for priority placement in the job feed.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Refunds</p>
                <p>Refunds are evaluated on a case-by-case basis through the dispute system. Contact support to initiate a dispute.</p>
              </div>
            </div>
          </section>

          {/* Cancellation Policy */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Cancellation Policy
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>Cancellations are subject to tiered fees based on proximity to the scheduled start time:</p>
              <div className="rounded-lg bg-muted/40 border border-border/50 overflow-hidden">
                <div className="grid grid-cols-2 text-xs font-semibold text-foreground bg-muted/60 px-4 py-2.5 border-b border-border/50">
                  <span>Timeframe</span>
                  <span>Fee</span>
                </div>
                <div className="grid grid-cols-2 text-xs px-4 py-2.5 border-b border-border/30">
                  <span>Within <strong className="text-foreground">4 hours</strong> of start</span>
                  <span className="text-destructive font-semibold">$15.00</span>
                </div>
                <div className="grid grid-cols-2 text-xs px-4 py-2.5 border-b border-border/30">
                  <span>Within <strong className="text-foreground">24 hours</strong> of start</span>
                  <span className="text-accent-foreground font-semibold">$5.00</span>
                </div>
                <div className="grid grid-cols-2 text-xs px-4 py-2.5">
                  <span>More than 24 hours before</span>
                  <span className="text-primary font-semibold">Free</span>
                </div>
              </div>
              <p>Late cancellations are flagged on your account and may affect your standing on the platform.</p>
            </div>
          </section>

          {/* Subscription Tiers */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" /> Subscription Tiers
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4 text-sm text-muted-foreground">
              <p>Helpr offers a 3-tier subscription system for helprs:</p>
              <div className="rounded-lg bg-muted/40 border border-border/50 overflow-hidden">
                <div className="grid grid-cols-3 text-xs font-semibold text-foreground bg-muted/60 px-4 py-2.5 border-b border-border/50">
                  <span>Tier</span>
                  <span>Monthly</span>
                  <span>Annual</span>
                </div>
                <div className="grid grid-cols-3 text-xs px-4 py-2.5 border-b border-border/30">
                  <span>⭐ Basic</span>
                  <span>$5/mo</span>
                  <span>~$50/yr</span>
                </div>
                <div className="grid grid-cols-3 text-xs px-4 py-2.5 border-b border-border/30">
                  <span>🔥 Pro</span>
                  <span>$10/mo</span>
                  <span>~$100/yr</span>
                </div>
                <div className="grid grid-cols-3 text-xs px-4 py-2.5">
                  <span>💎 Elite</span>
                  <span>$15/mo</span>
                  <span>~$150/yr</span>
                </div>
              </div>
              <p>Billing intervals include One-Time, Monthly, and Annual (discounted at ~10× monthly rate). All tiers include early access to new jobs and maintain the same 10% customer service fee + 10% helper commission. Stripe handles billing dates automatically based on your subscription start date.</p>
            </div>
          </section>

          {/* Helper Accountability */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" /> Helper Accountability
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <div>
                <p className="font-semibold text-foreground mb-1">Response Deadlines</p>
                <p>Job offers include a <strong className="text-foreground">1–48 hour response deadline</strong>. Failing to respond or declining multiple offers results in escalating penalties.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">New Account Restrictions</p>
                <p>New helpr accounts are restricted to:</p>
                <ul className="list-disc list-inside space-y-1 mt-1 ml-2">
                  <li>Maximum of <strong className="text-foreground">3 active jobs</strong> at a time</li>
                  <li>Maximum of <strong className="text-foreground">$100 in total earnings</strong></li>
                </ul>
                <p className="mt-1">These restrictions are lifted once the helpr achieves <strong className="text-foreground">3 verified completions with a 4+ star rating</strong>.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Completion Requirements</p>
                <p>Helpers must upload before/after photos for job completion. A minimum <strong className="text-foreground">30-minute job duration</strong> is required before marking a job as complete.</p>
              </div>
            </div>
          </section>

          {/* Trust & Safety */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Trust & Safety
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <div>
                <p className="font-semibold text-foreground mb-1">Identity Verification</p>
                <p>All users must be <strong className="text-foreground">18 years or older</strong>. Helpers undergo ID document verification before account approval.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">GPS Proximity Validation</p>
                <p>Job check-ins require <strong className="text-foreground">GPS proximity within 500 feet</strong> of the job location to start a task.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Chat Safety</p>
                <p>In-app messages are scanned in real-time to detect and prevent <strong className="text-foreground">off-platform payment attempts</strong> (e.g., sharing Venmo, CashApp, or phone numbers).</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Fraud Detection</p>
                <p>The platform automatically flags suspicious activities including:</p>
                <ul className="list-disc list-inside space-y-1 mt-1 ml-2">
                  <li>Job completions under 15 minutes</li>
                  <li>Missing GPS check-ins</li>
                  <li>Repeated disputes on a single helpr account</li>
                </ul>
                <p className="mt-1">Flagged activities are reviewed by our admin team.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Dispute System</p>
                <p>Either party can open a dispute after job completion. Disputes trigger an admin review. Evidence (photos, messages) can be submitted. During a dispute, payment is held until resolution.</p>
              </div>
            </div>
          </section>

          {/* Community Guidelines */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Community Guidelines
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>Helpr is built on trust. We expect all users to follow these guidelines to maintain a safe and positive community.</p>
              <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism, regardless of background.</p>
              <p><strong className="text-foreground">Honesty:</strong> Provide accurate information in your profile and job descriptions. Misrepresentation may result in account suspension.</p>
              <p><strong className="text-foreground">Safety:</strong> Never share personal contact information through the messaging system. Use in-app chat for all job coordination.</p>
              <p><strong className="text-foreground">Timeliness:</strong> Show up on time and communicate promptly. If you can't make a commitment, cancel with advance notice to avoid fees.</p>
              <p><strong className="text-foreground">Quality:</strong> Complete tasks to the standard described in the job posting. Upload before/after photos as required.</p>
              <p><strong className="text-foreground">On-Platform Payments Only:</strong> All payments must go through the Helpr platform. Attempting to arrange off-platform payments will result in account suspension.</p>
              <p><strong className="text-foreground">Reporting:</strong> Report any suspicious, inappropriate, or unsafe behavior using the report feature. All reports are reviewed by Helpr Trust & Safety.</p>
            </div>
          </section>

          {/* Violations & Enforcement */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-primary" /> Violations & Enforcement
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>Violations of these terms or guidelines result in escalating enforcement actions:</p>
              <div className="rounded-lg bg-muted/40 border border-border/50 overflow-hidden">
                <div className="grid grid-cols-2 text-xs font-semibold text-foreground bg-muted/60 px-4 py-2.5 border-b border-border/50">
                  <span>Offense</span>
                  <span>Action</span>
                </div>
                <div className="grid grid-cols-2 text-xs px-4 py-2.5 border-b border-border/30">
                  <span>1st–2nd report</span>
                  <span>Warning notification</span>
                </div>
                <div className="grid grid-cols-2 text-xs px-4 py-2.5 border-b border-border/30">
                  <span>3 reports</span>
                  <span className="text-accent-foreground font-semibold">7-day temporary ban</span>
                </div>
                <div className="grid grid-cols-2 text-xs px-4 py-2.5">
                  <span>4+ violations</span>
                  <span className="text-destructive font-semibold">Permanent account ban</span>
                </div>
              </div>
              <p>Additional enforcement actions may include:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Withholding of pending payments</li>
                <li>Removal of active job listings</li>
                <li>Reporting to law enforcement (for illegal activity)</li>
              </ul>
              <p>The severity of the action depends on the nature and frequency of the violation. Helpr reserves the right to ban accounts immediately for severe violations.</p>
            </div>
          </section>

          {/* Tax Responsibilities */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" /> Tax Responsibilities
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4 text-sm text-muted-foreground">
              <p>Helpr operates as a marketplace facilitator. Each party has distinct tax obligations:</p>
              <div>
                <p className="font-semibold text-foreground mb-1">Platform (Helpr, LLC)</p>
                <p>Helpr reports worker earnings to the IRS via <strong className="text-foreground">Form 1099-K</strong> when federal thresholds are met. As a Louisiana marketplace facilitator, Helpr collects and remits applicable state and parish-level sales tax on taxable services.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Job Posters (Customers)</p>
                <p>You pay the agreed job fee plus any applicable sales tax (collected by Helpr). Workers are <strong className="text-foreground">independent contractors</strong> — you have no payroll, withholding, or employer tax obligations.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Helprs (Workers)</p>
                <p>As independent contractors, you are responsible for <strong className="text-foreground">self-employment tax (15.3%)</strong>, reporting all income on your state and federal returns, and making <strong className="text-foreground">quarterly estimated tax payments</strong> if applicable. You will receive a 1099-K if you meet federal reporting thresholds.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Louisiana Parish Sales Tax</p>
                <p>Louisiana parishes collect their own sales taxes. Rates vary by job location. Helpr applies the correct parish rate automatically based on where the job is performed.</p>
              </div>
              <p className="text-xs italic">Tax laws change frequently. This is general guidance — consult a CPA for advice specific to your situation. See our <Link to="/rules" className="text-primary hover:underline">Platform Rules</Link> for more detail.</p>
            </div>
          </section>

          {/* Privacy Summary */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Privacy Summary
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Data Collection:</strong> We collect information you provide (name, email, phone, location, date of birth, ID documents) and usage data to operate the platform.</p>
              <p><strong className="text-foreground">Data Usage:</strong> Your data is used to match you with tasks, process payments, verify identity, prevent fraud, and improve our services.</p>
              <p><strong className="text-foreground">Data Sharing:</strong> Limited information (first name, reviews, ratings) is shared with other users. Payment data is handled by Stripe. We never sell your personal information.</p>
              <p><strong className="text-foreground">Data Retention:</strong> Your data is retained while your account is active. Request deletion anytime by contacting support.</p>
              <p>For full details, see our <Link to="/privacy" className="text-primary hover:underline font-medium">Privacy Policy</Link>.</p>
            </div>
          </section>

          <p className="text-xs text-muted-foreground text-center pb-8">
            Questions about these terms? <Link to="/support" className="text-primary hover:underline">Contact support</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default TermsOfService;
