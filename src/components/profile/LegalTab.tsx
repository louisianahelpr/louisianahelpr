import { type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TermsContent } from "@/pages/legal/TermsSection";
import { CommunityContent } from "@/pages/legal/CommunitySection";
import { PrivacyContent } from "@/pages/legal/PrivacySection";
import {
  type TabKey,
  VALID_TABS,
  TAB_LABELS,
  TAB_ICONS,
} from "@/pages/legal/legalSections";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";

// THIS TAB STATES NO POLICY OF ITS OWN. It composes the three policy
// documents (the GDPR/CCPA data export lives inside the Privacy one).
//
// It used to render its own accordion summaries of the fee split, cancellation
// windows, strike ladders and dispute steps — a second, hand-maintained wording
// of copy that /legal already owned. That is why it imported TIER_PERKS,
// moneyLimits and the shared PolicySection primitives; none of that belongs
// here now. If a policy needs to change, it changes in src/pages/legal/ and
// this tab needs no edit at all.

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
 * date_of_birth, phone, location) runs on every protected route. `/profile` is
 * no exception: it is bounced to `/complete-profile` when any of
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
    // The shell itself is ProfileTabBody, shared with every other tab; the
    // clearance is its one named prop, because a vertical inset cannot reopen
    // the horizontal gutter the owner reported on 2026-09-19. Asserted by
    // profileTabShell.test.ts.
    <ProfileTabBody bottomClearance="calc(env(safe-area-inset-bottom, 0px) + 6rem)">
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
          // `px-1 py-0`, not `p-1` (Q190/Q191): the track is transparent, so its
          // vertical padding painted nothing and only pushed the pills 4px
          // under the shared 12px title gap (measured 16). A negative margin
          // cannot pull them up — it collapses into the header's own
          // -mb-[var(--section-gap)] — so the padding goes, and the 4px it gave
          // the document below moves onto the panel's margin (mt-2 -> mt-3).
          className="flex items-center gap-1 sm:gap-2 rounded-2xl px-1 py-0 h-auto bg-transparent border-0 w-full"
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
          <TabsContent key={key} value={key} className="mt-3">
            <motion.div key={`${key}-panel`} {...fadeMotion}>
              {POLICY_CONTENT[key]}
            </motion.div>
          </TabsContent>
        ))}
      </Tabs>

      {/* No "Download your data" card here any more (owner, 2026-09-14,
          VN-47). It sat under every document, below that document's own
          "Questions? Contact support" footer, and added a second "contact
          support" link. The export now lives inside the Privacy Policy
          (`DataExportCard`, rendered by PrivacyContent), so on this tab it is
          in the Privacy panel. */}
    </ProfileTabBody>
  );
}
