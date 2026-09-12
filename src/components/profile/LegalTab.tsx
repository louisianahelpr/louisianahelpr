import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Download, Loader2 } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { report } from "@/lib/errorLogger";
import { hapticError } from "@/lib/haptics";
import { saveOrShareFile } from "@/lib/fileExport";
import { toast } from "sonner";
import { TermsContent } from "@/pages/legal/TermsSection";
import { CommunityContent } from "@/pages/legal/CommunitySection";
import { PrivacyContent } from "@/pages/legal/PrivacySection";
import {
  type TabKey,
  VALID_TABS,
  TAB_LABELS,
  TAB_ICONS,
} from "@/pages/legal/legalSections";

// The same lazy import Profile and AccountBanned use: the dialog chunk and its
// confirm-flow deps are fetched only if the user actually opens it.

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

      // THE HANDOFF USED TO BE A NO-OP ON THE PLATFORM THIS APP SHIPS ON.
      // It was `URL.createObjectURL` → `<a download>` → `.click()` →
      // `revokeObjectURL`. Capacitor serves bundled `dist/` from WKWebView,
      // which honours neither the `download` attribute nor a `blob:`
      // navigation, so on iOS the tap spun, fetched every row, threw nothing,
      // logged nothing — and produced no file. That is not just a bug here:
      // the Privacy Policy and the iOS App Store privacy listing both point
      // users at this control in writing for GDPR Art. 20 / CCPA portability,
      // and `/data-rights` redirects to it. A data-export button that silently
      // does nothing is a compliance problem.
      //
      // `saveOrShareFile` picks the route the platform actually supports
      // (native: stage a real file, share the `file://` URI so iOS offers Save
      // to Files / Mail; web: the anchor download) and toasts on every failure
      // path. See src/lib/fileExport.ts.
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const ok = await saveOrShareFile({
        blob,
        filename: `helpr-data-export-${new Date().toISOString().split("T")[0]}.json`,
        label: "your data export",
        source: "LegalTab.exportData",
      });
      // saveOrShareFile owns the failure toast and the telemetry, so this adds
      // only the haptic the rest of this handler gives a failure. A cancelled
      // share sheet also lands here and stays silent, which is correct — the
      // user dismissed it on purpose.
      if (!ok) hapticError();
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
      {/* Same card anatomy as the document row above (liquid-glass squircle,
          10x10 primary icon badge, display title + muted body) so the tab
          reads as one surface — but no hover-lift, because this card ACTS
          rather than navigates and shouldn't borrow a link's affordance. */}
      <section className="rounded-2xl liquid-glass squircle p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Download className="w-4 h-4" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            {/* id is what the wrapping <section> in LegalTab points its
                aria-labelledby at, so the data-rights block is named by this
                heading instead of carrying a second, duplicate label. */}
            <h2
              id="legal-data-export"
              className="font-display font-bold text-foreground leading-tight text-ds-15"
            >
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

/**
 * Account deletion, on the ONE profile route an incomplete profile can open.
 *
 * WHY THIS IS HERE AND NOT ONLY ON THE PROFILE LANDING.
 *
 * Apple requires in-app account deletion (Guideline 5.1.1(v)) and App Review
 * may exercise it. Until this card, the only two entry points were the Profile
 * LANDING tab (`profileLanding/SettingsSection.tsx`) and `/account-banned` —
 * and there is a third account state that can reach neither.
 *
 * `ProtectedRoute`'s "Big 7" completeness gate (full_name, avatar_url,
 * date_of_birth, phone, location) sits OUTSIDE its `!allowUnapproved` block, so
 * `allowUnapproved` does not exempt a route from it. `/profile` is
 * `allowUnapproved` and is still bounced to `/complete-profile` when any of
 * those five is blank. The only escape is `isProfileGateAllowed()`, which
 * permits exactly one profile address — `/profile` with `?tab=legal`, i.e. this
 * screen. So an account with an incomplete profile had to supply MORE personal
 * data (a photo, a date of birth, a phone number) before it was allowed to
 * erase itself, which is the inverse of both 5.1.1(v) and GDPR Art. 17.
 *
 * Measured against prod on 2026-09-03, not inferred: 10 of 40 profiles were in
 * that state. It is structural for Sign in with Apple — private relay supplies
 * no name and no photo, so `avatar_url` is null by default.
 *
 * The Privacy Policy already promises this in writing ("Permanently delete your
 * account and personal data yourself", `PrivacySection.tsx`), and `/data-rights`
 * redirects here — so this is the screen where that promise has to be keepable,
 * for the same reason the export control sits outside the tab band.
 *
 * Same hook and same dialog as the other two entry points, never a second copy
 * of the handler — see `useDeleteAccount` for the drift incident that rule
 * exists for.
 */

// ---------- Documents ----------

/**
 * ONE DOCUMENT ON SCREEN AT A TIME, AND IT IS THE REAL TEXT.
 *
 * Owner, 2026-08-31 on a real device: "Legal is still all tangled together.
 * Should be similar to the public legal pages." Then again, 2026-09-11: "how
 * many times have i said this needs to b similar to the logged out screens
 * yet it looks nothing like it."
 *
 * It did not look like it because it was a different KIND of screen. The
 * public page is [title] → [Terms | Rules | Privacy] → one policy, in full.
 * This tab had adopted the first two parts and then, where the policy should
 * be, rendered a card linking OUT to /legal plus a list of deep links into
 * it — a directory dressed as the page it was a directory for. That is also
 * the redirection the owner banned outright ("there should not be any
 * redirection back to public pages once they are signed in", 2026-08-30).
 *
 * Both halves now come from one place: `VALID_TABS` / `TAB_LABELS` /
 * `TAB_ICONS` (pages/legal/legalSections) fix the band's order, names and
 * glyphs, and `TermsContent` / `CommunityContent` / `PrivacyContent` are the
 * exact elements `pages/Legal.tsx` mounts. The two surfaces cannot drift into
 * a different order, a different name, or — the one that matters — a
 * different wording of a clause someone has agreed to.
 *
 * STILL NO POLICY OF ITS OWN. This file states nothing; it composes. If a
 * clause changes it changes in src/pages/legal/ and this file needs no edit.
 */
const POLICY_CONTENT: Record<TabKey, ReactNode> = {
  terms: <TermsContent />,
  community: <CommunityContent />,
  privacy: <PrivacyContent />,
};

// ---------- Page ----------

/** Which document panel is open, mirrored to `?doc=` so it is deep-linkable. */
const DOC_PARAM = "doc";

export function LegalTab({ onBack }: { onBack: () => void }) {
  // `?doc=` sits alongside Profile's own `?tab=legal` — Profile.tsx syncs its
  // tab through `new URLSearchParams(prev)`, so it carries this param through
  // untouched, and back/forward lands on the document you were reading.
  // Defaults to `terms`, exactly as /legal does (`params.get("tab") || "terms"`).
  const [params, setParams] = useSearchParams();
  const docParam = params.get(DOC_PARAM) as TabKey | null;
  const doc: TabKey = docParam && VALID_TABS.includes(docParam) ? docParam : "terms";
  const setDoc = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set(DOC_PARAM, next);
    // replace, not push: Profile PUSHES when you open a tab, so Back should
    // leave Legal & Policies rather than walk you back through every document
    // you glanced at.
    setParams(nextParams, { replace: true });
  };

  // Users who ask the OS to reduce motion get the pill snapped into place and
  // the panel swapped without a slide, rather than spring-animated.
  const reduceMotion = useReducedMotion();
  const fadeMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    // Safe-area-aware bottom padding (~6rem) so the last row scrolls clear of
    // the MobileNav dock + FAB on iPhone without leaving a large empty
    // dead-zone below it.
    //
    // The `space-y-4` on this wrapper is the shared Profile-tab shell and is
    // asserted byte-for-byte by profileTabShell.test.ts, which locates the last
    // className-bearing div opened above the tab header element. Keep the class
    // exactly `space-y-4`, keep this div immediately above that header, and do
    // not write the header's tag name inside a comment — the test's indexOf
    // would find the comment instead and read the wrong wrapper.
    <div
      className="space-y-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
    >
      <ProfileTabHeader
        title="Legal &amp; Policies"
        onBack={onBack}
      />

      {/* THE TAB BAND — the same control the public /legal page opens with,
          reading its order, labels and glyphs from the same module. Radix
          unmounts the inactive panels, so exactly one document is in the DOM
          at a time; that, rather than a rule or a counter, is what keeps the
          three from tangling.

          Triggers are 44px tall (`h-11`) rather than /legal's 36px: this is
          the native in-app surface, where every tap target has to clear the
          44pt minimum. */}
      <Tabs value={doc} onValueChange={setDoc} className="w-full">
        <TabsList
          aria-label="Legal document"
          className="flex items-center gap-1 sm:gap-2 rounded-2xl p-1 h-auto bg-transparent border-0 w-full"
        >
          {VALID_TABS.map((key) => {
            const isActive = key === doc;
            const Icon = TAB_ICONS[key];
            return (
              <TabsTrigger
                key={key}
                value={key}
                className="relative h-11 inline-flex flex-1 min-w-0 items-center justify-center gap-1 sm:gap-1.5 rounded-ds-md text-ds-11 sm:text-ds-13 font-sans font-semibold leading-none transition-colors duration-200 px-1"
                style={{
                  color: isActive ? "hsl(var(--parchment))" : "hsl(var(--olivewood))",
                  // data-[state=active]:bg-background (parchment) causes the axe walk
                  // algorithm to see 1:1 contrast; override it so both walk and pixel
                  // methods see a dark background behind the parchment label.
                  ...(isActive ? { backgroundColor: "hsl(var(--bark))" } : {}),
                }}
              >
                {/* A single lifted pill that slides between tabs via framer's
                    shared-layout (`layoutId`) — only the active trigger mounts
                    it, so switching documents animates the sliding border+shadow
                    across. `btn-grad-primary` is the shared primary-CTA surface,
                    so the selected document reads as a glossy primary control and
                    can never drift from the canonical gradient. Distinct layoutId
                    from /legal's `legalTabPill`: the two bands are never mounted
                    together, and a shared id across routes is how a pill flies in
                    from an unrelated screen. */}
                {isActive && (
                  <motion.span
                    layoutId="legalDirectoryTabPill"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-ds-md btn-grad-primary"
                    style={{
                      border: "1px solid hsl(var(--bark-border))",
                      boxShadow:
                        "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
                        "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
                        "0 2px 6px hsl(var(--ink-deep) / 0.12), " +
                        "0 4px 12px -2px hsl(var(--ink-deep) / 0.08)",
                    }}
                  />
                )}
                <Icon className="relative w-3.5 h-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                <span className="relative truncate">{TAB_LABELS[key]}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* THE POLICY TEXT ITSELF — the SAME components /legal renders.

            This used to be a DIRECTORY: a card per document linking out to
            /legal, plus a "Jump to a section" list of deep links. Two things
            were wrong with it. It is precisely the bounce the owner forbade
            ("there should not be any redirection back to public pages once
            they are signed in", 2026-08-30), and it looked nothing like the
            page it pointed at — which the owner has now said many times,
            latterly "how many times have i said this needs to b similar to
            the logged out screens yet it looks nothing like it".

            SHARED, NOT COPIED. `TermsContent` / `CommunityContent` /
            `PrivacyContent` are the very elements `pages/Legal.tsx` mounts,
            so there is exactly one wording of every clause in the codebase. A
            second copy of legal text is a compliance hazard before it is a
            drift hazard: the signed-in and signed-out readers would be
            agreeing to different documents.

            The chrome differs and should: this is the in-app tab shell
            (ProfileTabHeader + 44px triggers), that is the public page shell
            (PublicHeaderPage + its own search). The CONTENT is identical. */}
        {VALID_TABS.map((key) => (
          <TabsContent key={key} value={key} className="mt-2">
            <motion.div key={`${key}-panel`} {...fadeMotion}>
              {POLICY_CONTENT[key]}
            </motion.div>
          </TabsContent>
        ))}
      </Tabs>

      {/* DATA RIGHTS SIT OUTSIDE THE TAB BAND, not inside the Privacy panel.
          They used to live under the Privacy block, on the reasoning that the
          right belongs to the document that grants it — true, and still stated
          by the footnote inside the card. But once the documents stopped
          stacking, "inside Privacy" became "two taps away and invisible from
          the default panel", and `/data-rights` redirects to
          `/profile?tab=legal` with no `?doc=` (App.tsx) — so it would have
          landed on Terms with the export nowhere on screen. The Privacy Policy
          and the iOS App Store privacy listing both point at that URL IN
          WRITING, so the control it promises has to be visible wherever that
          redirect lands. It is a control, not a policy document, so it is the
          one thing on this screen that is not behind the band.

          The hairline rule + top padding are what separate it from whichever
          document is open; it is labelled by the card's own "Download your
          data" heading rather than a second heading of its own. */}
      <section
        aria-labelledby="legal-data-export"
        className="pt-4"
        style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.14)" }}
      >
        <DataExportCard />
      </section>
    </div>
  );
}
