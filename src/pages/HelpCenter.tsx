import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search, X, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import BackButton from "@/components/BackButton";
import PublicLayout from "@/components/marketing/PublicLayout";
import FaqRow from "@/components/marketing/FaqRow";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  TOPICS,
  SECTION_ACCENTS,
  FAQ_SECTIONS,
} from "./helpCenter/helpCenterContent";

/**
 * Help Center — ONE component serving two surfaces.
 *
 * `/help` is a public marketing route (a Footer destination, rendered inside
 * <PublicLayout> with the marketing Navbar + Footer) AND the in-app help
 * screen: on native, PublicLayout swaps its own chrome for AppShell and
 * renders this exact body. So the page cannot simply be "de-marketing'd" —
 * stripping the editorial voice would strip it from the website too.
 *
 * The split is therefore by BREAKPOINT, never by `Capacitor.isNativePlatform()`
 * (phone-width web and the native app are one surface — they must not diverge):
 *
 *   < md (768px)  → APP presentation. Search + chips first, then a scannable
 *                   category list: icon + label + one line + forward chevron.
 *                   No display-scale section heroes, no giant numerals, no
 *                   editorial eyebrows. This is what the iOS app shows.
 *   ≥ md          → MARKETING presentation, unchanged: left masthead with the
 *                   display eyebrow and the two-tone Bodoni headline, right
 *                   magazine grid with giant burnt-sienna numerals and the
 *                   "Learn more →" lockup, sequential IO fade-in.
 *
 * Structure:
 *   1. Compact page header — canonical BackButton to the LEFT of a
 *      normal-size "Help Center" title (same row shape as /jobs), the
 *      one-line lede (md+ only), then the squircle search pill +
 *      popular-search chips. The "Contact support" escape hatch closes the
 *      page rather than preceding the search. The search box and its chips stay
 *      at the top on both surfaces — they are the real shortcuts.
 *   2. Browse by topic — see the breakpoint split above.
 *   3. Quick answers   — same split on the masthead; the accordion itself is
 *      identical on both.
 *
 * Preserves the existing helpCenterContent data source (TOPICS, FAQ_SECTIONS,
 * SECTION_ACCENTS) verbatim — same client-side search, same category CONTENT.
 * Only the presentation differs.
 */

// ─── Topic anchor slugs — same order as TOPICS ────────────────────────────────
// Slugs let the topic grid deep-link into the FAQ list's per-section anchors.
const topicSlug = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ─── Popular searches ─────────────────────────────────────────────────────────
// Curated seed terms shown as clickable pills under the search input when the
// visitor hasn't typed anything yet. Each term is chosen because it matches
// at least one FAQ item in FAQ_SECTIONS via the existing q/a substring filter
// (escrow → Payments & Escrow items; refund → Escrow + dispute items; posting
// → Posting a Job section; fees → Payments & Escrow "What fees" item;
// cancel → cancellation copy across Posting/Trust/Membership). Clicking a
// pill calls setQuery(term), which triggers the same in-memory filter as
// typing it in and expands the matching FAQ sections.
const POPULAR_SEARCHES = [
  "escrow",
  "refund",
  "posting",
  "fees",
  "cancel",
];

// ─── TopicSection — collapsible topic wrapper (topic click expands the FAQ list) ─
const TopicSection = ({
  section,
  accent,
  forceOpen,
  externallyOpened,
  itemKeyQuery,
}: {
  section: { topic: string; items: Array<{ q: string; a: string }> };
  accent: string;
  forceOpen: boolean;
  externallyOpened: boolean;
  itemKeyQuery: string;
}) => {
  const [manualOpen, setManualOpen] = useState(false);
  // When the parent flips externallyOpened to true (user clicked a topic
  // card up in Section 2), open this section. Users can still collapse
  // it by clicking the chevron.
  useEffect(() => {
    if (externallyOpened) setManualOpen(true);
  }, [externallyOpened]);
  const open = forceOpen || manualOpen;
  return (
    <div
      id={`faq-${topicSlug(section.topic)}`}
      className="scroll-mt-24 rounded-2xl"
      style={{
        background: "hsl(var(--burnt-sienna) / 0.04)",
        border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
        boxShadow: "var(--elev-inset-hairline)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManualOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-6 py-4 sm:py-5 px-5 sm:px-6 text-left transition-opacity hover:opacity-80"
      >
        <span
          className="font-sans font-semibold uppercase text-ds-12 sm:text-ds-12 tracking-[0.18em] inline-flex items-center gap-3"
          style={{ color: accent }}
        >
          <span
            aria-hidden
            className="inline-block w-6 h-px"
            style={{ background: accent }}
          />
          {section.topic}
          <span
            aria-hidden
            className="ml-1 font-sans font-medium normal-case tracking-normal text-ds-11"
            style={{ color: "hsl(var(--olivewood) / 0.6)" }}
          >
            {section.items.length}
          </span>
        </span>
        <ChevronDown
          className="w-5 h-5 shrink-0 transition-transform duration-200"
          style={{
            color: "hsl(var(--olivewood))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <div className="px-5 sm:px-6 pb-2">
          {section.items.map((item) => (
            <FaqRow
              key={`${item.q}-${itemKeyQuery}`}
              q={item.q}
              a={item.a}
              defaultOpen={forceOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── HelpCenter ───────────────────────────────────────────────────────────────

const HelpCenter = () => {
  const [query, setQuery] = useState("");
  // Track which FAQ topic sections were requested to open via the topic
  // cards up in Section 2. Set-based so multiple can be open at once.
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());

  // Client-side KB search (preserved from the previous implementation) — the
  // whole knowledge base is the static FAQ_SECTIONS array, so we filter
  // in-memory. Topic-name match surfaces the entire section; otherwise we
  // match question/answer text.
  const q = query.trim().toLowerCase();
  const filteredSections = q
    ? FAQ_SECTIONS.map((section) => {
        const topicMatch = section.topic.toLowerCase().includes(q);
        const items = topicMatch
          ? section.items
          : section.items.filter(
              (i) =>
                i.q.toLowerCase().includes(q) ||
                i.a.toLowerCase().includes(q),
            );
        return { ...section, items };
      }).filter((section) => section.items.length > 0)
    : FAQ_SECTIONS;
  const searching = q.length > 0;
  const noResults = searching && filteredSections.length === 0;

  usePageMeta({
    title: "Help Center — Helpr",
    description:
      "Answers, guides, and support for posters and Helprs — posting jobs, escrow, payments, safety, and account settings.",
    canonical: "https://www.louisianahelpr.com/help",
    ogTitle: "Louisiana Helpr Help Center",
    ogDescription:
      "Answers, guides, and support — for posters and Helprs alike.",
  });

  // Sequential fade-in for the topic grid, matching HowItWorksSection —
  // IntersectionObserver at 0.2 threshold with a 10% bottom rootMargin,
  // 1100ms cubic-bezier ease, 400ms per-item stagger. Respects reduced motion.
  const topicsRef = useRef<HTMLDivElement>(null);
  const [topicsInView, setTopicsInView] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setTopicsInView(true);
      return;
    }
    const el = topicsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTopicsInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Focus search on "Learn more" from a topic card — filtering by that topic
  // is how the previous page surfaced a whole section; we preserve that
  // behaviour by having the topic anchors scroll to the FAQ section header
  // directly (deep-link), which reads as more discoverable than auto-filling
  // the search.
  const scrollToFaq = () => {
    const target = document.getElementById("faq");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Open a category: mark its FAQ section expanded, then scroll to it. The
  // scroll is deferred a frame so the section has re-rendered with its body
  // open and the target offset is the final one, not a mid-animation one.
  // Shared by the app list and the marketing grid so the two presentations
  // can never drift in behaviour.
  const openTopic = (label: string) => {
    const slug = topicSlug(label);
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
    requestAnimationFrame(() => {
      const target = document.getElementById(`faq-${slug}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else scrollToFaq();
    });
  };

  return (
    <PublicLayout>
      {/* ─────────────────────── 1. Compact page header ───────────────────── */}
      {/* Back button LEFT of a normal-size title, same row shape as /jobs.
          Container + padding match every section below so the title lines up
          with the topic / FAQ columns. */}
      <section className="px-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          <div className="flex items-center gap-3 mt-6 mb-4 md:mt-8 md:mb-5">
            <div className="shrink-0">
              <BackButton />
            </div>
            <div className="flex flex-col leading-none min-w-0 flex-1">
              <h1 className="text-page-title leading-tight truncate">
                Help Center
              </h1>
            </div>
          </div>

          {/* One-line lede — the two audiences we serve, in one flowing line.
              md+ only: it is marketing framing, and on the phone/app surface
              it was one more block queue-jumping the search box (it cost ~2
              lines at 375px). The website keeps it. */}
          <p
            className="hidden md:block max-w-xl lg:max-w-2xl text-ds-15 sm:text-ds-17 leading-relaxed text-balance"
            style={{
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 400,
              letterSpacing: "-0.005em",
              color: "hsl(var(--stormy-sky))",
            }}
          >
            Answers, guides, and support — whether you're hiring or helping.
          </p>

          {/* Squircle search pill — client-side filter drives the FAQ list
              below. Olivewood outline on parchment; no glass.

              The "Contact support" line used to sit HERE, between the lede
              and the search, and then just below it. Both put a "this didn't
              work" fallback in front of the thing it is a fallback for, and
              added to the stack of blocks pushing the topics below the fold.
              It closes the page now — see the bottom of this file. */}
          <div className="w-full max-w-2xl mt-4 md:mt-5">
            <div
              className="flex items-center gap-3 rounded-2xl px-5 py-4 sm:px-6 sm:py-5 transition-shadow focus-within:shadow-md"
              style={{
                background: "hsl(var(--parchment) / 0.85)",
                border: "1.5px solid hsl(var(--olivewood) / 0.35)",
                boxShadow:
                  "inset 0 1px 0 hsl(var(--parchment) / 0.5), 0 8px 24px -12px hsl(var(--olivewood) / 0.18)",
              }}
            >
              <Search
                className="w-5 h-5 shrink-0"
                style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Short on purpose: "Search answers, guides, and topics..." is
                // ~34 characters, and at 375px — after the icon, the pill's
                // 20px padding and the clear button's lane — the field has room
                // for about 24. It rendered clipped mid-word ("...and to") on
                // every phone.
                placeholder="Search answers…"
                aria-label="Search help articles"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ds-15 sm:text-ds-17 placeholder:text-[hsl(var(--olivewood)/0.8)]"
                style={{
                  fontFamily: "Montserrat, system-ui, sans-serif",
                  color: "hsl(var(--ink-deep))",
                }}
              />
              {searching && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="shrink-0 transition-opacity hover:opacity-70"
                >
                  <X
                    className="w-5 h-5"
                    style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                    strokeWidth={1.75}
                  />
                </button>
              )}
            </div>

            {/* Popular searches — surface a handful of common queries so
                first-time visitors can jump into a topic without knowing
                the vocabulary. Hidden the moment the visitor starts
                typing; clicking a pill drives the same client-side
                filter as typing the term into the input. */}
            {/* The chips used to sit under a full-width "POPULAR SEARCHES"
                eyebrow — uppercase, 0.22em tracking, its own row. That is a
                section-heading treatment for five one-word shortcuts, and it
                cost a whole block of vertical space above the fold. The label
                is now an inline lead-in on the same row, which says the same
                thing in a quarter of the height. */}
            {!searching && (
              <div className="mt-4 flex items-center gap-x-2 min-w-0">
                <span
                  className="font-sans font-medium text-ds-11 shrink-0"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Popular:
                </span>
                <div className="flex items-center justify-start gap-2 min-w-0 overflow-x-auto pb-1 pr-5 scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
                  {POPULAR_SEARCHES.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setQuery(term)}
                      className="h-8 px-3.5 rounded-2xl inline-flex items-center shrink-0 whitespace-nowrap transition-colors hover:bg-[hsl(var(--olivewood)/0.06)]"
                      style={{
                        border: "1px solid hsl(var(--olivewood) / 0.2)",
                        color: "hsl(var(--olivewood))",
                      }}
                    >
                      <span className="font-sans font-semibold text-ds-13">
                        {term}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </section>

      {/* ───────────────────────── 2. Browse by topic ────────────────────────── */}
      {/* Tightened pt-* — this is the first section under the compact page
          header now that the full-height hero is gone; the old pt-24 left a
          rail-deep empty band below the search box. The <md ladder is tighter
          again: on the app surface this section is the reason people opened
          the screen, so it starts close under the search rather than a
          section-gap below it. */}
      {!searching && (
        <section
          id="topics"
          ref={topicsRef}
          aria-labelledby="topics-heading"
          className="px-5 sm:px-8 lg:px-12 pt-6 md:pt-12 lg:pt-16 pb-10 md:pb-16 lg:pb-24 scroll-mt-24"
        >
          <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-10 lg:gap-16">
            {/* Left column — masthead */}
            <div className="md:col-span-4 lg:col-span-3 text-left md:sticky md:top-32 md:self-start">
              {/* Display eyebrow is marketing chrome — md+ only. */}
              <span className="hidden md:inline text-display-eyebrow">Topics</span>
              {/* ONE h2 for the section (the id `aria-labelledby` points at),
                  wearing two presentations.

                  <md it is a plain section label at the canonical
                  `--headline-section` size — SMALLER than the page's own
                  `.text-page-title` h1, single colour, no trailing period. It
                  used to be a full display headline ("Find what you *need.*",
                  36px+ two-tone Bodoni with a full stop) sitting mid-scroll
                  BELOW a 22px page title: a second, bigger hero on a screen
                  that already had a title.

                  ≥md the editorial headline is untouched — /help is a public
                  marketing page and that is its voice there.

                  Both labels live in the same h2 and are swapped with
                  `hidden`/`md:hidden` (display:none), so exactly one
                  contributes to the accessible name at any width. */}
              <h2
                id="topics-heading"
                className="font-display font-bold italic md:not-italic text-balance leading-tight tracking-[-0.02em] text-[length:var(--headline-section)] md:mt-3 md:leading-[1.05] md:tracking-[-0.025em] md:text-[length:clamp(2.25rem,3.4vw,3.25rem)] md:max-w-none"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                <span className="md:hidden">Browse by topic</span>
                <span className="hidden md:inline">
                  Find what you{" "}
                  <em
                    className="inline-block"
                    style={{
                      fontStyle: "italic",
                      color: "hsl(var(--burnt-sienna))",
                    }}
                  >
                    need.
                  </em>
                </span>
              </h2>
            </div>

            {/* APP surface (<md) — the categories as a scannable list: category
                icon, label, one line, forward chevron. Same TOPICS data, same
                destination, same copy as the grid below; only the presentation
                differs. The whole row is the tap target (the grid's "Learn
                more" link was the only hit area), and there is no entrance
                animation — an app list should be there when the screen is.

                Deliberately NOT headings: these are navigation rows, and the
                marketing grid below already contributes the per-topic h3s at
                the width where it renders. */}
            <ul className="md:hidden space-y-2">
              {TOPICS.map((topic) => {
                const Icon = topic.icon;
                return (
                  <li key={topic.label}>
                    <a
                      href={`#faq-${topicSlug(topic.label)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        openTopic(topic.label);
                      }}
                      className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left"
                      style={{
                        background: "hsl(var(--burnt-sienna) / 0.04)",
                        border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                        boxShadow: "var(--elev-inset-hairline)",
                      }}
                    >
                      <span
                        aria-hidden
                        className="shrink-0 w-9 h-9 rounded-ds-md flex items-center justify-center"
                        style={{ background: topic.bg, color: topic.color }}
                      >
                        <Icon className="w-4 h-4" strokeWidth={2.25} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span
                          className="block font-display font-bold text-ds-15 leading-tight"
                          style={{ color: "hsl(var(--ink-deep))" }}
                        >
                          {topic.label}
                        </span>
                        <span
                          className="block mt-0.5 font-sans text-ds-12 leading-snug"
                          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                        >
                          {topic.desc}
                        </span>
                      </span>
                      {/* › — navigates within the app. Same glyph the rest of
                          the app uses for "goes to another screen". */}
                      <ChevronRight
                        aria-hidden
                        className="w-4 h-4 shrink-0"
                        strokeWidth={2.25}
                        style={{ color: "hsl(var(--olivewood) / 0.65)" }}
                      />
                    </a>
                  </li>
                );
              })}
            </ul>

            {/* MARKETING surface (≥md) — magazine grid of topics with giant
                Bodoni numerals as the anchor. Sequential fade-in matches HIW.
                Unchanged apart from being gated to md+ and the column ladder
                moving from sm: to md: (it never renders below md now). */}
            <div className="hidden md:col-span-8 lg:col-span-9 md:grid md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-8">
              {TOPICS.map((topic, i) => (
                <div
                  key={topic.label}
                  className="text-left rounded-2xl p-6 sm:p-7 lg:p-8 flex flex-col"
                  style={{
                    opacity: topicsInView ? 1 : 0,
                    transform: topicsInView
                      ? "translateY(0)"
                      : "translateY(24px)",
                    transition: `opacity 520ms cubic-bezier(0.22, 1, 0.36, 1) ${
                      i * 70
                    }ms, transform 520ms cubic-bezier(0.22, 1, 0.36, 1) ${
                      i * 70
                    }ms`,
                    willChange: "opacity, transform",
                    background: "hsl(var(--burnt-sienna) / 0.04)",
                    border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                    boxShadow: "var(--elev-inset-hairline)",
                  }}
                >
                  <span
                    aria-hidden
                    className="block font-display font-black leading-none"
                    style={{
                      fontSize: "clamp(4rem, 6.5vw, 6rem)",
                      color: "hsl(var(--burnt-sienna) / 0.35)",
                      letterSpacing: "-0.04em",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3
                    className="mt-4 font-display font-bold text-ds-20 sm:text-ds-24 lg:text-ds-28 tracking-tight leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {topic.label}
                  </h3>
                  <p
                    className="mt-3 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-xs"
                    style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                  >
                    {topic.desc}
                  </p>
                  <a
                    href={`#faq-${topicSlug(topic.label)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      openTopic(topic.label);
                    }}
                    /* mt-0.5 + py-3.5 rather than mt-4: 2px margin + 14px padding
                       puts the text in exactly the same place as the old 16px
                       margin, but grows the hit box from 19px to 47px so this
                       clears the 44px HIG/WCAG-2.5.5 floor. The extra height
                       extends into card space that was already blank, so nothing
                       moves. Plain <a> is outside the global tap-target rule in
                       index.css, which only covers button/[role=button]/inputs. */
                    className="mt-0.5 py-3.5 inline-flex items-center gap-1.5 font-sans font-semibold text-ds-13 sm:text-ds-14 transition-transform hover:translate-x-0.5"
                    style={{
                      color: "hsl(var(--burnt-sienna))",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    Learn more
                    <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───────────────────────── 3. FAQ / Quick answers ────────────────────── */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="px-5 sm:px-8 lg:px-12 pt-6 md:pt-16 lg:pt-24 pb-8 scroll-mt-24"
      >
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-10 lg:gap-16">
          {/* Left column — masthead. Same two-presentation h2 as the Topics
              section above (see the note there): a plain section label at
              `--headline-section` on the app surface, the editorial two-tone
              Bodoni headline on the marketing site. Left as a display headline
              it was a THIRD hero on the same screen. */}
          <div className="md:col-span-4 lg:col-span-3 text-left">
            <span className="hidden md:inline text-display-eyebrow">FAQ</span>
            <h2
              id="faq-heading"
              className="font-display font-bold italic md:not-italic text-balance leading-tight tracking-[-0.02em] text-[length:var(--headline-section)] md:mt-3 md:leading-[1.05] md:tracking-[-0.025em] md:text-[length:clamp(2.25rem,3.4vw,3.25rem)] md:max-w-none"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              <span className="md:hidden">Quick answers</span>
              <span className="hidden md:inline">
                Quick{" "}
                <em
                  className="inline-block"
                  style={{
                    fontStyle: "italic",
                    color: "hsl(var(--burnt-sienna))",
                  }}
                >
                  answers.
                </em>
              </span>
            </h2>
            {searching && (
              <p
                className="mt-2 md:mt-4 font-serif italic text-ds-14 leading-relaxed md:max-w-xs"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                Matching &ldquo;{query.trim()}&rdquo;.
              </p>
            )}
          </div>

          {/* Right column — hairline accordion, no glass panels. */}
          <div className="md:col-span-8 lg:col-span-9">
            {noResults ? (
              <div
                className="py-10 text-center md:text-left"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                <p
                  className="font-display italic font-bold text-ds-20 sm:text-ds-24 leading-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  No results for &ldquo;{query.trim()}&rdquo;.
                </p>
                <p
                  className="mt-3 font-serif italic text-ds-15 leading-relaxed"
                  style={{ color: "hsl(var(--olivewood) / 0.9)" }}
                >
                  {/* /support, not a raw mailto: — a mailto needs a configured
                      mail client and does nothing at all inside the native app,
                      so the one contact affordance on a dead-end search was
                      dead too for a chunk of visitors. */}
                  Try a different word, or{" "}
                  <Link
                    to="/support"
                    className="font-semibold underline"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    message our team
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {filteredSections.map((section) => (
                  <TopicSection
                    key={section.topic}
                    section={section}
                    accent={
                      SECTION_ACCENTS[section.topic] ??
                      "hsl(var(--burnt-sienna))"
                    }
                    forceOpen={searching}
                    externallyOpened={expandedSlugs.has(
                      topicSlug(section.topic),
                    )}
                    itemKeyQuery={q}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Escape hatch to a human — at the BOTTOM (owner: "contact support at
          bottom"), which is where someone who has read the topics and the FAQ
          and still has a question actually ends up.

          It used to sit under the search box near the top. That put a "this
          didn't work" fallback in front of the thing it is a fallback for, and
          it was one of five blocks stacked above the topics.

          Deliberately a single line, NOT the full-height "Still need help?"
          hero this page used to close with. That section was removed for
          making the page too long, and re-adding it would undo that; one line
          is enough to be findable and costs nothing.

          Links to /support, never a raw `mailto:` — a mailto needs a
          configured mail client and does nothing at all inside the native app,
          which is exactly how the old zero-results contact affordance managed
          to be dead for a chunk of visitors. */}
      <section className="px-5 sm:px-8 lg:px-12 pb-12 md:pb-16 lg:pb-24">
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          <div
            className="rounded-2xl px-5 py-4 sm:px-6 sm:py-5 text-center"
            style={{
              background: "hsl(var(--parchment) / 0.6)",
              border: "1px solid hsl(var(--olivewood) / 0.18)",
            }}
          >
            <p
              className="font-sans text-ds-13 sm:text-ds-15 leading-relaxed"
              style={{ color: "hsl(var(--olivewood) / 0.9)" }}
            >
              Still stuck?{" "}
              <Link
                to="/support"
                className="font-semibold underline"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                Contact support
              </Link>{" "}
              — no account needed.
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default HelpCenter;
