import { useState } from "react";
import { Link } from "react-router-dom";
import {
  DollarSign, Shield, FileText, ChevronRight, Clock,
  Crown, XCircle, Scale,
  Building2, Wallet, HeartPulse, Siren, Download, Loader2,
} from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { report } from "@/lib/errorLogger";
import { hapticError } from "@/lib/haptics";
import { toast } from "sonner";

// THIS TAB STATES NO POLICY OF ITS OWN. It is a directory plus one control:
// links to the three policy documents, the GDPR/CCPA data export, and deep
// links into the canonical sections on /legal.
//
// It used to render its own accordion summaries of the fee split, cancellation
// windows, strike ladders and dispute steps — a second, hand-maintained wording
// of copy that /legal already owned. That is why it imported TIER_PERKS,
// moneyLimits and the shared PolicySection primitives; none of that belongs
// here now. If a policy needs to change, it changes in src/pages/legal/ and
// this tab needs no edit at all.

// ---------- Data rights ----------

/**
 * GDPR Art. 20 / CCPA data portability — the "Download your data" control.
 *
 * MERGED HERE 2026-08-18 from the standalone `/data-rights` page. That route
 * had been reduced to a single button once its inert CCPA "do not sell or
 * share" toggle came out (7e62af5f), and a whole route for one control is
 * not a screen. `/data-rights` now redirects here (App.tsx) rather than 404 —
 * the Privacy Policy promises this export IN WRITING and links to it, and the
 * iOS App Store privacy listing points at the URL too, so the old address has
 * to keep resolving somewhere that actually offers the download.
 *
 * Deliberately NOT here: account deletion (GDPR Art. 17 erasure). It lives on
 * the Profile landing / Settings screen only, so there is exactly ONE entry
 * point to an irreversible action rather than two that can drift apart.
 *
 * Own component (not inlined into LegalTab) purely so the `exporting` state
 * transition re-renders this card instead of the whole policy document below.
 */
function DataExportCard() {
  // Derive the user id from the app-wide auth snapshot (getSession-backed,
  // local, offline-safe) rather than a network getUser() call. The null guard
  // remains because a failed getUser() round-trip used to leave `userId` null
  // and the export button permanently disabled even with a valid local session.
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!userId) return;
    setExporting(true);
    try {
      const [profileRes, jobsRes, applicationsRes, reviewsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("jobs").select("*").or(`customer_id.eq.${userId},helper_id.eq.${userId}`),
        supabase.from("applications").select("*").eq("helper_id", userId),
        supabase.from("reviews").select("*").or(`reviewer_id.eq.${userId},reviewee_id.eq.${userId}`),
      ]);

      // Never drop the Supabase `error` — a swallowed failure would hand the
      // user a JSON file full of `null` and call it their data export.
      const firstError = profileRes.error || jobsRes.error || applicationsRes.error || reviewsRes.error;
      if (firstError) throw firstError;

      const payload = {
        exported_at: new Date().toISOString(),
        profile: profileRes.data,
        jobs: jobsRes.data,
        applications: applicationsRes.data,
        reviews: reviewsRes.data,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `helpr-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      report(err, { tags: { source: "LegalTab.exportData" } });
      hapticError();
      toast.error("We couldn't put your data together just now — try again or email support.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Same card anatomy as the three anchor-doc rows above (liquid-glass
          squircle, 10x10 primary icon badge, display title + muted body) so
          the tab reads as one surface — but no hover-lift, because this card
          ACTS rather than navigates and shouldn't borrow a link's affordance. */}
      <section className="rounded-2xl liquid-glass squircle p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Download className="w-4 h-4" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-foreground leading-tight text-ds-15">
              Download your data
            </h2>
            <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
              Get a complete copy of your Helpr data — profile, posted jobs, applications, and reviews — as a single JSON file.
            </p>
          </div>
        </div>
        {/* flex-wrap lets the format hint and the button stack on a narrow
            phone instead of squeezing the 44px-tall button below target size. */}
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3"
          style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
        >
          <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            JSON file
          </span>
          <Button
            onClick={handleExport}
            disabled={exporting || !userId}
            aria-busy={exporting}
            variant="primary"
            size="sm"
            className="shrink-0"
          >
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />Preparing…</> : "Download My Data"}
          </Button>
        </div>
      </section>

      {/* The GDPR/CCPA footnote travels WITH the export control — it is the
          legal context for why the right exists, and it carries the contact
          route for every privacy question the button doesn't answer. Routes
          to the in-app support form, not a raw `mailto:` (which needs a
          configured mail client and does nothing inside the native app). */}
      <p className="text-ds-11 leading-relaxed px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Under the EU GDPR and California CCPA, you have specific rights about how Helpr handles your personal data.
        For any other privacy question,{" "}
        <Link to="/support" className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>contact support</Link>.
      </p>
    </div>
  );
}

// ---------- Documents ----------

/**
 * ONE ENTRY PER LEGAL DOCUMENT (owner, 2026-08-27: "Legal and policies in
 * profile ... it's all jumbled together" — specifically, Terms, Community
 * Rules and Privacy were visually mashed into one block with no clear
 * separation between documents).
 *
 * The tab used to be two flat stacks: three near-identical "policy document"
 * cards, then ONE nine-row "Jump to a section" list whose rows silently mixed
 * Community Rules sections with Terms sections. Nothing on the screen said
 * which document a shortcut belonged to, or where one document ended and the
 * next began.
 *
 * Now the tab is three labelled document blocks, in the same order the three
 * cards were already in. Each block carries its document's name, the link to
 * its full text, and only its OWN section shortcuts — so a shortcut can never
 * again be read as belonging to the wrong policy.
 *
 * PRESENTATION ONLY: this tab still states no policy of its own. Every clause
 * lives in src/pages/legal/; these are navigation labels and the deep links
 * are unchanged, one for one, from the flat list they replace.
 */
interface LegalDocument {
  key: string;
  /** In-app route to the full text (a <Navigate> to /legal?tab=…). */
  to: string;
  icon: typeof FileText;
  title: string;
  body: string;
  /** Deep links into this document's own sections. May be empty. */
  sections: { to: string; icon: typeof FileText; title: string }[];
}

const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    key: "community",
    to: "/rules",
    icon: FileText,
    title: "Community Rules",
    body: "How Helpr works — every guideline that governs jobs, payments, and conduct.",
    sections: [
      // "The basics" is this section's OWN title in CommunitySection. The row
      // was labelled "Community Rules" back when the shortcuts were one flat
      // list and every label had to carry its document's name; under the
      // Community Rules heading it now merely restated it — and it never
      // matched the heading it actually scrolls you to.
      { to: "/legal?tab=community#basics", icon: Building2, title: "The basics" },
      { to: "/legal?tab=community#posting-accepting", icon: Clock, title: "Budget limits, editing & new-Helpr limits" },
      { to: "/legal?tab=community#cancellations", icon: XCircle, title: "Cancellations, response times & no-shows" },
      { to: "/legal?tab=community#escrow-release", icon: Wallet, title: "How your payment is held & released" },
      { to: "/legal?tab=community#disputes", icon: Scale, title: "Revisions, disputes & admin review" },
      { to: "/legal?tab=community#strikes-bans", icon: Siren, title: "Strikes, bans & how we detect violations" },
      { to: "/legal?tab=community#money-taxes", icon: HeartPulse, title: "Money & taxes" },
    ],
  },
  {
    key: "terms",
    to: "/terms",
    icon: Scale,
    title: "Terms of service",
    body: "The contract between you and Helpr when you use the platform.",
    sections: [
      { to: "/legal?tab=terms#payment-escrow-fees", icon: DollarSign, title: "Platform fees & the split fee model" },
      { to: "/legal?tab=terms#subscription-tiers", icon: Crown, title: "Membership tiers & pricing" },
    ],
  },
  {
    key: "privacy",
    to: "/privacy",
    icon: Shield,
    title: "Privacy policy",
    body: "What we collect, how we use it, and how we keep it safe.",
    // No section shortcuts. The Privacy block carries the data-export control
    // instead — that is the right this document grants, and the Privacy Policy
    // links here for it in writing.
    sections: [],
  },
];

// ---------- Page ----------

export function LegalTab({ onBack }: { onBack: () => void }) {
  return (
    // Safe-area-aware bottom padding (~6rem) so the bottom section
    // (the last section shortcut) scrolls clear of the MobileNav dock + FAB
    // on iPhone without leaving a large empty dead-zone below it.
    <div
      className="space-y-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
    >
      <ProfileTabHeader
        title="Legal &amp; Policies"
        onBack={onBack}
      />

      {/* ONE BLOCK PER DOCUMENT. The separation is carried by three things at
          once, because a single one of them was not enough to read as a
          boundary on a screen of identically-styled squircles:
            1. a numbered, ruled document heading naming the policy;
            2. an indented, hairline-railed column holding that document's own
               shortcuts, so they visibly hang off their heading; and
            3. real vertical air (`space-y-8`) between blocks — more than the
               gap between any two rows inside one.

          AFFORDANCE: the document cards NAVIGATE IN-APP. `/rules`, `/terms`
          and `/privacy` are <Navigate> redirects to `/legal?tab=…` (App.tsx),
          which renders inside AppShell on native — nothing leaves the app. They
          once carried an `ExternalLink` (↗) glyph, which promised exactly that.
          On a legal screen, where the whole question is where your data goes, a
          lying affordance is worse than cosmetic, so they carry the app's
          forward chevron (›).

          The screen's affordances, kept distinct:
            ›  chevron-right  → navigates in-app        (every row here)
            ↗  external-link  → opens outside the app   (nothing on this
                                                         screen does; if a row
                                                         ever does, it keeps ↗) */}
      <div className="space-y-8">
        {LEGAL_DOCUMENTS.map((doc, index) => {
          const Icon = doc.icon;
          return (
            <section key={doc.key} aria-labelledby={`legal-doc-${doc.key}`} className="space-y-2">
              {/* Document heading — "1 / 3 · Community Rules" over a rule.
                  The counter is what makes the boundary unambiguous: it says
                  not just that this is a document, but WHICH of the three,
                  so the end of one and the start of the next is impossible to
                  miss while scrolling. */}
              <div
                className="flex items-baseline gap-2 px-1 pb-1.5"
                style={{ borderBottom: "1.5px solid hsl(var(--olivewood) / 0.22)" }}
              >
                <span
                  className="font-sans font-semibold text-ds-11 tabular-nums shrink-0"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  {index + 1}/{LEGAL_DOCUMENTS.length}
                </span>
                <h2
                  id={`legal-doc-${doc.key}`}
                  className="font-display font-bold text-foreground text-ds-15 leading-tight"
                >
                  {doc.title}
                </h2>
              </div>

              {/* The document itself. */}
              <Link
                to={doc.to}
                className="glass-press block rounded-2xl liquid-glass squircle p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" strokeWidth={2.25} aria-hidden />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold text-foreground leading-tight text-ds-15">
                      Read the full {doc.title.toLowerCase()}
                    </p>
                    <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
                      {doc.body}
                    </p>
                  </div>
                  {/* aria-hidden: the row's accessible name already comes from
                      its title + body text, which describes in-app navigation
                      and never claims a new window. The glyph is decoration on
                      top of that. */}
                  <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </Link>

              {/* This document's own sections.
                  THESE USED TO BE THE PROBLEM — nine rows in one undivided
                  list, seven of them Community Rules and two of them Terms,
                  with nothing distinguishing the two. They are indented under
                  their document now, behind a hairline rail.

                  (Earlier still, the tab carried ~17 hand-written SUMMARIES of
                  the cancellation windows, strike ladders, fee split, dispute
                  steps, budget limits and verification rules — a second
                  wording of copy /legal already owned, which had already
                  drifted. Those are gone; these rows point at the canonical
                  section. `/legal` owns the text, this tab owns getting you
                  there. PolicySection auto-expands and scrolls to a matching
                  `anchorId`.) */}
              {doc.sections.length > 0 && (
                <div
                  className="ml-3 pl-3 space-y-2 pt-1"
                  style={{ borderLeft: "1.5px solid hsl(var(--olivewood) / 0.14)" }}
                >
                  <h3
                    className="font-sans font-semibold text-ds-11 uppercase tracking-[0.12em] px-1"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    Jump to a section
                  </h3>
                  {doc.sections.map(({ to, icon: SectionIcon, title }) => (
                    <Link
                      key={to}
                      to={to}
                      className="glass-press flex items-center gap-3 rounded-2xl liquid-glass squircle px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      {/* Smaller badge than the document card above: same
                          anatomy, one step down the hierarchy, so a section
                          shortcut never reads as loud as a whole document. */}
                      <div className="w-8 h-8 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <SectionIcon className="w-4 h-4" strokeWidth={2.25} aria-hidden />
                      </div>
                      <p className="flex-1 min-w-0 font-sans font-semibold text-foreground text-ds-13 leading-snug">
                        {title}
                      </p>
                      <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                </div>
              )}

              {/* Data rights belong to the Privacy Policy and travel with it:
                  that document promises this export IN WRITING and links here
                  for it, so the control it promises sits inside its own block
                  rather than floating between documents. */}
              {doc.key === "privacy" && (
                <div
                  className="ml-3 pl-3 pt-1"
                  style={{ borderLeft: "1.5px solid hsl(var(--olivewood) / 0.14)" }}
                >
                  <DataExportCard />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
