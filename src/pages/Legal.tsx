import { useState, useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, Search, X } from "lucide-react";
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
  // The search field collapses to an icon by default (owner, 2026-08-23),
  // matching HelpCenter/BrowseTasksActions/ActivityHeader's icon-that-expands
  // pattern elsewhere in this app. It PREVIOUSLY collapsed the same way and
  // was changed to always-visible because the collapse/expand made the
  // control row change SHAPE: the tabs went from three equal 292px columns
  // to a compact right-aligned trio, sliding across the row, and (below
  // `sm`) vanished entirely. That regression came from the search slot's
  // width itself changing between states.
  //
  // This time the outer search slot (`searchBar` below) keeps the EXACT
  // same width/order classes in both the icon and the input state — only
  // the content painted inside that fixed-width slot changes (a 40px icon
  // button vs. the full input). Because the slot's own footprint never
  // changes, the tab row after it in the flex layout never moves — verified
  // with Playwright: identical tab bounding-box before/after toggling
  // search, and before/after switching tabs while search is open.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The sticky Terms/Rules/Privacy band, so a tab switch can scroll to the
  // band's own offset instead of yanking the document to 0 (see below).
  const stickyRowRef = useRef<HTMLDivElement>(null);
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

  // Switching tabs is a fresh document: drop any active search and start the
  // new policy at its beginning rather than wherever the old one happened to
  // be scrolled to. The goal is unchanged — deep-scrolling Privacy then
  // tapping Terms must not land you mid-page — but the means are.
  //
  // This used to `scrollTo({ top: 0 })`, which was the single biggest source
  // of the "whole page jumps when you toggle terms" complaint: reading at
  // y=157 and tapping a tab yanked the viewport to the very top, so the
  // header, the title row and the tab band all visibly flew back down the
  // screen under your finger.
  //
  // Instead we scroll to the sticky band's OWN offset. Once you are past that
  // offset the band is pinned at the top of the viewport, and landing exactly
  // on the offset puts it in that same pinned position — so the row you just
  // tapped does not move a single pixel, while the policy underneath it is
  // correctly reset to its first line. If you are at or above the offset the
  // band is not pinned yet and the document top is already in view, so we do
  // not scroll at all.
  //
  // Measuring the band's UNPINNED offset is the fiddly part. Both of the
  // obvious reads are contaminated once the band is actually stuck:
  // `getBoundingClientRect().top` is 0 (that's what "pinned" means), and —
  // measured, not assumed — Chrome folds the sticky displacement into
  // `offsetTop` as well, so a pinned band reports its own scroll position and
  // `current > bandOffset` can never be true. So we flip the element to
  // `position: static` for the duration of one synchronous read and put it
  // straight back. No paint happens between the two writes, so nothing
  // flickers, and the rect we read in between is the honest layout position.
  useEffect(() => {
    setQuery("");
    const row = stickyRowRef.current;
    if (!row) return;
    const container = isNativePlatform ? scrollRef.current : null;

    const prevPosition = row.style.position;
    row.style.position = "static";
    const naturalTop = row.getBoundingClientRect().top;
    row.style.position = prevPosition;

    // Viewport-relative → container-relative. For the web branch the scroll
    // box is the document, so the container terms fall away to `scrollY`.
    const containerTop = container ? container.getBoundingClientRect().top : 0;
    const current = container ? container.scrollTop : window.scrollY;
    const bandOffset = naturalTop - containerTop + current;

    if (current > bandOffset) {
      if (container) {
        container.scrollTo({ top: bandOffset });
      } else {
        window.scrollTo({ top: bandOffset });
      }
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
        {/* Static "Legal" — the h1 does NOT swap with the tab, matching the web
            header below. This fix was applied to the WEB header and missed
            here, so the native app kept the exact behaviour that header's
            comment describes: one page with three tabs retitling itself on
            every toggle, flickering between three names for the same
            destination while the tab band directly underneath already says
            which policy you are reading.

            The per-policy names still drive the DOCUMENT title and canonical
            via usePageMeta, which is what SEO and the browser tab read. */}
        <h1 className="text-page-title leading-tight truncate">Legal</h1>
      </div>
    </div>
  );

  // WEB header: the same compact row every other public page opens with —
  // [BackButton] [normal-size page title] — so /legal, /subscription,
  // /help, and /jobs all start their title at the identical
  // vertical offset. Replaces the old full-bleed editorial hero (display
  // eyebrow, clamp() Bodoni H1 with burnt-sienna accent, warm halo, poster
  // subhead, wide-tracked "Last updated" chip), which opened /legal 64px lower
  // than every sibling page.
  //
  // "Last updated" survives in two quieter places: the tabular-nums span on the
  // right of this row (so the revision date is still visible without scrolling
  // — it's legally useful), and each policy's PolicyFooter at the end of the
  // document. The poster subhead is dropped because it restated the tab the
  // reader had just chosen.
  //
  // This comment used to justify that by saying "TAB_TAGLINES already carries
  // the same framing one line further down". It did not — TAB_TAGLINES was
  // written but never rendered anywhere, so the page had been silently short
  // one line of framing while the code asserted it was showing it. Owner's
  // call (2026-08-27): drop the unused strings rather than surface them.
  //
  // This header and the content container below BOTH use the reference pages'
  // `px-5 sm:px-8 lg:px-12`, so Legal's left edge lines up with Help Center,
  // and Support.
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
        {/* Tighter than the 24/32px this row used to carry top and bottom
            (owner). "Legal" is a one-word title over a tab bar that names the
            actual document — it does not need a hero's worth of air, and the
            gap pushed the policy itself further below the fold on every load. */}
        <div className="flex items-center gap-3 mt-4 mb-3 md:mt-5 md:mb-4">
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

  // ONE size, always. Below `sm` the three tabs share the full width as an
  // even 3-column grid stacked above the search input; from `sm` up they
  // collapse to their natural inline width and sit at the right of the row.
  // The class string depends only on the viewport — never on which tab is
  // selected and never on whether search is focused — so a tab switch cannot
  // resize or reposition anything. (It used to be a two-way `searchOpen`
  // conditional, which is exactly how three 292px columns turned into a
  // compact trio the moment you touched the search icon.)
  const tabBar = (
    <TabsList
      data-print-hide
      className="grid grid-cols-3 sm:flex items-center gap-1 sm:gap-2 rounded-2xl p-1 h-auto bg-transparent border-0 w-full"
    >
      {VALID_TABS.map((t) => {
        const isActive = t === tab;
        const Icon = TAB_ICONS[t];
        return (
          <TabsTrigger
            key={t}
            value={t}
            className="relative h-9 inline-flex sm:flex-1 items-center justify-center gap-1.5 rounded-ds-md text-ds-13 font-sans font-semibold leading-none transition-colors duration-200"
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

  // The slot SHRINKS to the icon when collapsed and only claims the row when
  // open. Holding it at `flex-1 min-w-[220px]` in both states — to stop the
  // tabs shifting — left a 44px icon marooned in a 611px slot with 567px of
  // dead gap beside it and the tabs jammed against the far edge. Reserving
  // half the row for a control that is not currently there is a worse defect
  // than the shift it was avoiding, and the shift is avoidable anyway: the
  // TABS keep a fixed width of their own (see the tab wrapper below), so they
  // hold their size whichever state this slot is in — they simply sit further
  // left when there is more room.
  const searchBar = (
    <div
      className={
        searchOpen
          ? "relative w-full sm:flex-1 sm:min-w-[220px] order-2 sm:order-1"
          : "relative self-start shrink-0 order-2 sm:order-1"
      }
      data-print-hide
    >
      {searchOpen ? (
        <>
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
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Search all policies…"
            className="w-full h-10 rounded-ds-md pl-9 pr-16 text-ds-13 font-sans bg-card outline-none transition-shadow focus:ring-2 focus:ring-inset"
            style={{
              border: "1px solid hsl(var(--bark) / 0.18)",
              color: "hsl(var(--ink-deep))",
            }}
          />
          {/* CLEAR — only shown when there is a query to clear. Sits to the
              left of the always-present close button so the two never
              overlap. */}
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-9 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full btn-press hover:bg-primary/5"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {/* CLOSE — collapses the field back to the icon button and clears
              the query, same as Escape. */}
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full btn-press hover:bg-primary/5"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search all policies"
          aria-expanded={searchOpen}
          className="h-10 w-10 rounded-ds-md inline-flex items-center justify-center btn-press hover:bg-primary/5"
          style={{
            border: "1px solid hsl(var(--bark) / 0.18)",
            color: "hsl(var(--olivewood) / 0.8)",
          }}
        >
          <Search className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  // The one control row, shared verbatim by the native and web branches below
  // so the two can't drift. Stacked on a phone (tabs above the search, both
  // full-width), side by side from `sm` up (search flexes on the left, tabs
  // pinned at their natural width on the right). `order-*` keeps the tabs
  // first in the stacked layout while leaving them last on the wide one, and
  // the tabs are NEVER hidden — the old `hidden sm:block` made them vanish on
  // a phone the instant search opened.
  // Closed, the row is a three-column grid — [search | tabs | equal spacer] —
  // so the tabs sit in the TRUE centre of the card instead of packing left
  // behind the icon and leaving the right half empty. The outer columns are
  // both `1fr`, so the centre column is centred on the row, not on whatever
  // space the icon happens to leave. Open, search needs the width, so the row
  // falls back to the flex layout (search flexes left, tabs keep their natural
  // size on the right). Below `sm` both states stay stacked, tabs first.
  const controlRow = (
    <div
      className={
        searchOpen
          ? "flex flex-col sm:flex-row sm:items-center gap-2 p-1"
          // Search LEFT, tabs spread across the rest of the bar. The closed
          // state used to be a [1fr auto 1fr] grid that pinned the triggers to
          // the TRUE centre — which is exactly the "all squished together in
          // the middle" the owner reported: at 1440 the three tabs occupied
          // x=587..854 with ~500px of dead band on either side. Now the row is
          // a flex line and the tab group takes the remaining width, so the
          // three policies are distributed instead of packed.
          : "flex flex-col gap-2 p-1 sm:flex-row sm:items-center sm:gap-4"
      }
    >
      {searchBar}
      <div
        className={
          searchOpen
            ? "w-full sm:w-auto sm:shrink-0 order-1 sm:order-2"
            : "w-full order-1 sm:order-2 sm:flex-1"
        }
      >
        {tabBar}
      </div>
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
                ref={stickyRowRef}
                className="sticky top-0 z-30 -mx-5 px-5 py-2 bg-premium-page"
                data-print-hide
              >
                {controlRow}
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
    <PublicLayout>
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        {/* Compact [BackButton] [title] row — same shape and vertical offset as
            /subscription, /help, and /jobs. */}
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
              ref={stickyRowRef}
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
                className="rounded-2xl"
                style={{ border: "1px solid hsl(var(--bark) / 0.18)" }}
              >
                {controlRow}
              </div>
            </div>
            {/* Full-width body at every breakpoint. The old lg+ two-column split
                reserved a 14rem "On this page" gutter; with the TOC gone, a
                grid wrapper would leave that column empty — a dead rail this
                project treats as a layout failure. */}
            {body}
          </div>
        </div>
      </Tabs>
    </PublicLayout>
  );
};

export default Legal;
