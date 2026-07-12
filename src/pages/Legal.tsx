import { useState, useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Search, X } from "lucide-react";
import PublicLayout from "@/components/marketing/PublicLayout";
import AppShell from "@/components/AppShell";
import { isNativePlatform } from "@/lib/nativeInit";
import BackButton from "@/components/BackButton";
import { PolicySearchContext, PolicyTabContext } from "@/components/policy/CollapsedPolicy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { TermsContent } from "./legal/TermsSection";
import { CommunityContent } from "./legal/CommunitySection";
import { PrivacyContent } from "./legal/PrivacySection";
import {
  type TabKey,
  VALID_TABS,
  PAGE_TITLES,
  PAGE_DESCRIPTIONS,
  PAGE_CANONICALS,
  TAB_TAGLINES,
  TAB_LABELS,
  TAB_ICONS,
  TAB_ORIGIN_LABELS,
  LAST_UPDATED,
} from "./legal/legalSections";

/* ─────────────────────────  EDITORIAL HERO COPY  ───────────────────────── */
// Per-tab hero content — mirrors the landing hero pattern (small-caps eyebrow,
// Bodoni H1 with italic burnt-sienna accent, one-line Montserrat subhead).
// Copy is editorial framing only; every clause of the legal text below is
// preserved verbatim inside TermsContent / CommunityContent / PrivacyContent.
const HERO_EYEBROWS: Record<TabKey, string> = {
  terms: "Terms of service",
  community: "Community rules",
  privacy: "Privacy policy",
};

// H1 is split into a leading phrase + a trailing italic burnt-sienna accent.
// Together they always end in a period so the headline reads as a poster
// statement (matches the "Louisiana's Local Job Partner." landing pattern).
const HERO_TITLES: Record<TabKey, { lead: string; accent: string }> = {
  terms: { lead: "Terms of", accent: "service." },
  community: { lead: "Community", accent: "rules." },
  privacy: { lead: "Privacy", accent: "policy." },
};

// One-line Montserrat subhead. Distinct from TAB_TAGLINES (which is the small
// italic dek shown between the tab strip and the policy sections) — this is
// the wider poster-scale subhead pinned under the halo.
const HERO_SUBHEADS: Record<TabKey, string> = {
  terms:
    "The agreement you accept when you use Helpr — eligibility, escrow, fees, and liability.",
  community:
    "How we keep jobs fair, safe, and accountable — cancellations, disputes, strikes, and bans.",
  privacy:
    "What we collect, why, and the control you keep. We never sell your personal data.",
};

/* ─────────────────────────  WARM HALO  ───────────────────────── */
// Reusable ambient halo behind the H1 — identical recipe to the landing hero
// (gold-warm 0.24 → burnt-sienna 0.10 → transparent, blur 32) so /legal reads
// as cut from the same paper as /, /help, /for-business, and /subscription.
const WarmHalo = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute -inset-16 sm:-inset-24 lg:-inset-32 -z-0"
    style={{
      background:
        "radial-gradient(50% 50% at 50% 50%, hsl(var(--gold-warm) / 0.24) 0%, hsl(var(--burnt-sienna) / 0.10) 40%, transparent 75%)",
      filter: "blur(32px)",
    }}
  />
);

// Tab → content element, used by the cross-tab search view (which renders
// all three at once). Outside of search, the panels render these inside
// their respective Radix TabsContent instead.
const TAB_CONTENT: Record<TabKey, ReactNode> = {
  terms: <TermsContent />,
  community: <CommunityContent />,
  privacy: <PrivacyContent />,
};

/* ─────────────────────────  PAGE  ───────────────────────── */
const Legal = () => {
  const [params, setParams] = useSearchParams();
  const tabParam = (params.get("tab") || "terms") as TabKey;
  const tab: TabKey = VALID_TABS.includes(tabParam) ? tabParam : "terms";

  // Cross-section policy search. The query feeds PolicySearchContext, which
  // every PolicySection / PolicyRowItem self-filters against. `hasResults`
  // is derived after render by counting the section cards that survived the
  // filter, so we can show a clean empty state when nothing matches.
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasResults, setHasResults] = useState(true);
  const isSearching = !!query.trim();

  // Users who ask the OS to reduce motion get the pill snapped into place
  // rather than spring-sliding between tabs.
  const reduceMotion = useReducedMotion();

  // WEB: the tab band pins to the very top of the viewport on scroll. We do
  // NOT offset by the marketing Navbar's height: that Navbar is `position:
  // fixed`, but the global Framer page-transition wrapper sets `will-change:
  // transform`, which makes the wrapper a containing block — so the Navbar
  // anchors to it and scrolls away with the page instead of staying pinned.
  // Offsetting by 3.5rem therefore left an empty strip above the band where
  // later content (search / tagline) leaked through. top: 0 closes that gap.
  const webBandStickyTop = "0px";

  // Switching tabs is a fresh document: drop any active search and jump back
  // to the top (native scrolls AppShell's internal container; web scrolls the
  // window). Without this, deep-scrolling Privacy then tapping Terms would
  // land you mid-page.
  useEffect(() => {
    setQuery("");
    if (isNativePlatform) {
      scrollRef.current?.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [tab]);

  // Count surviving section cards once the filtered tree has painted.
  useEffect(() => {
    if (!query.trim()) {
      setHasResults(true);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const n = contentRef.current?.querySelectorAll("[data-policy-section]").length ?? 0;
      setHasResults(n > 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [query, tab]);

  // usePageMeta is keyed on every field, so switching tabs re-runs the
  // effect and updates title, description, and canonical together.
  usePageMeta({
    title: PAGE_TITLES[tab],
    description: PAGE_DESCRIPTIONS[tab],
    canonical: PAGE_CANONICALS[tab],
    ogTitle: PAGE_TITLES[tab],
    ogDescription: PAGE_DESCRIPTIONS[tab],
  });

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  // NATIVE header: back button + compact per-tab title. AppShell space is
  // tight and users are already inside the app chrome, so we keep the tight
  // stacked layout — the editorial hero is a WEB-only affordance. No explicit
  // `to` on BackButton: it falls back to history.back(), which works for
  // authenticated users from /profile?tab=legal and unauthenticated visitors
  // from the signup agreement checkbox.
  const nativeHeaderRow = (
    <div className="flex items-center gap-3">
      <div data-print-hide className="shrink-0"><BackButton /></div>
      <div className="flex flex-col leading-none min-w-0 mb-1">
        <span
          className="font-serif italic uppercase text-[0.62rem]"
          style={{
            color: "hsl(var(--burnt-sienna))",
            letterSpacing: "0.18em",
          }}
        >
          {HERO_EYEBROWS[tab]}
        </span>
        <h1 className="text-page-title leading-tight mt-1 text-balance">
          {HERO_TITLES[tab].lead}{" "}
          <em
            style={{
              fontStyle: "italic",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            {HERO_TITLES[tab].accent}
          </em>
        </h1>
      </div>
    </div>
  );

  // WEB editorial hero: matches the landing / help / for-business / membership
  // hero pattern exactly — eyebrow small-caps, Bodoni H1 with italic
  // burnt-sienna accent, warm ambient halo (same recipe as HeroSection.tsx),
  // one-line Montserrat subhead, and a wide-tracked "Last updated" chip.
  // A small back button floats above the composition so users still have the
  // return path they had before, but visually it stays out of the poster.
  const webHero = (
    <section className="relative overflow-hidden px-5 sm:px-8 lg:px-12 pt-16 sm:pt-20 lg:pt-24 pb-8 sm:pb-10 lg:pb-12">
      <div className="relative z-10 w-full mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] flex flex-col items-center text-center gap-6 sm:gap-8 lg:gap-10">
        {/* BackButton removed — PublicLayout renders a global
            "Back to home" link at the top of every non-landing public
            page, so the inline one was doubling up.
            Eyebrow simplified to "LEGAL" so the H1 below doesn't
            duplicate the same phrase. */}

        <div className="relative flex flex-col items-center justify-center w-full">
          <WarmHalo />
          <span className="text-display-eyebrow relative z-10 mb-5 sm:mb-6">
            Legal
          </span>
          <h1
            className="relative z-10 font-display font-black leading-[0.98] text-balance break-words text-[2.75rem] sm:text-[4rem] md:text-[5rem] lg:text-[5.5rem] xl:text-[6.25rem]"
            style={{
              color: "hsl(var(--olivewood))",
              letterSpacing: "-0.03em",
            }}
          >
            {HERO_TITLES[tab].lead}{" "}
            <em
              className="relative inline-block"
              style={{
                fontStyle: "italic",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              {HERO_TITLES[tab].accent}
            </em>
          </h1>
        </div>

        <p
          className="max-w-xl lg:max-w-3xl text-ds-15 sm:text-ds-17 lg:text-ds-20 leading-relaxed text-balance"
          style={{
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 400,
            letterSpacing: "-0.005em",
            color: "hsl(var(--stormy-sky))",
          }}
        >
          {HERO_SUBHEADS[tab]}
        </p>

        {/* Wide-tracked small caps "last updated" — mirrors the editorial
            date-line convention used on the marketing pages, and keeps the
            revision date visible before users tap into any policy tab. */}
        <span
          className="font-sans font-medium uppercase tabular-nums text-[0.7rem] sm:text-[0.75rem]"
          style={{
            color: "hsl(var(--olivewood) / 0.7)",
            letterSpacing: "0.22em",
          }}
        >
          Last updated · {LAST_UPDATED[tab]}
        </span>
      </div>
    </section>
  );

  const tabBar = (
    <TabsList
      data-print-hide
      className="grid w-full grid-cols-3 items-center gap-1 rounded-2xl p-1 h-auto bg-transparent border-0"
    >
      {VALID_TABS.map((t) => {
        const isActive = t === tab;
        const Icon = TAB_ICONS[t];
        return (
          <TabsTrigger
            key={t}
            value={t}
            className="relative h-9 inline-flex items-center justify-center gap-1.5 rounded-ds-md text-ds-13 font-sans font-semibold leading-none transition-colors duration-200"
            style={{ color: isActive ? "hsl(var(--parchment))" : "hsl(var(--olivewood))" }}
          >
            {/* A single lifted pill that slides between tabs via framer's
                shared-layout (`layoutId`) — only the active trigger mounts it,
                so switching tabs animates the pill across rather than hopping.
                Gradient + inset highlight + soft drop shadow give it depth. */}
            {isActive && (
              <motion.span
                layoutId="legalTabPill"
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-ds-md btn-grad-primary"
                style={{
                  // Reference the shared primary-CTA surface (`.btn-grad-primary`,
                  // the same radial-gloss treatment the "Get started"/bark CTAs
                  // use) so the selected tab reads as a primary button and can
                  // never drift from the canonical gradient. Border + ELEV_FILLED
                  // depth layered on top.
                  border: "1px solid hsl(66 24% 20%)",
                  boxShadow:
                    "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
                    "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
                    "0 2px 6px hsl(var(--ink-deep) / 0.12), " +
                    "0 4px 12px -2px hsl(var(--ink-deep) / 0.08)",
                }}
              />
            )}
            <Icon className="relative w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
            <span className="relative">{TAB_LABELS[t]}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );

  const searchBar = (
    <div className="relative" data-print-hide>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      />
      <input
        type="text"
        aria-label="Search all policies"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search all policies…"
        className="w-full h-10 rounded-ds-md pl-9 pr-9 text-ds-13 font-sans bg-card outline-none transition-shadow focus:ring-2"
        style={{
          border: "1px solid hsl(var(--bark) / 0.18)",
          color: "hsl(var(--ink-deep))",
        }}
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full btn-press hover:bg-primary/5"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const noResults = (
    <div className="text-center py-12 px-6">
      <p className="font-display font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
        No matches for “{query.trim()}”
      </p>
      <p className="mt-1 text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Try a different term or clear the search.
      </p>
    </div>
  );

  // Per-tab editorial tagline + the three policy panels. Shared by both
  // layouts; the bottom safe-area padding lets the long body scroll fully past
  // the floating dock + FAB on iPhone without clipping the last paragraph.
  const tagline = (
    <p
      className="px-1 font-serif italic leading-snug text-ds-15"
      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
    >
      {TAB_TAGLINES[tab]}
    </p>
  );

  const panels = (
    <>
      <TabsContent value="terms" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <TermsContent />
      </TabsContent>
      <TabsContent value="community" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <CommunityContent />
      </TabsContent>
      <TabsContent value="privacy" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <PrivacyContent />
      </TabsContent>
    </>
  );

  // Search input + filtered policy tree, shared by both layouts. The
  // PolicySearchContext provider drives the self-filtering sections; the
  // tagline is editorial framing so it hides while a query is active.
  const body = (
    <PolicySearchContext.Provider value={query}>
      {searchBar}
      <div ref={contentRef} className="space-y-4">
        {isSearching ? (
          // Cross-tab results: render all three policies at once so a query
          // surfaces matches wherever they live. Each surviving section
          // carries a PolicyTabContext origin chip; non-matching sections
          // self-remove, and editorial chrome (TLDR / callouts / footer)
          // hides on search, leaving a tight result list.
          <>
            {VALID_TABS.map((t) => (
              <PolicyTabContext.Provider key={t} value={TAB_ORIGIN_LABELS[t]}>
                {TAB_CONTENT[t]}
              </PolicyTabContext.Provider>
            ))}
            {!hasResults && noResults}
          </>
        ) : (
          <>
            {tagline}
            {panels}
          </>
        )}
      </div>
    </PolicySearchContext.Provider>
  );

  // NATIVE: AppShell's internal scroll container dodges the iOS bug where a
  // document-scroll `position: fixed` header detaches during momentum scroll
  // and lets text ghost into the notch. The only pinned element is a thin
  // opaque status-bar cap (carrying the safe-area inset) so scrolled content
  // is masked under the notch; the back button, title, and tabs live INSIDE
  // the scroll body, so they scroll away with the page rather than locking.
  if (isNativePlatform) {
    const statusBarCap = (
      <div
        aria-hidden
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "hsl(var(--surface-band))",
        }}
      />
    );
    return (
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <AppShell
          ref={scrollRef}
          header={statusBarCap}
          reserveBottomNav={false}
          className="bg-premium-page"
          contentClassName="bg-premium-page"
        >
          <div className="px-5 pt-3">
            <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto space-y-4">
              {nativeHeaderRow}
              {tabBar}
              {body}
            </div>
          </div>
        </AppShell>
      </Tabs>
    );
  }

  // WEB: long-form document scroll (SEO). Rendered inside the shared marketing
  // chrome (PublicLayout → Navbar + Footer + page-warmth/mesh-gradient
  // background) so /legal matches every other public page instead of drifting
  // on its own bg-premium-page surface. PublicLayout supplies the nav spacer,
  // so we drop the manual navbar top-padding; the tab band still pins to the
  // viewport top on scroll (the marketing Navbar scrolls away with the Framer
  // page-transition wrapper — see webBandStickyTop note above).
  return (
    <PublicLayout showCtaBand={false}>
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        {/* Editorial hero — full-bleed poster (halo, Bodoni H1, subhead,
            "last updated" chip) that changes copy per tab. Lives OUTSIDE the
            centered container so the halo can bleed to the edges. */}
        {webHero}

        <div className="container mx-auto px-5 pb-16 sm:pb-24 lg:pb-32 pt-4">
          <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto space-y-4">
            <div
              className="sticky z-30 -mx-5 px-5 pt-2 pb-2.5"
              style={{
                top: webBandStickyTop,
                background: "hsl(var(--surface-band))",
                borderBottom: "1px solid hsl(var(--bark) / 0.10)",
              }}
            >
              {tabBar}
            </div>
            {body}
          </div>
        </div>
      </Tabs>
    </PublicLayout>
  );
};

export default Legal;
