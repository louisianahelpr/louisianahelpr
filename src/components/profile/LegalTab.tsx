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
      toast.success("Your data has been downloaded");
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
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />Preparing…</> : "Download my data"}
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

      {/* Anchor docs — dedicated full-text pages.
          AFFORDANCE: these three rows NAVIGATE IN-APP. `/rules`, `/terms` and
          `/privacy` are <Navigate> redirects to `/legal?tab=…` (see App.tsx),
          which renders inside AppShell on native — nothing leaves the app, no
          browser opens, no new window. They carried an `ExternalLink` (↗)
          glyph, which promised exactly that. On a legal screen, where the
          whole question is where your data goes, a lying affordance is worse
          than cosmetic, so they now carry the app's forward chevron (›) — the
          same glyph SupportInline's "Browse the Help Center" row uses for the
          same behaviour.

          The screen's three affordances, kept distinct:
            ›  chevron-right  → navigates in-app        (these three rows)
            ⌄  chevron-down   → expands in place        (PolicySection /
                                                         PolicyRowItem below)
            ↗  external-link  → opens outside the app   (nothing on this
                                                         screen does; if a row
                                                         ever does, it keeps ↗) */}
      <div>
        {/* Same heading treatment as "Jump to a section" below, so the tab
            reads as two labelled groups rather than one undifferentiated
            stack of cards. */}
        <div className="space-y-2">
          <h2 className="font-display font-bold text-foreground text-ds-13 px-1">
            Policy documents
          </h2>
          {([
            { to: "/rules", icon: FileText, title: "Platform rules", body: "How Helpr works — every guideline that governs jobs, payments, and conduct." },
            { to: "/terms", icon: Scale, title: "Terms of service", body: "The contract between you and Helpr when you use the platform." },
            { to: "/privacy", icon: Shield, title: "Privacy policy", body: "What we collect, how we use it, and how we keep it safe." },
          ]).map(({ to, icon: Icon, title, body }) => (
            <Link
              key={to}
              to={to}
              className="glass-press block rounded-2xl liquid-glass squircle p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" strokeWidth={2.25} />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Clean font-display heading — matches the shared
                      PolicySection cards below so the whole tab speaks
                      one type language. */}
                  <p className="font-display font-bold text-foreground leading-tight text-ds-15">
                    {title}
                  </p>
                  <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
                    {body}
                  </p>
                </div>
                {/* aria-hidden: the row's accessible name already comes from
                    the title + body text ("Platform rules, How Helpr works —
                    …"), which describes in-app navigation and never claims a
                    new window. The glyph is decoration on top of that. */}
                <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Data rights sit directly under the anchor docs, ABOVE the section
          shortcuts. The Privacy Policy row is right above it and links here
          for portability ("Download a complete copy of your data…"), so the
          control it promises has to be the next thing you see, not something
          you scroll a list of shortcuts to reach. */}
      <DataExportCard />

      {/* Jump to a section.
          THIS USED TO BE THE PROBLEM. The tab carried four accordions holding
          ~17 hand-written summaries of the cancellation windows, strike ladders,
          fee split, dispute steps, budget limits and verification rules — every
          one of which is also stated, in different words, on /legal. Two copies
          of a policy that describes how real money moves is not a convenience;
          it is a second thing to keep in sync, and it had already drifted (the
          tab restated the urgent fee as a platform charge while Terms says that
          money goes to the Helpr, and described sales tax on a different base
          than the Community Rules do).

          So the summaries are gone and these rows point at the canonical
          section instead. `/legal` owns the text; this tab owns getting you
          there. The two things that lived ONLY here — the conduct basics, and
          the Job Boost / Tipping fee statements — were moved verbatim into
          CommunitySection and TermsSection rather than deleted with the rest.

          Deep links carry the tab AND the section hash; PolicySection
          auto-expands and scrolls to a matching `anchorId`. */}
      <div className="space-y-2">
        <h2 className="font-display font-bold text-foreground text-ds-13 px-1 pt-1">
          Jump to a section
        </h2>
        {([
          { to: "/legal?tab=community#basics", icon: Building2, title: "Community guidelines" },
          { to: "/legal?tab=community#posting-accepting", icon: Clock, title: "Budget limits, editing & new-Helpr limits" },
          { to: "/legal?tab=community#cancellations", icon: XCircle, title: "Cancellations, response times & no-shows" },
          { to: "/legal?tab=community#escrow-release", icon: Wallet, title: "Escrow & how your payout is released" },
          { to: "/legal?tab=terms#payment-escrow-fees", icon: DollarSign, title: "Platform fees & the split fee model" },
          { to: "/legal?tab=terms#subscription-tiers", icon: Crown, title: "Membership tiers & pricing" },
          { to: "/legal?tab=community#disputes", icon: Scale, title: "Revisions, disputes & admin review" },
          { to: "/legal?tab=community#strikes-bans", icon: Siren, title: "Strikes, bans & how we detect violations" },
          { to: "/legal?tab=community#money-taxes", icon: HeartPulse, title: "Money & taxes" },
        ]).map(({ to, icon: Icon, title }) => (
          <Link
            key={to}
            to={to}
            className="glass-press flex items-center gap-3 rounded-2xl liquid-glass squircle px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            {/* Smaller badge than the three anchor-doc cards above: same
                anatomy, one step down the hierarchy, so a section shortcut
                never reads as loud as a whole policy document. */}
            <div className="w-8 h-8 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" strokeWidth={2.25} aria-hidden />
            </div>
            <p className="flex-1 min-w-0 font-sans font-semibold text-foreground text-ds-13 leading-snug">
              {title}
            </p>
            <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
