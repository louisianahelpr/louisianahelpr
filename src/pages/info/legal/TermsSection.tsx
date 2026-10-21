import { Link } from "react-router-dom";
import {
  Building2, Wallet, Crown, ShieldAlert, Receipt, FileText, Scale, AlertTriangle,
  DollarSign, Clock, ShieldCheck, Siren, Handshake, Users, Camera,
} from "lucide-react";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
import { HELPR_FLAT_FEE_PHRASE } from "@/lib/helprFlatFee";
import { jobFeeModelFor, serviceFeeCentsFor } from "@/lib/jobCheckout";
import { SHARE_JOB_PHOTOS_LABEL } from "@/lib/jobPhotosConsent";
import {
  URGENT_FEE_FLOOR_DOLLARS,
  FORM_1099K_TRANSACTION_THRESHOLD,
  form1099kGrossLabel,
  formatDollarsWhole,
} from "@/lib/moneyLimits";
import { HideOnSearch, TldrCard, PolicyFooter } from "./LegalChrome";
import { useOnboardingFeeCents, formatFeeLabel } from "@/hooks/useOnboardingFee";
import { LAST_UPDATED } from "./legalSections";
// The auto-release window and the total time-to-funds are the platform's
// binding promises about when money moves; derive them from the same config
// the cron enforces rather than restating "48"/"72" as prose literals.
import {
  COPY_AUTO_RELEASE_HOURS,
  STANDARD_PAYOUT_PHRASE,
  TOTAL_TO_PAYOUT_HOURS,
} from "../../../../supabase/functions/_shared/escrowTiming";

/**
 * THE POSTER PAYS NOTHING ON TOP (owner 2026-10-20: the Terms describe the
 * current flat model). Read from the checkout's own fee functions at the
 * DEFAULT switch state (jobs_poster_fee off): if that ever charges a poster
 * fee, this sentence stops claiming none (termsPosterPaysNothing guards it).
 * If jobs_poster_fee is switched on for everyone, the Terms must change first
 * (Q2264): the fallback below is a guard, not a complete Terms text (the Helpr
 * fee lines would also be wrong on the poster-fee model).
 */
const POSTER_FEE_ON_DEFAULT_CENTS = serviceFeeCentsFor(jobFeeModelFor({ switchOn: false }), 10_000, false);
const POSTER_PAYS_SENTENCE =
  POSTER_FEE_ON_DEFAULT_CENTS === 0
    ? "Posting a job has no fee: the poster pays the job price (and any urgent bonus they add) and nothing on top, apart from sales tax where it applies and the one-time account setup fee."
    : "The poster pays the job price plus the service fee shown at checkout, before they pay.";



/* ─────────────────────────────  TERMS  ───────────────────────────── */
export const TermsContent = () => {
  // The setup fee is quoted from platform_settings — the number the platform
  // actually charges — never from a code constant; see useOnboardingFeeCents
  // for why. It is also the "account setup fee" everywhere a member meets it
  // (checkout, the IDV prompt, the profile row); these Terms were the one
  // surface still calling it an "onboarding fee". Null while loading or on
  // failure, in which case the row simply does not quote a number.
  const feeLabel = formatFeeLabel(useOnboardingFeeCents());
  return (
  <div className="space-y-3">
    <TldrCard
      items={[
        "You must be 18+. Every account verifies its email address before it can post or take jobs.",
        "Helpr is a marketplace — we don't perform jobs ourselves and aren't liable for the work delivered.",
        `${POSTER_PAYS_SENTENCE} The Helpr's fee (${HELPR_FLAT_FEE_PHRASE} of their pay, the same on every plan, and it covers card processing) is deducted from their payout.`,
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
            <p><strong className="text-foreground">Email verification:</strong> You must verify your email address to use your account. We may suspend or close an account that breaks these Terms or our Community Rules.</p>
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
        title="Payment hold & charge timing"
        body={
          <>
            <p><strong className="text-foreground">Charged upfront:</strong> Payments are processed via Stripe at booking and held securely (in escrow) until both parties confirm completion.</p>
            <p><strong className="text-foreground">Auto-release:</strong> If only one party confirms, the job auto-completes {COPY_AUTO_RELEASE_HOURS} hours later and payment releases to the Helpr (funds land about {TOTAL_TO_PAYOUT_HOURS} hours after completion).</p>
            <p><strong className="text-foreground">Refunds:</strong> Refunds are evaluated case-by-case through the dispute process — see <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules → When something goes wrong</Link>.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Fee model"
        body={
          <>
            <p><strong className="text-foreground">Posting a job:</strong> {POSTER_PAYS_SENTENCE}</p>
            <p><strong className="text-foreground">Helpr fee:</strong> {HELPR_FLAT_FEE_PHRASE} of each Helpr's pay, deducted from the payout, the same on every plan; it covers card processing. A job paid for before October 15, 2026 keeps the fee it was paid under. Every payout to a Helpr, for a job or a delivery, is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over. Tips are paid in full, and a card fee you owe for a refund you were at fault for comes off after the rounding, to the cent.</p>
            {/* Owner 2026-10-21: keep the one-time setup fee and disclose it here, in the
                fee list. Quoted from platform_settings via feeLabel (the number
                release-payout takes), never a literal (termsStripe1099AndSetupFee). */}
            <p><strong className="text-foreground">One-time account setup fee:</strong> {feeLabel ? `${feeLabel}, ` : ""}once per account. A Helpr pays it out of their first payout; if you post a job before your first payout, it is added at that checkout instead. It is never charged twice.</p>
            <p><strong className="text-foreground">Total platform take:</strong> the one-time account setup fee and the Helpr fee above.</p>
            <p><strong className="text-foreground">Urgent job fee:</strong> {formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)} minimum bonus, added by the poster for priority placement. It is part of the job price the poster pays and goes to the Helpr (split among the crew on a group job), with the Helpr fee above taken from each Helpr's share of the job price, bonus included.</p>
            {/* Job Boost and Tipping moved here verbatim from the Profile → Legal
                tab's "Platform Fees" row, which was a paraphrase of this section.
                They were the only two fee statements that lived ONLY there, so
                they were promoted into the canonical Terms rather than dropped. */}
            <p><strong className="text-foreground">Job boost:</strong> Optional paid boost to increase visibility of your listing.</p>
            <p><strong className="text-foreground">Tipping:</strong> 100% of tips go to the Helpr — no platform fee on tips. The card-processing fee on a tip is paid by the person tipping, added on top of the tip and shown before they pay; it is never taken from the Helpr's tip.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Clock}
        title="Payouts & Stripe Connect"
        body={
          <>
            <p><strong className="text-foreground">Payout schedule:</strong> Standard payouts are sent {STANDARD_PAYOUT_PHRASE}.</p>
            <p><strong className="text-foreground">Stripe Connect:</strong> Helprs must link a Stripe Connect Express account before accepting offers or receiving payouts.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Receipt}
        title={feeLabel ? `One-time ${feeLabel} account setup fee` : "One-time account setup fee"}
        body={
          <>
            <p><strong className="text-foreground">Charged once per account.</strong> Whichever happens first, your first job post or your first payout, is when the {feeLabel ? `${feeLabel} ` : ""}account setup fee is collected.</p>
            <p><strong className="text-foreground">If you post first:</strong> the fee is added as a line item at checkout the first time you post.</p>
            <p><strong className="text-foreground">If you only earn:</strong> the fee is deducted from your first payout, automatically.</p>
            <p>You'll never be charged twice. Once paid, your account is set.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={ShieldCheck}
        title="Identity verification"
        body={
          <>
            <p><strong className="text-foreground">Stripe Identity verifies a photo ID and a selfie before a member's first accepted or posted job</strong>, and before a Helpr heads out to a job. Helpr pays for this check; there is no charge to you. Payout setup is separate: when you set up payouts, Stripe verifies your payment details.</p>
            <p><strong className="text-foreground">If Stripe can't confirm your ID automatically</strong>, our team reviews it by hand, usually within 24 hours. There is no self-service retry, so make sure your photos are clear, well lit, and show all four corners of the ID.</p>
            <p>Once verified (by Stripe or by our team), you're set for the life of your account.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Crown}
      title="Memberships"
      subtitle="No paid memberships right now"
      anchorId="subscription-tiers"
    >
      <PolicyRowItem
        icon={Crown}
        title="No paid memberships"
        body={
          <>
            <p>There are no paid memberships right now. Joining Helpr is free.</p>
            <p>No plan changes the fee on a job: every job carries the same {HELPR_FLAT_FEE_PHRASE} Helpr fee.</p>
          </>
        }
      />
    </PolicySection>

    {/* Owner 2026-10-20: job photos on social media, with an opt-out (profiles.share_job_photos,
        job_photos_shareable). The setting is named by its exact label (termsJobPhotosClause). */}
    <PolicySection
      icon={Camera}
      title="Photos from jobs"
      subtitle="Before and after photos on our website, social media and ads"
      anchorId="photos-from-jobs"
    >
      <PolicyRowItem
        icon={Camera}
        title="How we may use them, and how to say no"
        body={
          <>
            <p data-terms-job-photos>
              When you upload before and after photos for a job, you give Louisiana Helpr permission to use them to show
              what Helprs do: on our website, on social media and in ads, for free and without paying you, for as long as
              Helpr runs. We crop or blur faces, house numbers, street signs, license plates and anything else that shows
              where you live, and we never name you or your Helpr without asking first.
            </p>
            <p>A job&apos;s photos are only used when BOTH the poster and the Helpr allow it.</p>
            <p>
              Don&apos;t want your photos used? Turn off &ldquo;{SHARE_JOB_PHOTOS_LABEL}&rdquo; in{" "}
              <Link to="/profile?tab=settings" className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>Settings</Link>.
              It stops future posts; it can&apos;t pull posts already shared.
            </p>
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
          <p>Stripe issues <strong className="text-foreground">Form 1099-K</strong> when federal thresholds are met — {form1099kGrossLabel()} AND {FORM_1099K_TRANSACTION_THRESHOLD}+ transactions, for 2025 and later. (The One Big Beautiful Bill repealed the planned $2,500 and $600 step-downs, so this threshold does not drop in 2026.) The 1099-NEC threshold rises to $2,000 on Jan 1, 2026. Once Helpr exceeds $100k in gross Louisiana revenue, we collect and remit state and parish sales tax. All Louisiana returns are filed electronically through the LDR portal.</p>
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
          <p>You pay the agreed job price plus any applicable sales tax (and, on your first paid job, the one-time account setup fee). Louisiana taxes only enumerated services (LA R.S. 47:301(14)), so most jobs carry no sales tax at all; where it does apply it is charged on the labor line only, never on Helpr's fees. Workers are <strong className="text-foreground">independent contractors</strong> — no payroll, withholding, or employer tax obligations.</p>
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
};
