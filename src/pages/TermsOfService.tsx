import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FileText, Shield, DollarSign, Users, AlertTriangle, Clock, Crown, Scale, Receipt,
  ChevronDown, ChevronRight, Building2, Wallet, HeartPulse, Siren,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { usePageTitle } from "@/hooks/usePageTitle";
import Navbar from "@/components/Navbar";
import BackButton from "@/components/BackButton";

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
          warning ? "hover:bg-destructive/10" : "hover:bg-primary/5"
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

const Section = ({
  icon: Icon,
  title,
  subtitle,
  warning,
  defaultOpen = false,
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
          warning ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"
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

const TermsOfService = () => {
  usePageTitle("Terms & Policies — Helpr");

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <Navbar />
      <div aria-hidden className="h-14" />

      <main className="mx-auto max-w-3xl px-5 pt-1 pb-6">
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <BackButton to="/profile?tab=legal" />
              <h1 className="text-page-title text-foreground leading-tight">
                Terms &amp; Policies
              </h1>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 pl-12">Last updated: March 2026</p>
          </div>

          <Section
            icon={Building2}
            title="Terms of Use"
            subtitle="Eligibility, accounts, and core rules"
            defaultOpen
          >
            <RowItem
              icon={FileText}
              title="Eligibility & Accounts"
              body={
                <>
                  <p><strong className="text-foreground">Eligibility:</strong> You must be at least 18 years old. Age verification is mandatory at signup.</p>
                  <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your credentials and all activity under your account.</p>
                  <p><strong className="text-foreground">Account Approval:</strong> All new accounts are subject to review and remain pending until approved. Denied accounts receive an explanation and may reapply.</p>
                </>
              }
            />
            <RowItem
              icon={Scale}
              title="Task Agreements & Disputes"
              body={
                <>
                  <p><strong className="text-foreground">Binding Agreement:</strong> Accepting a task or hiring a helpr creates a binding commitment to complete the work as described and release payment on satisfactory completion.</p>
                  <p><strong className="text-foreground">Dispute Resolution:</strong> All disputes follow a mandatory 3-step process — request a revision, file a formal dispute (72-hour window), then escalate to admin. Unresolved disputes auto-release payment after 72 hours. False disputes result in an immediate ban. See <Link to="/rules" className="text-primary hover:underline">Platform Rules</Link>.</p>
                </>
              }
            />
            <RowItem
              icon={AlertTriangle}
              title="Prohibited Conduct & Termination"
              body={
                <>
                  <p><strong className="text-foreground">Prohibited:</strong> Illegal activities, harassment, fraud, discrimination, off-platform payment solicitation, or any conduct that violates the rights of others.</p>
                  <p><strong className="text-foreground">Termination:</strong> Helpr reserves the right to suspend or terminate accounts at our sole discretion.</p>
                  <p><strong className="text-foreground">Intellectual Property:</strong> All content, branding, and technology are owned by Helpr. No copying, modifying, or redistributing without permission.</p>
                  <p><strong className="text-foreground">Liability:</strong> Helpr is a marketplace and is not responsible for the quality, safety, or legality of tasks performed.</p>
                </>
              }
            />
          </Section>

          <Section
            icon={Wallet}
            title="Payment, Escrow &amp; Fees"
            subtitle="How money moves on the platform"
          >
            <RowItem
              icon={DollarSign}
              title="Payment & Escrow"
              body={
                <>
                  <p><strong className="text-foreground">Charged Upfront:</strong> Payments are processed via Stripe at booking and held by the platform until both parties confirm completion.</p>
                  <p><strong className="text-foreground">Auto-Release:</strong> If only one party confirms, payment auto-releases to the helpr after 72 hours.</p>
                  <p><strong className="text-foreground">Refunds:</strong> Refunds are evaluated case-by-case through the dispute system.</p>
                </>
              }
            />
            <RowItem
              icon={DollarSign}
              title="Split Fee Model"
              body={
                <>
                  <p><strong className="text-foreground">Poster Service Fee:</strong> 10% added at checkout.</p>
                  <p><strong className="text-foreground">Helpr Platform Fee:</strong> 10% deducted from payout.</p>
                  <p><strong className="text-foreground">Total Take:</strong> 20% per transaction.</p>
                  <p><strong className="text-foreground">Urgent Job Fee:</strong> $5 for priority placement.</p>
                </>
              }
            />
            <RowItem
              icon={Clock}
              title="Payouts & Stripe Connect"
              body={
                <>
                  <p><strong className="text-foreground">Payout Schedule:</strong> Payouts are scheduled with a 24–48 hour delay after dual confirmation.</p>
                  <p><strong className="text-foreground">Stripe Connect:</strong> Helprs must link a Stripe Connect Express account before accepting offers or receiving payouts.</p>
                </>
              }
            />
          </Section>

          <Section
            icon={Crown}
            title="Subscription Tiers"
            subtitle="Basic, Pro, and Elite plans"
          >
            <RowItem
              icon={Crown}
              title="Tiers & Pricing"
              body={
                <>
                  <p><strong className="text-foreground">⭐ Basic:</strong> $5/mo or ~$50/yr.</p>
                  <p><strong className="text-foreground">🔥 Pro:</strong> $10/mo or ~$100/yr.</p>
                  <p><strong className="text-foreground">💎 Elite:</strong> $15/mo or ~$150/yr.</p>
                  <p>All tiers maintain the same 10% / 10% split fee. Annual plans save ~17%. Stripe handles billing automatically.</p>
                </>
              }
            />
          </Section>

          <Section
            icon={HeartPulse}
            title="Cancellation Policy"
            subtitle="Tiered fees once a helpr is selected"
            warning
          >
            <RowItem
              icon={Clock}
              warning
              title="Cancellation Fees"
              body={
                <>
                  <p><strong className="text-foreground">More than 24h before (or no helpr selected):</strong> <span className="text-primary font-semibold">Free</span></p>
                  <p><strong className="text-foreground">Less than 24h before:</strong> <span className="text-accent-foreground font-semibold">25% of job budget</span></p>
                  <p><strong className="text-foreground">Less than 2h before:</strong> <span className="text-destructive font-semibold">50% of job budget</span></p>
                  <p className="italic text-xs">Fees are paid to the assigned helpr (minus the 10% platform fee). Repeated post-selection cancellations: 1st–2nd warning, 3rd is a permanent ban.</p>
                </>
              }
            />
          </Section>

          <Section
            icon={Scale}
            title="Helpr Accountability"
            subtitle="Response times and new-account limits"
          >
            <RowItem
              icon={Clock}
              title="Response Deadlines"
              body={
                <p>Job offers include a <strong className="text-foreground">1–48 hour response deadline</strong>. Failing to respond or declining multiple offers triggers escalating penalties.</p>
              }
            />
            <RowItem
              icon={AlertTriangle}
              title="New Account Restrictions"
              body={
                <>
                  <p>New helpr accounts are limited to:</p>
                  <p>• Max <strong className="text-foreground">3 active jobs</strong> at a time</p>
                  <p>• Max <strong className="text-foreground">$100 in total earnings</strong></p>
                  <p>Lifted after <strong className="text-foreground">3 verified completions with a 4+ star rating</strong>.</p>
                </>
              }
            />
            <RowItem
              icon={FileText}
              title="Completion Requirements"
              body={
                <p>Helprs must upload before/after photos. A minimum <strong className="text-foreground">30-minute job duration</strong> is required before marking complete.</p>
              }
            />
          </Section>

          <Section
            icon={Siren}
            title="Trust &amp; Safety"
            subtitle="Verification, GPS, chat scanning, fraud"
            warning
          >
            <RowItem
              icon={Shield}
              title="Identity Verification"
              body={
                <p>All users must be <strong className="text-foreground">18+</strong>. Helprs undergo ID document verification before approval.</p>
              }
            />
            <RowItem
              icon={Shield}
              title="GPS Proximity"
              body={
                <p>Job check-ins require <strong className="text-foreground">GPS proximity within 500 feet</strong> of the job location.</p>
              }
            />
            <RowItem
              icon={Shield}
              title="Chat Safety"
              body={
                <p>In-app messages are scanned in real-time to detect <strong className="text-foreground">off-platform payment attempts</strong> (Venmo, CashApp, phone numbers, etc.).</p>
              }
            />
            <RowItem
              icon={AlertTriangle}
              warning
              title="Fraud Detection"
              body={
                <>
                  <p>The platform automatically flags:</p>
                  <p>• Job completions under 15 minutes</p>
                  <p>• Missing GPS check-ins</p>
                  <p>• Repeated disputes on a single account</p>
                </>
              }
            />
          </Section>

          <Section
            icon={Users}
            title="Community Guidelines"
            subtitle="How we expect everyone to behave"
          >
            <RowItem
              icon={Users}
              title="Core Expectations"
              body={
                <>
                  <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism.</p>
                  <p><strong className="text-foreground">Honesty:</strong> Provide accurate profile info and job descriptions.</p>
                  <p><strong className="text-foreground">Safety:</strong> Never share personal contact details outside in-app chat.</p>
                  <p><strong className="text-foreground">Timeliness:</strong> Show up on time and communicate promptly.</p>
                  <p><strong className="text-foreground">Quality:</strong> Complete tasks to the standard described and upload required photos.</p>
                  <p><strong className="text-foreground">On-Platform Only:</strong> All payments must go through Helpr.</p>
                  <p><strong className="text-foreground">Reporting:</strong> Report suspicious or unsafe behavior using the report feature.</p>
                </>
              }
            />
          </Section>

          <Section
            icon={AlertTriangle}
            title="Violations &amp; Enforcement"
            subtitle="Escalating actions for repeat offenses"
            warning
          >
            <RowItem
              icon={AlertTriangle}
              warning
              title="Enforcement Ladder"
              body={
                <>
                  <p><strong className="text-foreground">1st–2nd report:</strong> Warning notification.</p>
                  <p><strong className="text-foreground">3 reports:</strong> <span className="text-accent-foreground font-semibold">7-day temporary ban</span>.</p>
                  <p><strong className="text-foreground">4+ violations:</strong> <span className="text-destructive font-semibold">Permanent ban</span>.</p>
                  <p>Additional actions may include withholding payments, removing job listings, or reporting to law enforcement for illegal activity. Severe violations may skip the ladder entirely.</p>
                </>
              }
            />
          </Section>

          <Section
            icon={Receipt}
            title="Tax Responsibilities"
            subtitle="Platform, posters, and helprs"
          >
            <RowItem
              icon={Receipt}
              title="Platform (Helpr, LLC)"
              body={
                <p>Helpr issues <strong className="text-foreground">Form 1099-K</strong> when federal thresholds are met ($20,000 AND 200+ transactions for 2025). The 1099-NEC threshold rises to $2,000 on Jan 1, 2026. Once Helpr exceeds $100k in gross Louisiana revenue, we collect and remit state and parish sales tax. All Louisiana returns are filed electronically through the LDR portal.</p>
              }
            />
            <RowItem
              icon={Scale}
              title="Worker Classification"
              body={
                <p>Louisiana and the U.S. DOL use the <strong className="text-foreground">Economic Reality Test</strong>. Helprs qualify as independent contractors based on profit/loss opportunity, tool investment, gig-based scheduling, job control, segregable services, and pre-existing skills.</p>
              }
            />
            <RowItem
              icon={Users}
              title="Job Posters"
              body={
                <p>You pay the agreed job fee plus applicable sales tax. Workers are <strong className="text-foreground">independent contractors</strong> — no payroll, withholding, or employer tax obligations.</p>
              }
            />
            <RowItem
              icon={DollarSign}
              title="Helprs (Workers)"
              body={
                <p>You owe <strong className="text-foreground">self-employment tax (15.3%)</strong>, must report all income on state and federal returns, and may owe <strong className="text-foreground">quarterly estimated payments</strong>. You'll receive a 1099-K if federal thresholds are met.</p>
              }
            />
            <RowItem
              icon={Receipt}
              title="Louisiana Parish Sales Tax"
              body={
                <p>Parish rates vary by job location. Helpr applies the correct rate automatically.</p>
              }
            />
          </Section>

          <Section
            icon={Shield}
            title="Privacy Summary"
            subtitle="Data we collect, use, and share"
          >
            <RowItem
              icon={Shield}
              title="Data Practices"
              body={
                <>
                  <p><strong className="text-foreground">Collection:</strong> Name, email, phone, location, DOB, ID documents, and usage data.</p>
                  <p><strong className="text-foreground">Usage:</strong> Match you with tasks, process payments, verify identity, prevent fraud.</p>
                  <p><strong className="text-foreground">Sharing:</strong> First name, reviews, ratings shared with other users. Payments handled by Stripe. We never sell your data.</p>
                  <p><strong className="text-foreground">Retention:</strong> Retained while your account is active. Request deletion via support.</p>
                  <p>For full details, see our <Link to="/privacy" className="text-primary hover:underline font-medium">Privacy Policy</Link>.</p>
                </>
              }
            />
          </Section>

          <p className="text-[11px] text-muted-foreground text-center pt-2 pb-4">
            Questions about these terms? <Link to="/support" className="text-primary hover:underline">Contact support</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default TermsOfService;
