import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { Link } from "react-router-dom";
import {
  Building2, Wallet, Crown, ShieldAlert, Receipt, FileText, Scale, AlertTriangle,
  DollarSign, Clock, ShieldCheck, Siren, Handshake, Users, Camera, Sofa, Truck, Star, Ban, MessageSquareText,
} from "lucide-react";
import { PolicyRowItem, PolicySection } from "@/components/policy/CollapsedPolicy";
import { jobFeeModelFor, serviceFeeCentsFor } from "@/lib/jobCheckout";
import { SHARE_JOB_PHOTOS_LABEL } from "@/lib/jobPhotosConsent";
import { URGENT_FEE_FLOOR_DOLLARS, FORM_1099K_TRANSACTION_THRESHOLD, form1099kGrossLabel, formatDollarsWhole } from "@/lib/moneyLimits";
import { GUARANTEE_RULES } from "@/lib/guarantee/rules";
import { HideOnSearch, TldrCard, PolicyFooter, TaxGuidanceLine } from "./LegalChrome";
import { useOnboardingFeeCents, formatFeeLabel } from "@/hooks/useOnboardingFee";
import { LAST_UPDATED } from "./legalSections";
// The approval window and the payout schedule are the platform's binding
// promises about when money moves; derive them from the same config the cron
// enforces rather than restating "24"/"3 days" as prose literals. Owner
// 2026-10-23: nothing is paid without the poster's approval.
import {
  APPROVAL_WINDOW_HOURS,
  STANDARD_PAYOUT_PHRASE,
} from "../../../../supabase/functions/_shared/escrowTiming";

/**
 * THE POSTER PAYS NOTHING ON TOP (owner 2026-10-20: the Terms describe the
 * current flat model). It said "Posting a job has no fee" and then named the
 * setup fee charged at a first post (platform_settings.onboarding_fee_cents =
 * 200, prod 2026-10-25): a "no fee" claim beside a fee that is charged is a
 * misleading representation (FTC Act s.5, 15 U.S.C. 45(a); Louisiana Unfair
 * Trade Practices Act, La. R.S. 51:1405), so it now says "no per-job posting
 * fee" and when the setup fee applies. Read from the checkout's own fee functions at the
 * DEFAULT switch state (jobs_poster_fee off): if that ever charges a poster
 * fee, this sentence stops claiming none (termsPosterPaysNothing guards it).
 * If jobs_poster_fee is switched on for everyone, the Terms must change first
 * (Q2264): the fallback below is a guard, not a complete Terms text (the Helpr
 * fee lines would also be wrong on the poster-fee model).
 */
const POSTER_FEE_ON_DEFAULT_CENTS = serviceFeeCentsFor(jobFeeModelFor({ switchOn: false }), 10_000, false);
const POSTER_PAYS_SENTENCE =
  POSTER_FEE_ON_DEFAULT_CENTS === 0
    ? "There is no per-job posting fee: the poster pays the job price (and any urgent bonus they add) and nothing on top, apart from sales tax where it applies and, once per account, the one-time account setup fee below."
    : "The poster pays the job price plus the service fee shown at checkout, before they pay.";



/* ─────────────────────────────  TERMS  ───────────────────────────── */
export const TermsContent = () => {
  // ID verification is off (switch `identity_check`, owner 2026-10-23): the
  // Terms say so instead of promising a check nobody runs.
  const idOn = useIdentityCheckOnStore();
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
        `${POSTER_PAYS_SENTENCE} Louisiana Helpr keeps a service fee from each Helpr payout; a Helpr always sees what they will take home before they apply.`,
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
            <p><strong className="text-foreground">18+ only.</strong> By agreeing to these Terms when you sign up, you confirm you are 18 or older.</p>
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
            <p><strong className="text-foreground">Zero tolerance for objectionable content:</strong> Helpr has zero tolerance for objectionable content or abusive users. Messages with hateful, sexual or threatening language are hidden from the other person automatically, and any member can report or block another member from their profile or a conversation. Louisiana Helpr reviews every report and removes the content and the account that posted it when the report holds up.</p>
            <p><strong className="text-foreground">Termination:</strong> Helpr reserves the right to suspend or terminate accounts at its sole discretion. Specific behavior, strike, and ban rules are detailed in the <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules</Link>.</p>
            <p><strong className="text-foreground">Intellectual property:</strong> All content, branding, and technology are owned by Helpr. No copying, modifying, or redistributing without permission.</p>
            <p><strong className="text-foreground">Liability:</strong> Helpr is a marketplace and is not responsible for the quality, safety, or legality of jobs performed.</p>
          </>
        }
      />
      {/* Owner-approved wording, 2026-10-20 (SMS alerts; Twilio toll-free verification). 2026-10-23: Twilio's A2P
          campaign review needs a section titled "SMS Terms", the brand name Louisiana Helpr and "Message and data
          rates may apply". Guard: src/test/smsLegalCopyForTwilio.test.ts. */}
      <PolicyRowItem
        icon={MessageSquareText}
        title="SMS Terms"
        body={<p>Louisiana Helpr text alerts are optional. Message frequency varies. Message and data rates may apply. Reply STOP to cancel or HELP for help, or contact admin@louisianahelpr.com (our support inbox). Carriers are not liable for delayed or undelivered messages.</p>}
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
            <p><strong className="text-foreground">Held, then charged:</strong> A card is held or saved when the job is posted and charged through Stripe when a Helpr accepts the offer; a bank payment or gift is paid when the job is posted. Louisiana Helpr holds that money until the person who posted the job approves the work.</p>
            <p><strong className="text-foreground">No release without approval:</strong> Payment is never released on a timer. If the person who posted has not approved the work or asked for a change within {APPROVAL_WINDOW_HOURS} hours of the Helpr marking it done, Helpr support steps in to resolve it, and the payment stays held until then. Once the job is approved, the Helpr's payout is sent {STANDARD_PAYOUT_PHRASE}.</p>
            <p><strong className="text-foreground">Refunds:</strong> Refunds are evaluated case-by-case through the dispute process — see <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules → When something goes wrong</Link>.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Helpr Guarantee"
        body={
          <>
            <p><strong className="text-foreground">Redo first:</strong> If a one-Helpr job wasn&apos;t done right, the person who posted it can say so in the app within 48 hours of the job being done, with a note and photos, while the Helpr&apos;s pay has not been sent. The Helpr has 48 hours to pick a day to fix it (within 3 days) or say they can&apos;t. The Helpr&apos;s pay for that job is held while the request is open.</p>
            <p><strong className="text-foreground">Then settled:</strong> When the Helpr marks it fixed, the person who posted has {GUARANTEE_RULES.posterAnswerHours} hours to confirm; no answer counts as fixed, and the Helpr is paid on the usual schedule. If the Helpr can&apos;t fix it, doesn&apos;t answer, doesn&apos;t fix it by the day after the day they picked, or the fix doesn&apos;t solve it, it becomes a dispute that Helpr decides.</p>
            <p><strong className="text-foreground">Refunds:</strong> A refund under the Helpr Guarantee is of the job price only; fees are not refunded. The guarantee can be used once per job.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Fee model"
        body={
          <>
            <p><strong className="text-foreground">Posting a job:</strong> {POSTER_PAYS_SENTENCE}</p>
            <p><strong className="text-foreground">Service fee:</strong> Louisiana Helpr keeps a service fee from each Helpr's pay, deducted from the payout; it covers card processing. Every job shows the Helpr the amount they will take home before they apply, and a job keeps the fee in force when it was paid for. Every payout to a Helpr, for a job or a delivery, is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over. Tips are paid in full, and a card fee you owe for a refund you were at fault for comes off after the rounding, to the cent.</p>
            {/* Owner 2026-10-21: keep the one-time setup fee and disclose it here, in the
                fee list. Quoted from platform_settings via feeLabel (the number
                release-payout takes), never a literal (termsStripe1099AndSetupFee). */}
            <p><strong className="text-foreground">One-time account setup fee:</strong> {feeLabel ? `${feeLabel}, ` : ""}once per account. {idOn
              ? "A Helpr or a Declutter seller pays it out of their first payout; if you post a job, buy on Declutter or claim a free item on Declutter before your first payout, it is charged then instead. It is never charged twice."
              : "A Helpr pays it out of their first payout; if you post a job, buy on Declutter or list on Declutter before your first payout, it is charged then instead. It is never charged twice."}</p>
            <p><strong className="text-foreground">Total platform take:</strong> the one-time account setup fee and the service fee above.</p>
            <p><strong className="text-foreground">Urgent job fee:</strong> {formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)} minimum bonus, added by the poster for priority placement. It is part of the job price the poster pays and goes to the Helpr (split among the crew on a group job), with the service fee above taken from each Helpr's share of the job price, bonus included.</p>
            {/* Job Boost and Tipping moved here verbatim from the Profile → Legal
                tab's "Platform Fees" row, which was a paraphrase of this section.
                They were the only two fee statements that lived ONLY there, so
                they were promoted into the canonical Terms rather than dropped. */}
            <p><strong className="text-foreground">Job boost:</strong> Optional paid boost to increase visibility of your listing.</p>
            <p><strong className="text-foreground">Tipping:</strong> 100% of tips go to the Helpr. The person tipping sees the total they pay before they pay; nothing is taken from the Helpr's tip.</p>
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
            <p><strong className="text-foreground">Charged once per account.</strong> Whichever happens first, your first job post, your first payout, or your first Declutter {idOn ? "purchase or free claim" : "purchase or listing"}, is when the {feeLabel ? `${feeLabel} ` : ""}account setup fee is collected.</p>
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
          idOn ? <>
            <p><strong className="text-foreground">We ask for a photo ID and a selfie through Stripe Identity once per person:</strong> when you post a job; when you're hired, and before you head out; or before your first payout. On Declutter, when you list, at your first purchase, or when you take a delivery. It counts everywhere on Louisiana Helpr. We never ask at sign-up or when you apply. Until it's done, your pay waits safely. The one-time {feeLabel ? `${feeLabel} ` : ""}setup fee covers this check. Payout setup is separate: when you set up payouts, Stripe verifies your payment details.</p>
            <p><strong className="text-foreground">If Stripe can't confirm your ID automatically</strong>, our team reviews it by hand, usually within 24 hours. There is no self-service retry, so make sure your photos are clear, well lit, and show all four corners of the ID.</p>
            <p>Once verified (by Stripe or by our team), you're set for the life of your account.</p>
          </> : <>
            <p><strong className="text-foreground">Helpr does not check members&apos; IDs right now.</strong> No photo ID is asked for to post, accept or start a job, or to buy or sell on Declutter, and no member is shown as ID-verified unless their ID was checked earlier. We will update these Terms before an ID check starts again. Payout setup is separate: when you set up payouts, our payments partner verifies your payment details.</p>
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
            <p>No plan changes the fee on a job: every Helpr pays the same service fee.</p>
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

    {/* Q2308 (owner approved the content 2026-10-22; docs/specs/declutter-terms-draft.md is the source and
        src/test/termsDeclutterSection.test.ts pins its numbers to the code). No terms-version bump (owner #14). */}
    <PolicySection
      icon={Sofa}
      title="Declutter"
      subtitle="Buying and selling used household items"
      anchorId="declutter"
    >
      <PolicyRowItem
        icon={Sofa}
        title="What Declutter is"
        body={
          <>
            <p>These Declutter terms are part of these Terms. Everything else in the Terms, the Community Rules and the Privacy policy still applies in Declutter; where this section is more specific, it wins for Declutter.</p>
            <p>Declutter is where members sell their own used household items to other members. Each item has a price set by the seller. A buyer can buy it at that price or send the seller a private offer, and the seller decides.</p>
            <p><strong className="text-foreground">Declutter is not an auction.</strong> There is no bidding, no countdown and no &ldquo;highest bid wins&rdquo;. An item sells to the first buyer whose purchase or offer is accepted and who then pays.</p>
            <p>You can get an item four ways: <strong className="text-foreground">porch pickup</strong> (the default: the seller leaves it on a porch or another safe place), <strong className="text-foreground">pickup at the seller&apos;s door</strong> (for items the seller doesn&apos;t leave out), <strong className="text-foreground">Helpr delivery</strong>, or <strong className="text-foreground">seller delivery</strong> when the seller offers it. Shipping is not offered.</p>
            <p><strong className="text-foreground">Free items.</strong> A seller can give an item away free. You ask for a free item with &ldquo;Ask for it&rdquo;; it is never bought or offered on, and nothing is charged to either of you: listing, asking for or receiving a free item never charges the one-time account setup fee. The seller picks who gets it from the people who asked. If you are picked, you have 48 hours to choose porch pickup or pickup at the seller&apos;s door; if you don&apos;t choose in time, the item goes back up and you get no strike. Delivery is not offered for free items. You can ask for or hold up to 3 free items at a time. The usual strike rules apply if you don&apos;t show up for a pickup, and a missed free pickup also pauses asking for free items for 30 days.</p>
            <p>Louisiana Helpr is the place where the sale happens. We are not the seller.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Users}
        title="Who can buy and sell"
        body={
          <>
            <p><strong className="text-foreground">18 or older.</strong> Members under 18 can&apos;t buy, make offers, post Wanted requests, deliver or sell.</p>
            <p><strong className="text-foreground">In good standing:</strong> signed in, not banned, and with fewer than 3 active Declutter strikes.</p>
            <p><strong className="text-foreground">Items in Louisiana.</strong> Items and pickups are in Louisiana. Buyers may live anywhere.</p>
            <p>Sellers can list without setting up payouts. A seller sets up payouts with Stripe at their first paid sale, and the sale money is held until that setup is finished. Buyers save a card before making an offer or buying.</p>
            {idOn && <p><strong className="text-foreground">Verify your ID once.</strong> Before your first Declutter purchase or your first listing, you verify your ID with Stripe Identity (a photo ID and a selfie). You do it once for all of Louisiana Helpr: if you already did it for Jobs, you don&apos;t do it again.</p>}
            <p>The one-time account setup fee is charged once per account, whichever comes first: your first Jobs payout, or your first Declutter purchase or listing.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={FileText}
        title="Listing an item"
        body={
          <>
            <p><strong className="text-foreground">Only your own personal things.</strong> When you list, you confirm that you bought the item for your own personal or household use, that you&apos;re not in the business of selling items like it, that you don&apos;t sell things often, and that you&apos;ll keep the item until you hand it over. We keep your answers.</p>
            <p><strong className="text-foreground">Photos:</strong> at least 1 and at most 12 photos you took of the actual item. The app removes location data from them.</p>
            <p><strong className="text-foreground">Be honest.</strong> The title, description, category, size and condition must describe the item accurately, including any damage or missing parts. The app can draft these from your photos; you must read and correct the draft, and you are responsible for every word of your listing.</p>
            <p><strong className="text-foreground">Review:</strong> a listing goes live when you post it. One our automatic check flags, or can&apos;t finish checking, waits for a Louisiana Helpr admin first. We may remove any listing that breaks these terms.</p>
            <p><strong className="text-foreground">Price:</strong> from $1 to $1,000 per item, plus a private lowest price you&apos;ll accept. Set the lowest price equal to the price if you don&apos;t want it to drop.</p>
            <p><strong className="text-foreground">Location and times:</strong> your pickup address stays private; buyers see an area name (it can&apos;t contain your house number or street address). You set your usual weekly pickup times.</p>
            <p><strong className="text-foreground">Porch or door:</strong> porch pickup is on for every item unless you turn it off when you list. It can&apos;t be changed after the item is listed.</p>
            <p><strong className="text-foreground">Managing a listing:</strong> while it&apos;s for sale you can change its price or lowest price (never above the price it was first listed at), stop or restart the evening price drops, pause it (hidden from buyers, open offers close, nothing is charged) and relist it.</p>
            <p><strong className="text-foreground">Taking it down</strong> is free any time before an offer is accepted or someone buys it; open offers close and those buyers are told. Backing out after you&apos;ve accepted is a strike.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="What you can't sell"
        body={
          <p>Weapons, ammunition and knives made as weapons; alcohol; prescription and illegal drugs; vapes; any recalled product; cribs made before mid-2011; used car seats; counterfeits; adult items; live animals; vehicles and boats; real estate. The app checks listings for these, and flagged listings wait for an admin.</p>
        }
      />
      <PolicyRowItem
        icon={Handshake}
        title="Offers and price drops"
        body={
          <>
            <p><strong className="text-foreground">Offers:</strong> at least half of today&apos;s price (and at least $1). The side whose turn it is has 48 hours to accept, say no or answer with another price; each answer restarts the 48 hours. If nobody answers, the offer expires with no strike. You can take an offer back before it&apos;s accepted.</p>
            <p>One open offer per item, and at most 3 new offers on the same item in 24 hours. The first offer accepted gets the item; every other open offer closes and nobody is charged. If an offer is accepted, you pay the accepted amount or today&apos;s price, whichever is lower.</p>
            <p><strong className="text-foreground">Evening price drops:</strong> every evening the price of each unsold item drops 5%, at most once a day, and stops a little above the seller&apos;s private lowest price at a point chosen at random. Open offers keep their amounts.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Wallet}
        title="Checkout and what buyers pay"
        body={
          <>
            <p><strong className="text-foreground">48 hours to check out.</strong> After you buy, or your offer is accepted, the item is reserved for you and you have 48 hours to check out and pay. We remind you 24 hours and 2 hours before. Missing the deadline on an accepted offer is 1 Declutter strike, and the item goes back on sale. If you tapped Buy now and don&apos;t pay, the item just goes back on sale, with no strike.</p>
            <p>Your saved card is charged only when you check out and pay, or automatically in a part of Louisiana Helpr where you turned on automatic charges.</p>
            <p><strong className="text-foreground">What you pay:</strong> the item price plus a buyer&apos;s fee, once per checkout, which covers running Declutter and card processing. You see one total before you pay, delivery included.</p>
            <p>Items from the same seller go into one checkout: one payment, one pickup or delivery.</p>
            <p><strong className="text-foreground">Sellers pay no fee</strong> and receive the whole item price, less anything they owe from a sale they cancelled. We hold the payment through Stripe until the sale is final.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Clock}
        title="Pickup and handover"
        body={
          <>
            <p>Every pickup and delivery happens within 7 days of paying. Before you pay you see only the seller&apos;s area and the distance; right after you pay you get the exact address. If the pickup time passes and 7 days go by with nothing said, the address closes; your messages stay open.</p>
            <p><strong className="text-foreground">Pickup:</strong> you book a 30-minute slot in the seller&apos;s pickup times. Each of you may move it once.</p>
            <p><strong className="text-foreground">Porch pickup:</strong> the seller sets the item out, posts a photo and may add a short note on where it is. You collect it and tap &ldquo;I got it&rdquo;, or take a photo and tap &ldquo;Picked up&rdquo;. If you haven&apos;t collected it by the time the seller said it stays out, the seller may bring it in, and it counts as you not showing up.</p>
            <p><strong className="text-foreground">At the door:</strong> you tap &ldquo;I got it&rdquo;, or the seller taps &ldquo;Picked up&rdquo;. After a seller&apos;s &ldquo;Picked up&rdquo; we ask you to confirm; if you don&apos;t answer, the seller is paid about 48 hours later unless you report a problem.</p>
            <p>If nobody confirms a pickup at the door or a meeting spot, the money stays held until one of you does. We remind you both, and after 60 days Louisiana Helpr decides. A porch pickup counts as done 24 hours after the later of the pickup time and the seller&apos;s set-out photo, unless a problem was reported.</p>
            <p><strong className="text-foreground">Someone didn&apos;t show:</strong> 15 minutes after the booked time the waiting side can say so. If the buyer says the seller didn&apos;t show, or that a seller delivery didn&apos;t come, the seller has 24 hours to answer: with no answer the buyer is refunded and the seller gets a strike; with an answer the money stays held and Louisiana Helpr decides, and nobody gets a strike until then. A buyer who misses a pickup may rebook once; a second miss cancels the sale.</p>
            <p><strong className="text-foreground">Report a problem:</strong> either of you can report a problem until the sale is final. The money stays held while Louisiana Helpr looks at both sides&apos; photos and messages and decides.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Truck}
        title="Helpr delivery"
        body={
          <>
            <p><strong className="text-foreground">Price:</strong> $10, plus $2 for each road mile, plus $20 for each large item and $40 for each extra-large item. Road miles are estimated from the straight-line distance (times 1.3, rounded up, at least 1 mile). There is no distance limit. Delivery is offered when every item is at one pickup address.</p>
            <p>A Helpr takes the delivery, picks the pickup time within the seller&apos;s times and the 7 days, takes a photo at pickup and leaves the item at your door with a photo. Then you tap &ldquo;I got it&rdquo;, or it counts as done 24 hours after the drop-off.</p>
            <p><strong className="text-foreground">No Helpr in 48 hours:</strong> everything you paid for delivery comes back to you. Then you pick it up at the seller&apos;s door, or cancel the sale for a refund. Buying shows how much comes back before you choose.</p>
            <p><strong className="text-foreground">Raising the pay:</strong> while you wait, you may raise the delivery pay, at least $5 at a time in whole dollars, at most $150 in total for one delivery, and not in the last hour of the 48 hours. You see what the raise costs before you pay, and the Helpr gets the whole raise. A refunded raise comes back in full, unless you cancel for your own reason, when most of it comes back; if the seller&apos;s fault cancels a raised delivery, it comes back in full at the seller&apos;s cost.</p>
            <p><strong className="text-foreground">Who can deliver:</strong> a member who is 18 or older, is not banned, has fewer than 3 Declutter strikes and is not the buyer or seller. You set up payouts after you take a delivery; your pay is held until that is done. Large items need a truck; extra-large items a truck and a second person.</p>
            <p><strong className="text-foreground">The Helpr&apos;s pay:</strong> the take-home amount the delivery shows before the Helpr takes it, with any raise added in full, paid in whole dollars rounded down; Louisiana Helpr keeps the leftover cents.</p>
            <p>A Helpr who backs out less than 2 hours before the pickup, or doesn&apos;t pick up within 2 hours of the pickup time, gets a strike on the jobs strike ladder. If the item is damaged on the way, you get everything back, the seller is still paid, and the Helpr isn&apos;t paid. If the Helpr already picked up the item and the sale is refunded for the seller&apos;s fault, the Helpr is paid for the trip and what you paid for delivery is not refunded.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Truck}
        title="Seller delivery"
        body={
          <>
            <p>A seller may offer to deliver: one flat rate per order in whole dollars, from $5 to $150; a range of 5, 10, 25 or 50 miles from their pickup address (10 unless they change it); and weekly 1-hour delivery slots. The seller keeps the whole delivery rate; Louisiana Helpr takes no cut of it. The seller can turn delivery off for an item.</p>
            <p>At checkout it shows only when your address is in range and a time is open. You book a slot from 24 hours ahead up to 14 days out and choose &ldquo;Leave it at my door&rdquo; (left with a photo, confirmed like a porch pickup) or &ldquo;Hand it to me&rdquo; (if nobody is home, report a problem and an admin decides). The seller sees your address only after you pay. Either of you may ask to move the time, at most 3 times each.</p>
            <p><strong className="text-foreground">Cancelling:</strong> you may cancel a paid seller delivery until 24 hours before the slot and get most of the payment back; after that, report a problem. A seller who cancels a paid delivery refunds you in full at the seller&apos;s cost and gets a Declutter strike.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Receipt}
        title="Refunds and when the sale is final"
        body={
          <>
            <p><strong className="text-foreground">You always get 24 hours.</strong> However the pickup is confirmed, you have 24 hours after pickup to ask for a refund, unless Louisiana Helpr has already decided a problem on that order. The seller can refund all of it (most of the payment comes back to you, and the item goes back to the seller), offer to refund part of it (exactly the amount offered), or decline (you can then report a problem, and Louisiana Helpr decides). If the seller doesn&apos;t answer within 24 hours, Louisiana Helpr decides.</p>
            <p><strong className="text-foreground">The seller is paid when the sale is final:</strong> 24 hours after pickup with no refund asked and no problem open, or once Louisiana Helpr has decided. After that the item is yours as is, with no returns.</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong className="text-foreground">Our mistake</strong> (a duplicate charge, a payment on a closed order): everything back.</li>
              <li><strong className="text-foreground">Not as described, seller no-show, seller backs out or blocks you after you paid:</strong> everything back, at the seller&apos;s cost, and the seller gets a strike. The same full refund applies if the seller can no longer sell when you pay.</li>
              <li><strong className="text-foreground">Damaged in Helpr delivery:</strong> everything back, delivery included.</li>
              <li><strong className="text-foreground">A delivery that falls through with less than 48 hours left:</strong> everything paid for delivery and most of the rest; no strike.</li>
              <li><strong className="text-foreground">Buyer never picks up, or misses a pickup twice:</strong> the item price back, and a buyer strike.</li>
              <li><strong className="text-foreground">Buyer cancels, pays twice by restarting checkout, or nobody&apos;s fault:</strong> most of the payment back.</li>
              <li><strong className="text-foreground">Missed the 48-hour checkout:</strong> nothing was charged; a buyer strike.</li>
            </ul>
          </>
        }
      />
      <PolicyRowItem
        icon={Ban}
        title="Declutter strikes"
        body={
          <>
            <p>Declutter keeps one strike count per member for buying and selling together, separate from job strikes; Declutter strikes never affect your jobs. <strong className="text-foreground">Each strike lasts 1 year. 3 active strikes lock you out of all of Declutter</strong> until one expires, and your listings are hidden meanwhile.</p>
            <p><strong className="text-foreground">Buyers</strong> get a strike for missing the 48-hour checkout, or paying but not picking up within the 7 days. <strong className="text-foreground">Sellers</strong> get one for not showing up at a booked pickup, the item being gone after it sold, backing out after accepting (or cancelling a paid seller delivery), an item that is not as described, or blocking the buyer after the sale.</p>
            <p>You can appeal each strike once, with a note and, if you like, a photo. An admin removes or keeps it.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={ShieldCheck}
        title="Fair play, questions and messages"
        body={
          <>
            <p>No offers on your own items, and no fake activity to push a price or find a seller&apos;s lowest price. Offers from someone sharing the seller&apos;s household, phone or card are flagged; a member proven to have made fake offers is removed from Declutter. Pay only through checkout: off-app payments are handled exactly as for jobs.</p>
            <p>Questions and answers show on the item page; the asker is shown only as &ldquo;a neighbor&rdquo;. They, and listings, can&apos;t contain phone numbers, emails, payment handles or other contact details. You can ask up to 20 questions a day. Private messages open only after checkout, between that buyer and seller.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Star}
        title="Extras"
        body={
          <>
            <p><strong className="text-foreground">Add a Helpr:</strong> after you pay, you can book a Helpr to put an item together, hang it or set it up. It is an ordinary Helpr job under the normal job rules, paid separately. If the sale is refunded because the seller failed, that job is cancelled and everything you paid for it comes back, except the one-time account setup fee.</p>
            <p><strong className="text-foreground">Haul-away:</strong> an item unsold 14 days after it went up for sale (or off sale without selling) can be taken by a Helpr to donation, or the dump if donation won&apos;t take it. Up to 10 items from one pickup address per trip; it is an ordinary Helpr job you price and pay for. Booking takes the items off sale. A paused item must be relisted first.</p>
            <p><strong className="text-foreground">Moving out:</strong> photograph each room and the app drafts up to 15 listings at a time for you to check and price. A moving sale can show its name, dates and move-out date (up to 180 days away) on your profile, never your address. Room photos are used once and never stored.</p>
            <p><strong className="text-foreground">Price hint:</strong> what similar items sold for nearby, worked out only from real Declutter sales, and shown only when there are enough of them. It is a guide, not a promise.</p>
            <p><strong className="text-foreground">Wanted posts:</strong> post what you&apos;re looking for and the most you&apos;d pay for the item, before our buyer&apos;s fee; a post lasts 30 days unless you close it. Sellers near you can always see it, with your first name and last initial and about how far away, never your address, and a seller can answer with an offer at or under your price.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Scale}
        title="Our role, safety and pauses"
        body={
          <>
            <p><strong className="text-foreground">Each sale is between the buyer and the seller.</strong> We don&apos;t own, inspect, store, test or guarantee any item. Our checks look for banned items and rule-breaking; they are not a promise that an item is safe, genuine, legal, working or as described. The disclaimers and limitation of liability below apply to Declutter sales and deliveries as they do to jobs.</p>
            <p>You meet other members at your own risk. Porch pickup means you never have to meet; never pay or take payment outside the app; report anything that doesn&apos;t feel right.</p>
            <p>In severe weather or another emergency we may pause Declutter for all of Louisiana or chosen parishes: the checkout and pickup clocks stop and no new strikes are given until the pause ends. If we turn Declutter off, sales already agreed can still be paid for and handed over, with no strike for a sale the shutdown interrupted.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Declutter and taxes"
        body={
          <>
            <p>Louisiana exempts occasional sales by someone who is not in the business of selling. That is why every seller confirms the four statements when they list. A seller who lists like a business may be flagged, and a flagged seller can&apos;t complete a Declutter sale until our tax step is ready.</p>
            <p>Taxes on your own income from selling or delivering are your responsibility. We don&apos;t give tax advice: ask a tax professional about your situation.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Camera}
        title="Declutter privacy and your account"
        body={
          <>
            <p>Before a buyer pays, they see your area name and about how far away the item is; the exact address goes only to the buyer who paid or the Helpr who took the delivery. Listing photos are shown to members, and anyone with a photo&apos;s link can open it; porch, delivery and problem photos stay with the people in that sale and our admins.</p>
            <p>The photos and text of your listing, and room photos when moving out, are sent to our AI provider to draft and check the listing.</p>
            <p>You can&apos;t delete your account while a Declutter sale or delivery is in progress. After you delete it, your Declutter photos are removed, your Declutter strikes stay {idOn ? "tied to your verified ID" : "on record"}, and your finished sales stay visible to the other side with you shown as &ldquo;Former member&rdquo;.</p>
            <p>Declutter always emails your sale, payout and refund receipts. Pickup reminders, price drops and Wanted matches are emailed too unless you turn their email off in Settings. Listings, offers and questions come only as a push notification and in-app alert.</p>
            <p>After a handover, buyer and seller can review each other with stars, quick tags and a comment, hidden until both have reviewed or 14 days pass. Declutter reviews count toward the same star rating used for jobs.</p>
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
        body={<TaxGuidanceLine />}
      />
    </PolicySection>

    <HideOnSearch>
      <PolicyFooter updated={LAST_UPDATED.terms} />
    </HideOnSearch>
  </div>
  );
};
