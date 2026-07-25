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
  TAB_TOC,
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
  // Search starts collapsed to an icon — the sticky header stays light for
  // the primary action (reading Terms/Rules/Privacy); tapping the icon
  // reveals the input. Opening auto-focuses it; clearing the query (via the
  // input's own X) does NOT auto-collapse, so a user isn't fighting a
  // closing bar mid-edit — they collapse it explicitly.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasResults, setHasResults] = useState(true);
  const isSearching = !!query.trim();

  // Active TOC entry (WEB, lg+). We observe each PolicySection anchor in the
  // active tab and mark the top-most visible one as active so the sidebar
  // reads as "here is where you are in the document." Only runs outside of
  // search (search view renders all three tabs and hides the TOC).
  const [activeTocId, setActiveTocId] = useState<string>("");
  useEffect(() => {
    if (isSearching) return;
    if (typeof window === "undefined") return;
    const entries = TAB_TOC[tab] ?? [];
    if (entries.length === 0) return;
    // Scroll-position scrollspy, NOT IntersectionObserver. The sections are
    // COLLAPSED accordions, so all five headers sit inside a ~250px stack. The
    // old observer band (`rootMargin: "-15% 0px -65% 0px"` — only 20% of the
    // viewport tall) stopped matching any target the moment you scrolled past
    // that stack, and since the callback no-ops when nothing intersects, the
    // indicator froze. Measured: it stuck on section 2 of 5 at scrollY 300, 700
    // AND 965 (page bottom) and never advanced.
    //
    // Picking the LAST heading whose top has crossed the band is deterministic
    // at every scroll offset — including the very bottom, where it correctly
    // resolves to the final section instead of freezing.
    let tickRaf = 0;
    let targets: HTMLElement[] = [];
    const compute = () => {
      tickRaf = 0;
      if (targets.length === 0) return;
      // Bottom-snap. With every accordion COLLAPSED the five section headers
      // occupy only ~250px of an ~1865px document, so the later ones can never
      // scroll up into the band — the page isn't tall enough. Without this the
      // TOC tops out at section 2 no matter how far you scroll. Once the
      // viewport reaches the end of the document the reader is by definition at
      // the last section, so activate it.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        setActiveTocId(targets[targets.length - 1].id);
        return;
      }
      const band = window.innerHeight * 0.15;
      let current = targets[0].id;
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= band) current = el.id;
      }
      setActiveTocId(current);
    };
    const onScroll = () => {
      if (tickRaf) return;
      tickRaf = requestAnimationFrame(compute);
    };
    // Wait one paint so freshly-mounted sections are in the DOM — otherwise
    // tab-switching would resolve zero targets and the TOC would never light up.
    const raf = requestAnimationFrame(() => {
      targets = entries
        .map((e) => document.getElementById(e.id))
        .filter((el): el is HTMLElement => !!el);
      if (targets.length === 0) return;
      compute(); // seed immediately so the TOC is never blank on first paint
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (tickRaf) cancelAnimationFrame(tickRaf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [tab, isSearching]);

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
          {/* Hero H1 fades + slides on tab change — keyed by tab so
              React remounts the motion element every time. */}
          <motion.h1
            key={`h1-${tab}`}
            {...(reduceMotion
              ? {}
              : {
                  initial: { opacity: 0, y: 12 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
                })}
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
          </motion.h1>
        </div>

        <motion.p
          key={`sub-${tab}`}
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 12 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] as const },
              })}
          className="max-w-xl lg:max-w-3xl text-ds-15 sm:text-ds-17 lg:text-ds-20 leading-relaxed text-balance"
          style={{
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 400,
            letterSpacing: "-0.005em",
            color: "hsl(var(--stormy-sky))",
          }}
        >
          {HERO_SUBHEADS[tab]}
        </motion.p>

        {/* Wide-tracked small caps "last updated" — fades in with the
            same tab-change transition so the whole hero animates as one. */}
        <motion.span
          key={`updated-${tab}`}
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 12 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] as const },
              })}
          className="font-sans font-medium uppercase tabular-nums text-[0.7rem] sm:text-[0.75rem]"
          style={{
            color: "hsl(var(--olivewood) / 0.7)",
            letterSpacing: "0.22em",
          }}
        >
          Last updated · {LAST_UPDATED[tab]}
        </motion.span>
      </div>
    </section>
  );

  // Compact (icon-only, auto-width) while search is open — the tabs stay
  // visible rather than disappearing, they just shrink to make room for the
  // search input instead of splitting the row evenly with it.
  const tabBar = (
    <TabsList
      data-print-hide
      className={
        searchOpen
          ? "inline-flex items-center gap-1 rounded-2xl p-1 h-auto bg-transparent border-0"
          : "grid w-full grid-cols-3 items-center gap-1 rounded-2xl p-1 h-auto bg-transparent border-0"
      }
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

  // Collapsed trigger — rendered as part of the SAME row as the Terms/Rules/
  // Privacy toggle (not floating separately below it), so it reads as one
  // connected control instead of a disconnected icon in empty space.
  const searchToggle = !searchOpen && (
    <button
      type="button"
      onClick={() => {
        setSearchOpen(true);
        // Focus after the input mounts (searchOpen flips to true this
        // render, the ref attaches next paint).
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }}
      aria-label="Search all policies"
      data-print-hide
      className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full btn-press hover:bg-primary/5"
      style={{ color: "hsl(var(--olivewood))" }}
    >
      <Search className="w-4 h-4" />
    </button>
  );

  // Expanded input — replaces the toggle in-place within the header row once
  // open (see the two render sites below), instead of appearing disconnected
  // further down the page.
  const searchBar = searchOpen && (
    <div className="relative flex-1 min-w-[220px]" data-print-hide>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      />
      <input
        ref={searchInputRef}
        type="text"
        aria-label="Search all policies"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search all policies…"
        className="w-full h-10 rounded-ds-md pl-9 pr-9 text-ds-13 font-sans bg-card outline-none transition-shadow focus:ring-2 focus:ring-inset"
        style={{
          border: "1px solid hsl(var(--bark) / 0.18)",
          color: "hsl(var(--ink-deep))",
        }}
      />
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setSearchOpen(false);
        }}
        aria-label="Close search"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full btn-press hover:bg-primary/5"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        <X className="w-4 h-4" />
      </button>
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

  // Smooth cross-tab transition — each panel fades + slides in on mount.
  // Radix TabsContent unmounts inactive tabs, so switching tabs remounts
  // the new panel, which triggers the `initial → animate` sequence. Also
  // fades the hero copy (eyebrow/title/subhead/updated chip) via keyed
  // motion.div wrapper further down.
  const fadeMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
      };
  const panels = (
    <>
      <TabsContent value="terms" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <motion.div key="terms-panel" {...fadeMotion}>
          <TermsContent />
        </motion.div>
      </TabsContent>
      <TabsContent value="community" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <motion.div key="community-panel" {...fadeMotion}>
          <CommunityContent />
        </motion.div>
      </TabsContent>
      <TabsContent value="privacy" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <motion.div key="privacy-panel" {...fadeMotion}>
          <PrivacyContent />
        </motion.div>
      </TabsContent>
    </>
  );

  // Search input + filtered policy tree, shared by both layouts. The
  // PolicySearchContext provider drives the self-filtering sections; the
  // tagline is editorial framing so it hides while a query is active.
  const body = (
    <PolicySearchContext.Provider value={query}>
      <div ref={contentRef} className="mt-4 space-y-4">
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
              <div className="flex flex-wrap items-center gap-2">
                {/* flex-wrap: search input + full-labeled tabs together can
                    exceed the row width on narrower viewports — wrapping to a
                    second line beats letting content spill past the pill's
                    rounded border. Search leads the row. Tabs stay visible
                    either way — full-width when closed, auto-width (labels
                    intact) when
                    open so the input can take the freed-up space instead of
                    splitting the row evenly with a full-size tab list. */}
                {searchBar}
                {searchToggle}
                <div className={searchOpen ? "shrink-0" : "flex-1 min-w-0"}>{tabBar}</div>
              </div>
              {body}
            </div>
          </div>
        </AppShell>
      </Tabs>
    );
  }

  // Desktop TOC sidebar — only on lg+, only outside search (search view renders
  // all three tabs at once, so a single-tab TOC would be misleading). Enumerates
  // the current tab's PolicySection anchors from TAB_TOC, highlights the section
  // closest to the viewport top (via the IntersectionObserver above), and
  // smooth-scrolls the corresponding section into view when clicked.
  const tocSidebar = (
    <nav
      aria-label="On this page"
      className="hidden lg:block lg:sticky lg:top-32 lg:self-start"
    >
      <span
        className="block font-sans font-semibold uppercase text-[0.62rem] mb-3 pl-3"
        style={{
          color: "hsl(var(--burnt-sienna))",
          letterSpacing: "0.22em",
        }}
      >
        On this page
      </span>
      <ul className="border-l border-[hsl(var(--bark)/0.18)] space-y-0.5">
        {(TAB_TOC[tab] ?? []).map((entry) => {
          const active = entry.id === activeTocId;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  // Use hash navigation so the existing PolicySection
                  // hashchange listener auto-opens the collapsible; then
                  // smooth-scroll into view for a docs-style feel.
                  window.history.replaceState(null, "", `#${entry.id}`);
                  window.dispatchEvent(new HashChangeEvent("hashchange"));
                  const el = document.getElementById(entry.id);
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="block -ml-px pl-4 pr-2 py-1.5 text-ds-13 font-sans transition-colors leading-snug border-l-2"
                style={{
                  color: active
                    ? "hsl(var(--burnt-sienna))"
                    : "hsl(var(--olivewood) / 0.85)",
                  borderLeftColor: active
                    ? "hsl(var(--burnt-sienna))"
                    : "transparent",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {entry.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );

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
              className="sticky z-30 -mx-5 px-5 pt-2 pb-2.5 backdrop-blur-md"
              style={{ top: webBandStickyTop }}
            >
              <div
                className="rounded-2xl flex flex-wrap items-center gap-2 p-1"
                style={{ border: "1px solid hsl(var(--bark) / 0.18)" }}
              >
                {/* flex-wrap: search input + full-labeled tabs together can
                    exceed the row width on narrower viewports — wrapping to a
                    second line beats letting content spill past the pill's
                    rounded border. Search leads the row. Tabs stay visible either way —
                    full-width when closed, shrunk to icon-only pills when
                    open so the input can take the freed-up space instead of
                    splitting the row evenly with a full-size tab list. */}
                {searchBar}
                {searchToggle}
                <div className={searchOpen ? "shrink-0" : "flex-1 min-w-0"}>{tabBar}</div>
              </div>
            </div>
            {/* On lg+ split into TOC sidebar + body. TOC hides while
                searching (body then renders all three policies at once
                and the single-tab TOC would be misleading). Below lg the
                body flows full-width — the TOC has `hidden lg:block`. */}
            {isSearching ? (
              body
            ) : (
              <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-12">
                {tocSidebar}
                <div className="min-w-0">{body}</div>
              </div>
            )}
          </div>
        </div>
      </Tabs>
    </PublicLayout>
  );
};

export default Legal;
