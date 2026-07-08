import { Link } from "react-router-dom";
import {
  Building2, Wallet, Crown, ShieldAlert, Receipt, FileText, Scale, AlertTriangle,
  DollarSign, Clock, ShieldCheck, Siren, Handshake, Users,
} from "lucide-react";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { BUSINESS_SEAT_TIERS, formatSeatPriceMonthly } from "@/lib/businessSeatTiers";
import {
  URGENT_FEE_FLOOR_DOLLARS,
  ONBOARDING_FEE_CENTS,
  formatDollarsWhole,
} from "@/lib/moneyLimits";
import { HideOnSearch, TldrCard, PolicyFooter } from "./LegalChrome";
import { legalFmtMo, LAST_UPDATED } from "./legalSections";

const ONBOARDING_FEE_DOLLARS = ONBOARDING_FEE_CENTS / 100;

/* ─────────────────────────────  TERMS  ───────────────────────────── */
export const TermsContent = () => (
  <div className="space-y-3">
    <TldrCard
      items={[
        "You must be 18+. All accounts are reviewed before approval.",
        "Helpr is a marketplace — we don't perform jobs ourselves and aren't liable for the work delivered.",
        `Both sides pay a plan-based platform fee: the poster pays a service fee added at checkout (${TIER_PERKS.free.platformFeePercent}% on Free down to ${TIER_PERKS.business.platformFeePercent}% on Business), and the Helpr's platform fee (${TIER_PERKS.business.platformFeePercent}–${TIER_PERKS.free.platformFeePercent}%, on the same ladder) is deducted from their payout. Each side's own plan determines their own %.`,
        "Cancellations, disputes, and behavior rules live in the Community Rules tab — they're part of this agreement.",
        "Helprs are independent contractors, not employees.",
        "You use Helpr at your own risk. We're the marketplace, not a party to any job — we're not liable for loss, theft, property damage, or injury, and you agree to indemnify us.",
      ]}
    />

    <PolicySection
      icon={Building2}
      title="Eligibility & accounts"
      subtitle="Who can use Helpr and how accounts work"
      anchorId="eligibility"
    >
      <PolicyRowItem
        icon={FileText}
        title="Eligibility"
        body={
          <>
            <p><strong className="text-foreground">18+ only.</strong> Age verification is mandatory at signup.</p>
            <p><strong className="text-foreground">Account responsibility:</strong> You are responsible for the security of your credentials and all activity under your account.</p>
            <p><strong className="text-foreground">Account approval:</strong> All new accounts are subject to review and remain pending until approved. Denied accounts receive an explanation and may reapply.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Scale}
        title="Binding job agreements"
        body={
          <>
            <p><strong className="text-foreground">Accepting a job or hiring a Helpr creates a binding commitment</strong> to complete the work as described and release payment on satisfactory completion.</p>
            <p>Cancellation, revision, and dispute resolution are governed by the <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules</Link>, which form part of this agreement.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Prohibited conduct & termination"
        body={
          <>
            <p><strong className="text-foreground">Prohibited:</strong> Illegal activities, harassment, fraud, discrimination, off-platform payment solicitation, or any conduct that violates the rights of others.</p>
            <p><strong className="text-foreground">Termination:</strong> Helpr reserves the right to suspend or terminate accounts at its sole discretion. Specific behavior, strike, and ban rules are detailed in the <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules</Link>.</p>
            <p><strong className="text-foreground">Intellectual property:</strong> All content, branding, and technology are owned by Helpr. No copying, modifying, or redistributing without permission.</p>
            <p><strong className="text-foreground">Liability:</strong> Helpr is a marketplace and is not responsible for the quality, safety, or legality of jobs performed.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Wallet}
      title="Payment, escrow & fees"
      subtitle="How money moves on the platform"
      anchorId="payment-escrow-fees"
    >
      <PolicyRowItem
        icon={DollarSign}
        title="Escrow & charge timing"
        body={
          <>
            <p><strong className="text-foreground">Charged upfront:</strong> Payments are processed via Stripe at booking and held in escrow until both parties confirm completion.</p>
            <p><strong className="text-foreground">Auto-release:</strong> If only one party confirms, the job auto-completes 48 hours later and payment releases to the Helpr (funds land about 72 hours after completion).</p>
            <p><strong className="text-foreground">Refunds:</strong> Refunds are evaluated case-by-case through the dispute process — see <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules → When something goes wrong</Link>.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Split fee model"
        body={
          <>
            <p><strong className="text-foreground">Poster service fee:</strong> added at checkout by your plan — {TIER_PERKS.free.platformFeePercent}% Free, {TIER_PERKS.pro.platformFeePercent}% Pro, {TIER_PERKS.elite.platformFeePercent}% Elite, {TIER_PERKS.business.platformFeePercent}% Business (minimum covers card processing on small jobs).</p>
            <p><strong className="text-foreground">Helpr platform fee:</strong> deducted from payout by plan — {TIER_PERKS.free.platformFeePercent}% Free, {TIER_PERKS.pro.platformFeePercent}% Helpr Pro, {TIER_PERKS.elite.platformFeePercent}% Helpr Elite, {TIER_PERKS.business.platformFeePercent}% Business.</p>
            <p><strong className="text-foreground">Total platform take:</strong> the poster's plan-based service fee plus the Helpr's plan-based fee.</p>
            <p><strong className="text-foreground">Urgent job fee:</strong> {formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)} minimum bonus that goes to the Helpr, added by the poster for priority placement.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Clock}
        title="Payouts & Stripe Connect"
        body={
          <>
            <p><strong className="text-foreground">Payout schedule:</strong> Payouts are scheduled with a 24–48 hour delay after dual confirmation.</p>
            <p><strong className="text-foreground">Stripe Connect:</strong> Helprs must link a Stripe Connect Express account before accepting offers or receiving payouts.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Receipt}
        title={`One-time $${ONBOARDING_FEE_DOLLARS.toFixed(0)} onboarding fee`}
        body={
          <>
            <p><strong className="text-foreground">Charged once per account.</strong> Whichever happens first — your first job post or your first payout — is when the {formatDollarsWhole(ONBOARDING_FEE_DOLLARS)} onboarding fee is collected.</p>
            <p><strong className="text-foreground">If you post first:</strong> the {formatDollarsWhole(ONBOARDING_FEE_DOLLARS)} is added as a line item at checkout the first time you post.</p>
            <p><strong className="text-foreground">If you only earn:</strong> the {formatDollarsWhole(ONBOARDING_FEE_DOLLARS)} is deducted from your first payout, automatically.</p>
            <p>You'll never be charged twice. Once paid, your account is set.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={ShieldCheck}
        title="Identity verification (one attempt)"
        body={
          <>
            <p><strong className="text-foreground">Stripe Identity is on us — once.</strong> Helpr covers the cost of one Stripe ID + selfie check per account.</p>
            <p><strong className="text-foreground">If your verification fails the first time</strong>, an admin will review your submitted ID manually within 24 hours. There is no self-service retry — please make sure your photos are clear, well-lit, and show all four corners of the ID before you submit.</p>
            <p>Once verified (auto or by admin), you're set for the life of your account.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Crown}
      title="Subscription tiers"
      subtitle="Free, Helpr Pro, Helpr Elite, and Business plans"
      anchorId="subscription-tiers"
    >
      <PolicyRowItem
        icon={Crown}
        title="Tiers & pricing"
        body={
          <>
            <p><strong className="text-foreground">Free:</strong> standard access at a {TIER_PERKS.free.platformFeePercent}% platform fee.</p>
            <p><strong className="text-foreground">{TIER_PERKS.pro.name}:</strong> {legalFmtMo(TIER_PERKS.pro.price)} — reduced {TIER_PERKS.pro.platformFeePercent}% platform fee.</p>
            <p><strong className="text-foreground">{TIER_PERKS.elite.name}:</strong> {legalFmtMo(TIER_PERKS.elite.price)} — lowest {TIER_PERKS.elite.platformFeePercent}% platform fee.</p>
            <p><strong className="text-foreground">{TIER_PERKS.business.name}:</strong> per-seat pricing ({BUSINESS_SEAT_TIERS.map((t) => `${t.name} ${formatSeatPriceMonthly(t.priceLabel)}`).join(" · ")}) — team tools and a {TIER_PERKS.business.platformFeePercent}% platform fee across all seat plans.</p>
            <p>Annual plans save about 2 months. Stripe handles billing automatically.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={ShieldAlert}
      title="Disclaimers & limitation of liability"
      subtitle="Helpr is the marketplace — not a party to your job"
      anchorId="liability"
    >
      <PolicyRowItem
        icon={ShieldAlert}
        title="Helpr is only the marketplace"
        body={
          <>
            <p><strong className="text-foreground">We connect people — we don't do the work.</strong> Helpr provides the platform that lets posters and Helprs find each other. We do not perform, supervise, direct, inspect, schedule, or control any job.</p>
            <p>Every job is a <strong className="text-foreground">direct agreement between the two users.</strong> Helpr is not a party to that agreement, is not your employer or agent, and does not act on your behalf.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="No liability for what happens during a job"
        body={
          <>
            <p><strong className="text-foreground">To the fullest extent permitted by law, Helpr is not responsible or liable</strong> for any loss, theft, or damage to property, or for any personal injury, illness, death, or other harm, arising out of or related to a job, a user's conduct, or anything that happens before, during, or after a job — whether at the job site or anywhere else.</p>
            <p>This includes the acts, omissions, honesty, qualifications, or safety of any other user. <strong className="text-foreground">You meet and deal with other users at your own risk.</strong></p>
          </>
        }
      />
      <PolicyRowItem
        icon={Scale}
        title={'Provided "as is" — no warranties'}
        body={
          <>
            <p><strong className="text-foreground">The platform and all services are provided "as is" and "as available,"</strong> without warranties of any kind, express or implied.</p>
            <p>We do not guarantee the quality, safety, legality, honesty, or qualifications of any user, job, listing, or outcome, and we do not guarantee that any verification, rating, or background information is accurate or complete.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Handshake}
        title="You assume the risk & release Helpr"
        body={
          <>
            <p><strong className="text-foreground">You are solely responsible</strong> for vetting the people you hire or work for, for your own safety, and for your belongings and property.</p>
            <p>You release Helpr, its owners, and its staff from any and all claims, demands, and damages arising from your use of the platform or your dealings with other users.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Siren}
        title="Limitation of liability"
        body={
          <>
            <p>To the maximum extent allowed by law, <strong className="text-foreground">Helpr's total liability for any claim is limited to the greater of the platform fees you paid us on the transaction at issue, or $100.</strong></p>
            <p>Helpr is never liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits or lost data — even if we were advised such damages were possible.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={ShieldCheck}
        title="Indemnification"
        body={
          <p>You agree to <strong className="text-foreground">defend, indemnify, and hold Helpr harmless</strong> from any claims, losses, liabilities, and expenses (including reasonable attorneys' fees) arising from your jobs, your conduct, your content, your violation of these Terms, or your violation of any law or the rights of another person.</p>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="No insurance; disputes between users"
        body={
          <>
            <p><strong className="text-foreground">Helpr does not provide insurance</strong> for posters or Helprs. Any protection or guarantee program we may offer is governed by its own separate terms.</p>
            <p>Disputes between users are handled through the dispute process in the <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules</Link>. Helpr's role is limited to facilitating that process and is not a guarantor of any outcome.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Receipt}
      title="Tax responsibilities"
      subtitle="Platform, posters, and Helprs"
      anchorId="tax-responsibilities"
    >
      <PolicyRowItem
        icon={Receipt}
        title="Platform (Helpr, LLC)"
        body={
          <p>Helpr issues <strong className="text-foreground">Form 1099-K</strong> when federal thresholds are met ($20,000 AND 200+ transactions for 2025). The 1099-NEC threshold rises to $2,000 on Jan 1, 2026. Once Helpr exceeds $100k in gross Louisiana revenue, we collect and remit state and parish sales tax. All Louisiana returns are filed electronically through the LDR portal.</p>
        }
      />
      <PolicyRowItem
        icon={Scale}
        title="Worker classification"
        body={
          <p>Louisiana and the U.S. DOL use the <strong className="text-foreground">Economic Reality Test</strong>. Helprs qualify as independent contractors based on profit/loss opportunity, tool investment, gig-based scheduling, job control, segregable services, and pre-existing skills.</p>
        }
      />
      <PolicyRowItem
        icon={Users}
        title="Job posters"
        body={
          <p>You pay the agreed job fee plus applicable sales tax. Workers are <strong className="text-foreground">independent contractors</strong> — no payroll, withholding, or employer tax obligations.</p>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Helprs (workers)"
        body={
          <p>You owe <strong className="text-foreground">self-employment tax (15.3%)</strong>, must report all income on state and federal returns, and may owe <strong className="text-foreground">quarterly estimated payments</strong>. You'll receive a 1099-K if federal thresholds are met.</p>
        }
      />
      <PolicyRowItem
        icon={Receipt}
        title="Louisiana parish sales tax"
        body={<p>Parish rates vary by job location. Helpr applies the correct rate automatically.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="General guidance only"
        body={<p>Tax laws change frequently. Consult a CPA for advice specific to your situation.</p>}
      />
    </PolicySection>

    <HideOnSearch>
      <PolicyFooter updated={LAST_UPDATED.terms} />
    </HideOnSearch>
  </div>
);
