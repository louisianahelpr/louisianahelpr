import { Link } from "react-router-dom";
import {
  Database, Eye, Shield, Lock, Trash2, Cookie, Users, Wallet, Scale,
  CheckCircle, FileText, ShieldCheck,
} from "lucide-react";
import { useContext, type ReactNode } from "react";
import {
  PolicyRowItem,
  PolicySection,
  PolicySearchContext,
  policySearchMatches,
} from "@/components/policy/CollapsedPolicy";
import { HideOnSearch, TldrCard, PolicyFooter } from "./LegalChrome";
import { LAST_UPDATED } from "./legalSections";
import { DataExportCard, DATA_EXPORT_ANCHOR } from "./DataExportCard";

/** The row whose "Download your data" link points at the export card. */
const PORTABILITY_ROW_TITLE = "Deletion & portability";

/**
 * The export card's search behaviour. It used to sit in <HideOnSearch>, but the
 * "Deletion & portability" row links to it (`#download-your-data`) and that row
 * STAYS visible whenever a search matches its title — so during a search the
 * link pointed at nothing. The card is now shown during a search whenever that
 * row would be (same predicate, same title), or when the query names the card
 * itself; otherwise it stays out of the result list as before.
 */
const EXPORT_CARD_SEARCH_TEXT = `${PORTABILITY_ROW_TITLE} Download your data data portability export JSON`;
const ExportCardOnSearch = ({ children }: { children: ReactNode }) => {
  const query = useContext(PolicySearchContext);
  return policySearchMatches(query, EXPORT_CARD_SEARCH_TEXT) ? <>{children}</> : null;
};

/* ───────────────────────  PRIVACY  ─────────────────────── */
export const PrivacyContent = () => (
  <div className="space-y-3">
    <TldrCard
      items={[
        "We collect only what we need to match jobs and process payments — name, email, phone, ID, location, usage data.",
        "Stripe handles payments. We never store full card numbers.",
        "Delete your account or download your data yourself, anytime, from the Download your data card in this policy — no waiting on support.",
      ]}
    />

    <PolicySection
      icon={Database}
      title="Information we collect"
      subtitle="Account, ID, location, payments, and messages"
      anchorId="information-collected"
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
      anchorId="how-we-use"
    >
      <PolicyRowItem
        icon={Eye}
        title="Service delivery"
        body={<p>To match you with jobs, process payments, and facilitate communication between posters and Helprs.</p>}
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
      anchorId="information-sharing"
    >
      <PolicyRowItem
        icon={Users}
        title="With other users"
        body={<p>Your first name, profile photo, ratings, and reviews are visible to other neighbors. Full contact details are only shared after a job is confirmed.</p>}
      />
      <PolicyRowItem
        icon={Wallet}
        title="Payment processors"
        body={<p>Stripe processes all payments and identity verification securely under their own privacy policy.</p>}
      />
      <PolicyRowItem
        icon={Database}
        title="Service providers we rely on"
        body={
          <>
            <p>We use a small set of trusted vendors to run Helpr. Each only receives the data it needs for its function, under its own privacy policy:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Supabase</strong> — database, authentication, and file storage.</li>
              <li><strong className="text-foreground">Stripe</strong> — payments, payouts, and identity verification.</li>
              <li><strong className="text-foreground">Apple &amp; Google</strong> — optional Sign in with Apple / Google, and push-notification delivery (APNs / FCM).</li>
              <li><strong className="text-foreground">PostHog</strong> — privacy-respecting product analytics.</li>
              <li><strong className="text-foreground">Sentry</strong> — crash and error monitoring.</li>
            </ul>
          </>
        }
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
      anchorId="data-security"
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
      anchorId="data-retention"
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
        title={PORTABILITY_ROW_TITLE}
        body={
          <>
            <p><strong className="text-foreground">Deletion:</strong> Permanently delete your account and personal data yourself from <Link to="/profile" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Profile settings</Link> — it takes effect immediately. Financial and tax records we're legally required to keep are retained; everything else is removed.</p>
            {/* Points at the export's real home: the "Download your data"
                card further down THIS policy (owner, 2026-09-14, VN-47). An
                in-page hash link, not a route, so it works on the public
                /privacy page and in the Profile Legal tab's Privacy panel
                alike without bouncing a signed-in reader out of the app. */}
            <p><strong className="text-foreground">Data portability:</strong> Download a complete copy of your data (profile, jobs, applications, reviews) as a machine-readable JSON file with <a href={`#${DATA_EXPORT_ANCHOR}`} className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Download your data</a> below.</p>
          </>
        }
      />
    </PolicySection>

    {/* The export control, right under the section that grants the right.
        The /data-rights route redirects to this anchor (DataRightsRedirect). Visible
        during a search whenever the row that links here is — see
        ExportCardOnSearch. */}
    <ExportCardOnSearch>
      <DataExportCard />
    </ExportCardOnSearch>

    <PolicySection
      icon={Cookie}
      title="Cookies & tracking"
      subtitle="Essential and analytics cookies"
      anchorId="cookies-tracking"
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

    <HideOnSearch>
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
            className="font-display italic font-bold leading-tight text-ds-16"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
          >
            We never sell your data.
          </p>
          <p className="font-sans mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Other users only see your first name, photo, and ratings. ID documents stay encrypted and are accessed only during verification.
          </p>
        </div>
      </div>
    </HideOnSearch>

    <HideOnSearch>
      <PolicyFooter updated={LAST_UPDATED.privacy} />
    </HideOnSearch>
  </div>
);
