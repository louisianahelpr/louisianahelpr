import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Shield, DollarSign, Clock, AlertTriangle, Ban, Scale, CheckCircle, XCircle,
  Receipt, Database, Eye, Lock, Trash2, Cookie, FileText, Users, Crown,
  Wallet, Building2, Siren, ListChecks, Briefcase, Handshake,
  ShieldAlert, ShieldCheck, Search, X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import BackButton from "@/components/BackButton";
import { PolicyRowItem, PolicySection, PolicySearchContext } from "@/components/policy/CollapsedPolicy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/hooks/usePageTitle";

type TabKey = "terms" | "community" | "privacy";
const VALID_TABS: TabKey[] = ["terms", "community", "privacy"];

const PAGE_TITLES: Record<TabKey, string> = {
  terms: "Terms of Service — Helpr",
  community: "Community Rules — Helpr",
  privacy: "Privacy Policy — Helpr",
};

const TldrCard = ({ items }: { items: string[] }) => (
  <div
    className="rounded-2xl p-5 space-y-3"
    style={{
      // Bumped contrast vs the cream PolicySection surface below so
      // the TLDR reads as a discrete summary card, not another row.
      // Slightly tinted bark backdrop + inset highlight + bottom shadow
      // gives the card a soft lift over the page.
      background: "hsl(var(--bark) / 0.10)",
      border: "1px solid hsl(var(--bark) / 0.28)",
      boxShadow:
        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
        "0 1px 2px hsl(var(--olivewood) / 0.06), " +
        "0 8px 18px -8px hsl(var(--olivewood) / 0.12)",
    }}
  >
    <div className="flex items-center gap-2">
      <ListChecks className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
      <span
        className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        The short version
      </span>
    </div>
    <ul className="space-y-1.5 text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 leading-relaxed">
          <span
            className="shrink-0 w-1.5 h-1.5 rounded-full mt-[8px]"
            style={{ background: "hsl(var(--bark))" }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

/* ─────────────────────────────  TERMS  ───────────────────────────── */
const TermsContent = () => (
  <div className="space-y-3">
    <TldrCard
      items={[
        "You must be 18+. All accounts are reviewed before approval.",
        "Helpr is a marketplace — we don't perform tasks ourselves and aren't liable for the work delivered.",
        "Posters pay 10% on top. Helprs are paid 90% of the agreed price (10% platform fee).",
        "Cancellations, disputes, and behavior rules live in the Community Rules tab — they're part of this agreement.",
        "Helprs are independent contractors, not employees.",
      ]}
    />

    <PolicySection
      icon={Building2}
      title="Eligibility & accounts"
      subtitle="Who can use Helpr and how accounts work"
      defaultOpen
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
            <p><strong className="text-foreground">Accepting a task or hiring a helpr creates a binding commitment</strong> to complete the work as described and release payment on satisfactory completion.</p>
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
            <p><strong className="text-foreground">Liability:</strong> Helpr is a marketplace and is not responsible for the quality, safety, or legality of tasks performed.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Wallet}
      title="Payment, escrow & fees"
      subtitle="How money moves on the platform"
    >
      <PolicyRowItem
        icon={DollarSign}
        title="Escrow & charge timing"
        body={
          <>
            <p><strong className="text-foreground">Charged upfront:</strong> Payments are processed via Stripe at booking and held in escrow until both parties confirm completion.</p>
            <p><strong className="text-foreground">Auto-release:</strong> If only one party confirms, payment auto-releases to the helpr after 72 hours.</p>
            <p><strong className="text-foreground">Refunds:</strong> Refunds are evaluated case-by-case through the dispute process — see <Link to="/legal?tab=community" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Community Rules → When something goes wrong</Link>.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={DollarSign}
        title="Split fee model"
        body={
          <>
            <p><strong className="text-foreground">Poster service fee:</strong> 10% added at checkout.</p>
            <p><strong className="text-foreground">Helpr platform fee:</strong> 10% deducted from payout.</p>
            <p><strong className="text-foreground">Total platform take:</strong> 20% per transaction.</p>
            <p><strong className="text-foreground">Urgent job fee:</strong> $5 for priority placement.</p>
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
        title="One-time $2 onboarding fee"
        body={
          <>
            <p><strong className="text-foreground">Charged once per account.</strong> Whichever happens first — your first job post or your first payout — is when the $2 onboarding fee is collected.</p>
            <p><strong className="text-foreground">If you post first:</strong> the $2 is added as a line item at checkout the first time you post.</p>
            <p><strong className="text-foreground">If you only earn:</strong> the $2 is deducted from your first payout, automatically.</p>
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
      subtitle="Basic, Pro, and Elite plans"
    >
      <PolicyRowItem
        icon={Crown}
        title="Tiers & pricing"
        body={
          <>
            <p><strong className="text-foreground">Basic:</strong> $5/mo or ~$50/yr.</p>
            <p><strong className="text-foreground">Pro:</strong> $10/mo or ~$100/yr.</p>
            <p><strong className="text-foreground">Elite:</strong> $15/mo or ~$150/yr.</p>
            <p>All tiers maintain the same 10% / 10% split fee. Annual plans save ~17%. Stripe handles billing automatically.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Receipt}
      title="Tax responsibilities"
      subtitle="Platform, posters, and helprs"
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

    <p
      className="text-center pt-2 pb-4 text-ds-11 font-sans"
      style={{ color: "hsl(var(--olivewood) / 0.65)" }}
    >
      Questions? <Link to="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Contact support</Link>
    </p>
  </div>
);

/* ─────────────────────  COMMUNITY RULES  ───────────────────── */
const CommunityContent = () => (
  <div className="space-y-3">
    <TldrCard
      items={[
        "Cancel free 24+ hours ahead. Inside 24h, fees apply (25% / 50%). No-show = permanent ban.",
        "Payment auto-releases after 72 hours if either side doesn't act.",
        "If something's wrong, request a revision first → file a dispute → admin decides. Each step has a 72-hour window.",
        "Three strikes = ban. Fraud, harassment, off-platform payments, and identity fraud skip the strikes.",
        "Helprs are independent contractors — taxes are your responsibility. We send 1099s when thresholds are met.",
      ]}
    />

    {/* ── 1. Posting & accepting jobs ── */}
    <PolicySection
      icon={Briefcase}
      title="Posting & accepting jobs"
      subtitle="Setting up the work — limits, edits, and what's locked"
      defaultOpen
    >
      <PolicyRowItem
        icon={DollarSign}
        title="Job budget limits — $5 minimum, $5,000 maximum"
        body={
          <>
            <p><strong className="text-foreground">Minimum: $5.</strong> Jobs below $5 cannot be posted.</p>
            <p><strong className="text-foreground">Maximum: $5,000.</strong> For projects exceeding $5,000, split into multiple jobs or contact support.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={CheckCircle}
        title="Editing — before a helpr is selected"
        body={<p>Freely edit title, description, budget, date, and other details.</p>}
      />
      <PolicyRowItem
        icon={XCircle}
        title="Editing — after a helpr is selected"
        body={<p>Jobs cannot be edited once a helpr accepts. This protects helprs from unexpected scope or budget changes. If adjustments are needed, cancel and repost.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="New helpr account limits"
        body={
          <>
            <p>New helpr accounts are limited to:</p>
            <p>• Max <strong className="text-foreground">3 active jobs</strong> at a time</p>
            <p>• Max <strong className="text-foreground">$100 in total earnings</strong></p>
            <p>Lifted after <strong className="text-foreground">3 verified completions with a 4+ star rating</strong>.</p>
          </>
        }
      />
    </PolicySection>

    {/* ── 2. What you owe each other ── */}
    <PolicySection
      icon={Handshake}
      title="What you owe each other"
      subtitle="Cancel windows, response times, and showing up"
      defaultOpen
    >
      <PolicyRowItem
        icon={CheckCircle}
        title="24+ hours before job — free cancellation"
        body={<p>No fee charged. The helpr can fill the slot.</p>}
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Less than 24 hours before — 25% fee"
        body={<p><strong className="text-foreground">25% cancellation fee</strong> applied. The helpr has already committed their time.</p>}
      />
      <PolicyRowItem
        icon={XCircle}
        title="Less than 2 hours before — 50% fee"
        body={<p><strong className="text-foreground">50% cancellation fee</strong> applied. This is considered a very late cancellation.</p>}
        warning
      />
      <PolicyRowItem
        icon={Ban}
        title="No-show — instant permanent ban"
        body={
          <p>If a helpr accepts a job and fails to show without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong>. The poster receives a full refund. <strong className="text-foreground">Even a late cancellation is better than a no-show.</strong></p>
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
      title="Getting paid — releasing escrow"
      subtitle="How completion turns into a payout"
    >
      <PolicyRowItem
        icon={CheckCircle}
        title="Mutual confirmation = instant release"
        body={<p>When both poster and helpr confirm completion, payment releases immediately.</p>}
      />
      <PolicyRowItem
        icon={Clock}
        title="One-sided confirmation = 72-hour window"
        body={<p>If only one party confirms, the other has 72 hours to confirm or request a revision. Both parties are notified every 12 hours.</p>}
      />
      <PolicyRowItem
        icon={CheckCircle}
        title="Auto-release after 72 hours"
        body={<p>If neither confirmation nor revision is received within 72 hours, payment is automatically released to the helpr.</p>}
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
            <p className="pt-1">Then you have 72h to either Mark Resolved, Escalate to Admin, or do nothing (auto-releases to helpr).</p>
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
    >
      <PolicyRowItem
        icon={AlertTriangle}
        title="Cancellation strikes (posters)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st strike:</strong> Written warning recorded; admins notified.</li>
            <li><strong className="text-foreground">2nd strike:</strong> Final warning. One more = permanent ban.</li>
            <li><strong className="text-foreground">3rd strike:</strong> Permanent ban. Final, no appeal.</li>
            <li>Cancelling a job <em>before</em> a helpr is assigned does <strong>not</strong> count toward strikes (timing-based fees still apply).</li>
          </ul>
        }
      />
      <PolicyRowItem
        icon={AlertTriangle}
        title="Job-denial strikes (helprs)"
        body={
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st strike:</strong> Written warning. Only apply to jobs you can commit to.</li>
            <li><strong className="text-foreground">2nd strike:</strong> Final warning.</li>
            <li><strong className="text-foreground">3rd strike:</strong> Permanent ban.</li>
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
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong className="text-foreground">1st report:</strong> Written warning via email + in-app.</li>
            <li><strong className="text-foreground">2nd report:</strong> 7-day suspension.</li>
            <li><strong className="text-foreground">3rd report:</strong> Permanent ban. Final.</li>
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
    >
      <PolicyRowItem
        icon={Receipt}
        title="Helpr (the platform)"
        body={
          <>
            <p><strong className="text-foreground">1099-K (2026):</strong> Federal threshold reverted to $20,000 AND 200+ transactions. Louisiana follows federal.</p>
            <p><strong className="text-foreground">1099-NEC (2026):</strong> Threshold raised from $600 to $2,000.</p>
            <p><strong className="text-foreground">Marketplace facilitator:</strong> Above $100,000 LA gross revenue, Helpr collects/remits sales tax on the entire transaction.</p>
            <p><strong className="text-foreground">LDR e-filing mandate:</strong> All LA withholding and sales tax returns filed electronically as of Jan 1, 2026.</p>
            <p><strong className="text-foreground">Worker classification:</strong> Helprs qualify as independent contractors under the Economic Reality Test.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={CheckCircle}
        title="Job posters (customers)"
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

    <p
      className="text-center pt-2 pb-4 text-ds-11 font-sans"
      style={{ color: "hsl(var(--olivewood) / 0.65)" }}
    >
      Questions? <Link to="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Contact support</Link>
    </p>
  </div>
);

/* ───────────────────────  PRIVACY  ─────────────────────── */
const PrivacyContent = () => (
  <div className="space-y-3">
    {/* "We never sell your data" promoted to a top-of-tab callout —
        it's the single highest-trust question users have about a
        marketplace handling their ID + location, so it earns its own
        surface above the TLDR rather than sitting as bullet #3. */}
    <div
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{
        background: "hsl(var(--bark) / 0.08)",
        border: "1px solid hsl(var(--bark) / 0.30)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
          "0 6px 14px -6px hsl(var(--bark) / 0.22)",
      }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "hsl(var(--bark) / 0.15)", color: "hsl(var(--bark))" }}
      >
        <ShieldCheck className="w-4 h-4" strokeWidth={2.25} />
      </div>
      <div className="min-w-0">
        <p
          className="font-display italic font-bold leading-tight"
          style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
        >
          We never sell your data.
        </p>
        <p className="font-serif italic mt-1 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
          Other users only see your first name, photo, and ratings. ID documents stay encrypted and are accessed only during verification.
        </p>
      </div>
    </div>

    <TldrCard
      items={[
        "We collect only what we need to match jobs and process payments — name, email, phone, ID, location, usage data.",
        "Stripe handles payments. We never store full card numbers.",
        "You can request deletion or a data export at any time via support — we respond within 30 days.",
      ]}
    />

    <PolicySection
      icon={Database}
      title="Information we collect"
      subtitle="Account, ID, location, payments, and messages"
      defaultOpen
    >
      <PolicyRowItem
        icon={Database}
        title="Account & ID data"
        body={
          <>
            <p><strong className="text-foreground">Account information:</strong> Name, email, phone, date of birth, and profile photo.</p>
            <p><strong className="text-foreground">Identity verification:</strong> Government-issued ID documents are stored securely and accessed only during verification.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Eye}
        title="Activity & location data"
        body={
          <>
            <p><strong className="text-foreground">Location data:</strong> Address and GPS coordinates for matching and proximity verification.</p>
            <p><strong className="text-foreground">Usage data:</strong> Device information, IP address, browser type, and platform interaction data.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Lock}
        title="Payments & communications"
        body={
          <>
            <p><strong className="text-foreground">Payment information:</strong> Processed securely by Stripe. Helpr does not store full card numbers.</p>
            <p><strong className="text-foreground">Communications:</strong> In-app messages are stored for coordination and dispute resolution.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Eye}
      title="How we use your information"
      subtitle="Service delivery, safety, and improvement"
    >
      <PolicyRowItem
        icon={Eye}
        title="Service delivery"
        body={<p>To match you with tasks, process payments, and facilitate communication between customers and helprs.</p>}
      />
      <PolicyRowItem
        icon={Shield}
        title="Safety & trust"
        body={<p>To verify identities, prevent fraud, enforce community guidelines, and resolve disputes.</p>}
      />
      <PolicyRowItem
        icon={FileText}
        title="Notifications"
        body={<p>To send job updates, payment confirmations, and important account alerts via push and email.</p>}
      />
      <PolicyRowItem
        icon={Database}
        title="Platform improvement"
        body={<p>To analyze usage patterns, fix bugs, and develop new features that serve our Louisiana community.</p>}
      />
    </PolicySection>

    <PolicySection
      icon={Shield}
      title="Information sharing"
      subtitle="Who we share with — and what we never share"
    >
      <PolicyRowItem
        icon={Users}
        title="With other users"
        body={<p>Your first name, profile photo, ratings, and reviews are visible to other users. Full contact details are only shared after a job is confirmed.</p>}
      />
      <PolicyRowItem
        icon={Wallet}
        title="Payment processors"
        body={<p>Stripe processes all payments securely under their own privacy policy.</p>}
      />
      <PolicyRowItem
        icon={Scale}
        title="Legal requirements"
        body={<p>We may disclose information when required by law, court order, or to protect the safety of our users.</p>}
      />
      <PolicyRowItem
        icon={CheckCircle}
        title="What we never do"
        body={<p>We never sell your personal information to third parties for advertising or marketing purposes.</p>}
      />
    </PolicySection>

    <PolicySection
      icon={Lock}
      title="Data security"
      subtitle="Encryption, access control, and storage"
    >
      <PolicyRowItem
        icon={Lock}
        title="Encryption & access controls"
        body={
          <>
            <p>We use industry-standard security measures including encryption in transit (TLS) and at rest, secure authentication, and role-based access controls.</p>
            <p>ID documents are stored in private, encrypted storage buckets accessible only to authorized verification personnel.</p>
            <p>In-app messages are monitored to prevent sharing of personal contact information to keep transactions safe on the platform.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Trash2}
      title="Your rights"
      subtitle="Access, correction, deletion, and portability"
    >
      <PolicyRowItem
        icon={Eye}
        title="Access & correction"
        body={
          <>
            <p><strong className="text-foreground">Access:</strong> View all your personal data through your profile settings.</p>
            <p><strong className="text-foreground">Correction:</strong> Update your profile information at any time.</p>
          </>
        }
      />
      <PolicyRowItem
        icon={Trash2}
        title="Deletion & portability"
        body={
          <>
            <p><strong className="text-foreground">Deletion:</strong> Request complete account and data deletion by contacting support. We process within 30 days.</p>
            <p><strong className="text-foreground">Data portability:</strong> Request a copy of your data in a machine-readable format.</p>
          </>
        }
      />
    </PolicySection>

    <PolicySection
      icon={Cookie}
      title="Cookies & tracking"
      subtitle="Essential and analytics cookies"
    >
      <PolicyRowItem
        icon={Cookie}
        title="What we use"
        body={
          <>
            <p>We use essential cookies for authentication and session management. We use analytics cookies to understand how users interact with the platform.</p>
            <p>You can control cookie preferences through your browser settings, though disabling essential cookies may affect platform functionality.</p>
          </>
        }
      />
    </PolicySection>

    <p
      className="text-center pt-2 pb-4 text-ds-11 font-sans"
      style={{ color: "hsl(var(--olivewood) / 0.65)" }}
    >
      Questions? <Link to="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Contact support</Link>
    </p>
  </div>
);

/* ─────────────────────────  PAGE  ───────────────────────── */
const Legal = () => {
  const [params, setParams] = useSearchParams();
  const tabParam = (params.get("tab") || "terms") as TabKey;
  const tab: TabKey = VALID_TABS.includes(tabParam) ? tabParam : "terms";
  const [query, setQuery] = useState("");

  usePageTitle(PAGE_TITLES[tab]);

  // Update document title when the tab changes (usePageTitle only fires on
  // initial mount with the given string).
  useEffect(() => {
    document.title = PAGE_TITLES[tab];
  }, [tab]);

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <Navbar />
      <div aria-hidden className="h-14" />

      <main className="container mx-auto px-5 pt-4 pb-8">
        <div className="max-w-2xl mx-auto space-y-4">
          <div>
            <div className="flex items-start gap-3">
              {/* No explicit `to` — BackButton falls back to history.back()
                  which works for both authenticated users coming from
                  /profile?tab=legal and unauthenticated visitors coming
                  from the signup agreement checkbox. */}
              <BackButton />
              <div className="flex flex-col leading-none min-w-0 flex-1">
                <span
                  className="font-serif italic uppercase text-[0.62rem]"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                >
                  Compliance & disclosures
                </span>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <h1
                    className="font-display italic font-bold leading-tight"
                    style={{ fontSize: "clamp(1.5rem, 2.5vw + 0.4rem, 2rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
                  >
                    Legal
                  </h1>
                  {/* "Last updated" chip — promoted from a fading-italic
                      subtitle to a tabular-nums chip so users can quickly
                      verify they're reading the current revision. Used
                      a lot when posters reference a clause to a helpr. */}
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.66rem] font-sans font-semibold tabular-nums uppercase tracking-wider"
                    style={{
                      background: "hsl(var(--bark) / 0.10)",
                      color: "hsl(var(--bark))",
                      border: "1px solid hsl(var(--bark) / 0.22)",
                    }}
                  >
                    Updated · Mar 2026
                  </span>
                </div>
              </div>
            </div>
          </div>

          <PolicySearchContext.Provider value={query}>
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              {/* Sticky tabs + search — stay pinned at the top of the
                  scroll area (just below the fixed Navbar) so the user
                  can switch between Terms / Community / Privacy and
                  filter without losing their place in long policy docs.
                  The frosted-blur background bleeds the page warmth
                  through so it doesn't read as a hard band. */}
              <div
                className="sticky z-30 -mx-5 px-5 pt-2 pb-3 space-y-2.5"
                style={{
                  top: "calc(3.5rem + env(safe-area-inset-top, 0px))",
                  background:
                    "linear-gradient(to bottom, hsla(38, 18%, 97%, 0.92), hsla(38, 18%, 97%, 0.78))",
                  backdropFilter: "blur(14px) saturate(150%)",
                  WebkitBackdropFilter: "blur(14px) saturate(150%)",
                }}
              >
                <TabsList
                  className="grid w-full grid-cols-3 rounded-2xl p-1 h-12"
                  style={{
                    background: "hsla(0, 0%, 100%, 0.55)",
                    border: "1px solid hsla(0, 0%, 100%, 0.6)",
                    backdropFilter: "blur(20px) saturate(170%)",
                  }}
                >
                  <TabsTrigger
                    value="terms"
                    className="rounded-ds-md text-ds-13 font-sans font-semibold text-muted-foreground data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-foreground"
                  >
                    Terms
                  </TabsTrigger>
                  <TabsTrigger
                    value="community"
                    className="rounded-ds-md text-ds-13 font-sans font-semibold text-muted-foreground data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-foreground"
                  >
                    Community
                  </TabsTrigger>
                  <TabsTrigger
                    value="privacy"
                    className="rounded-ds-md text-ds-13 font-sans font-semibold text-muted-foreground data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-foreground"
                  >
                    Privacy
                  </TabsTrigger>
                </TabsList>

                {/* In-page search across this tab's section titles +
                    item labels. Auto-expands matching sections via the
                    PolicySearchContext provider. */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="search"
                    aria-label={`Search ${tab}`}
                    placeholder={`Search ${tab}…`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9 pr-9 h-10 rounded-ds-md bg-white/70 border-border/60"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/70 active:scale-[0.94] transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Safe-area bottom padding on each tab so the long legal body
                  can scroll fully past the floating dock + FAB on iPhone
                  without clipping the last paragraph. */}
              <TabsContent value="terms" className="mt-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}>
                <TermsContent />
              </TabsContent>
              <TabsContent value="community" className="mt-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}>
                <CommunityContent />
              </TabsContent>
              <TabsContent value="privacy" className="mt-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}>
                <PrivacyContent />
              </TabsContent>
            </Tabs>
          </PolicySearchContext.Provider>
        </div>
      </main>
    </div>
  );
};

export default Legal;
