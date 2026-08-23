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
  TAB_LABELS,
  TAB_ICONS,
  TAB_ORIGIN_LABELS,
  LAST_UPDATED,
} from "./legal/legalSections";

/* ─────────────────────────  PER-TAB TITLE  ───────────────────────── */
// Per-tab H1 text for the NATIVE in-app header. Plain single-colour strings,
// no trailing full stop — rendered through the shared `.text-page-title`
// utility, which is literally what <PageHeader> paints on every other in-app
// screen ("Work Record", "Security", "Benefits & Perks", "Home History",
// "Host Automation", "Family & care").
//
// These used to be stored SPLIT into a leading phrase plus a trailing accent
// ({ lead: "Privacy", accent: "policy." }) and painted two-tone: first word in
// ink, second word italic burnt-sienna, closing on a period. That is
// landing-page display typography, and the three legal tabs were the only
// place in the app wearing it, so they read as a web page embedded in the
// native shell. Flattened to plain strings so the two-tone form can't come
// back by accident.
//
// This does NOT touch the marketing/landing surface: the WEB branch of this
// page renders a static "Legal" title (see `webHeader`) and never consumed
// these strings — the split map fed the native header only.
//
// Copy here is framing only; every clause of the legal text is preserved
// verbatim inside TermsContent / CommunityContent / PrivacyContent.
const TAB_TITLES: Record<TabKey, string> = {
  terms: "Terms of service",
  community: "Community rules",
  privacy: "Privacy policy",
};

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

  // (No "On this page" TOC sidebar. It listed the same section headings that
  // sit immediately to its right — every PolicySection accordion header is
  // already on screen — so it duplicated visible content and cost a 14rem
  // column. Removed along with its scrollspy.)

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

  // NATIVE header: back button + compact per-tab title.
  //
  // The markup below is the title block <PageHeader> renders, verbatim
  // (`flex items-center gap-3` > BackButton + `flex flex-col leading-none
  // min-w-0` > `h1.text-page-title.leading-tight.text-balance`), so these
  // three screens get the app's standard page title by REUSING the same
  // utility rather than re-deriving a font/size/weight. PageHeader itself is
  // not mounted here because it brings its own `mx-auto max-w-*` frame and
  // safe-area top padding, both of which this AppShell layout already
  // supplies (the container below + `statusBarCap`) — mounting it would
  // double-count them.
  const nativeHeaderRow = (
    <div className="flex items-center gap-3">
      <div data-print-hide className="shrink-0"><BackButton to="/" /></div>
      <div className="flex flex-col leading-none min-w-0 mb-1">
        <h1 className="text-page-title leading-tight text-balance">
          {TAB_TITLES[tab]}
        </h1>
      </div>
    </div>
  );

  // WEB header: the same compact row every other public page opens with —
  // [BackButton] [normal-size page title] — so /legal, /for-business,
  // /subscription, /help, and /jobs all start their title at the identical
  // vertical offset. Replaces the old full-bleed editorial hero (display
  // eyebrow, clamp() Bodoni H1 with burnt-sienna accent, warm halo, poster
  // subhead, wide-tracked "Last updated" chip), which opened /legal 64px lower
  // than every sibling page.
  //
  // "Last updated" survives in two quieter places: the tabular-nums span on the
  // right of this row (so the revision date is still visible without scrolling
  // — it's legally useful), and each policy's PolicyFooter at the end of the
  // document. The poster subhead is dropped because TAB_TAGLINES already
  // carries the same framing one line further down.
  //
  // This header and the content container below BOTH use the reference pages'
  // `px-5 sm:px-8 lg:px-12`, so Legal's left edge lines up with Help Center,
  // Support and For Business.
  //
  // They previously both used `container mx-auto px-5`. That kept the title
  // aligned with its own tab band and policy cards — the constraint the old
  // comment here defended, and a real one — but it put Legal's whole column
  // ~28px left of every sibling page at desktop, because Tailwind's
  // `container` pads 20px where the others pad 48px (lg:px-12). The header and
  // the body were changed together, so the internal alignment that mattered is
  // preserved and the cross-page mismatch is gone. Change them as a pair.
  const webHeader = (
    <section className="px-5 sm:px-8 lg:px-12">
      <div className="page-measure mx-auto">
        <div className="flex items-center gap-3 mt-6 mb-6 md:mt-8 md:mb-8">
          <div data-print-hide className="shrink-0">
{/* to="/" — NOT bare history-back. These are top-nav / footer
                destinations reachable from anywhere, so `navigate(-1)` sent
                you to whatever you happened to view last: opening Terms, then
                Jobs, then pressing Back landed on Terms. A top-level page
                needs one predictable parent, and consistently the same one
                across all of them. */}
              <BackButton to="/" />
          </div>
          <div className="flex flex-col leading-none min-w-0 flex-1">
            {/* Static "Legal" — the h1 does NOT swap with the tab. This is one
                page with three tabs, and the tab band directly below already
                says which policy you're reading, so retitling the page on every
                toggle made the header flicker between three names for the same
                destination. The per-policy names still drive the DOCUMENT title
                and canonical via usePageMeta, which is what SEO reads. */}
            <h1 className="text-page-title leading-tight truncate">Legal</h1>
          </div>
        </div>
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
                  border: "1px solid hsl(var(--bark-border))",
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

  // The per-tab editorial tagline ("The agreement you accept when you use
  // Helpr." etc.) was removed on all three tabs at the owner's request — the
  // page title already names the policy, and the "short version" panel
  // immediately below summarises it, so the line restated both.

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
          paddingTop: "var(--safe-area-top, 0px)",
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
            <div className="page-measure mx-auto space-y-3">
              {nativeHeaderRow}
              {/* Terms / Rules / Privacy stay PUT while the policy scrolls.
                  They used to scroll away with the body — so on a document
                  thousands of words long, switching policy meant scrolling all
                  the way back to the top to reach the control. The web branch
                  below already pinned its band; the native one never did.

                  `-mx-5 px-5` lets the sticky band's background bleed to the
                  screen edges so text doesn't show through the 20px gutters as
                  it passes underneath. */}
              <div
                className="sticky top-0 z-30 -mx-5 px-5 py-2 bg-premium-page"
                data-print-hide
              >
                <div className="flex items-center gap-2">
                  {/* One row, always — no wrap. Search leads; the tabs sit
                      beside it on anything wider than a phone. On a phone the
                      input's 220px minimum plus three tabs cannot fit, and
                      wrapping them to a second line made the band grow and the
                      page jump on every search toggle. Hiding them there costs
                      nothing: this searches ALL policies, so which tab is
                      selected has no bearing on the results, and closing the
                      search brings them straight back. */}
                  {searchBar}
                  {searchToggle}
                  <div
                    className={
                      searchOpen ? "shrink-0 hidden sm:block" : "flex-1 min-w-0"
                    }
                  >
                    {tabBar}
                  </div>
                </div>
              </div>
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
  //
  // This page renders the canonical in-content <BackButton /> next to its H1,
  // which is its only back affordance.
  return (
    <PublicLayout showCtaBand={false}>
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        {/* Compact [BackButton] [title] row — same shape and vertical offset as
            /for-business, /subscription, /help, and /jobs. */}
        {webHeader}

        <div className="px-5 sm:px-8 lg:px-12 pb-8">
          <div className="page-measure mx-auto space-y-3">
            {/* Opaque, not just blurred. `backdrop-blur-md` alone left the
                band see-through: scrolled policy text read straight through
                the pinned control ("…liability", "…not a party" ghosting
                behind the tabs), and the band's top edge had nothing above it
                so text ran right up against the pill. A solid page-coloured
                band with real vertical padding gives the passing content
                somewhere to disappear. */}
            <div
              className="sticky z-30 -mx-5 px-5 py-2"
              style={{
                top: webBandStickyTop,
                // No solid fill (owner). `--background` is a flat neutral and
                // PublicLayout's ground is a warm mesh gradient, so painting the
                // band with it produced exactly the mismatched stripe the old
                // note here was worried about — a grey slab sitting across a
                // warm page. A blur keeps the band doing its real job (giving
                // scrolled policy text somewhere to disappear) without
                // introducing a colour that has to match anything.
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              <div
                className="rounded-2xl flex items-center gap-2 p-1"
                style={{ border: "1px solid hsl(var(--bark) / 0.18)" }}
              >
                {/* One row, always — see the native branch above for why the
                    wrap went: an opened search pushed the tabs to a second
                    line, growing the band and jumping the page. Below `sm` the
                    tabs step aside for the input instead; search spans all
                    three policies, so the selected tab doesn't affect results
                    and closing search restores them. */}
                {searchBar}
                {searchToggle}
                <div
                  className={searchOpen ? "shrink-0 hidden sm:block" : "flex-1 min-w-0"}
                >
                  {tabBar}
                </div>
              </div>
            </div>
            {/* Full-width body at every breakpoint. The old lg+ two-column split
                reserved a 14rem "On this page" gutter; with the TOC gone, a
                grid wrapper would leave that column empty — a dead rail this
                project treats as a layout failure. */}
            {body}

            {/* "Updated <month>" lives at the FOOT of the policy (owner). It
                sat in the header row beside the title, where it competed with
                the page name for the first thing you read — and it answers a
                question you only ask after reading the document, not before.
                Web branch only; the native screen is untouched. */}
            <p
              className="pt-6 text-ds-11 font-sans tabular-nums"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Updated {LAST_UPDATED[tab]}
            </p>
          </div>
        </div>
      </Tabs>
    </PublicLayout>
  );
};

export default Legal;
