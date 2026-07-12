import { useEffect, useRef, useState } from "react";
import { Search, X, ArrowRight, ChevronDown } from "lucide-react";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  TOPICS,
  SECTION_ACCENTS,
  FAQ_SECTIONS,
} from "./helpCenter/helpCenterContent";

/**
 * Help Center — editorial remodel matching the landing hero + HIW style.
 *
 * Structure:
 *   1. Editorial hero  — warm ambient halo, Bodoni H1 with italic accent,
 *      large squircle search pill (client-side filters into FAQ list).
 *   2. Browse by topic — left masthead + right magazine grid, giant
 *      burnt-sienna Bodoni numerals per topic, sequential IO fade-in.
 *   3. Quick answers   — left masthead + right hairline-divider accordion,
 *      no glass panels, chevron rotates on open, sits on parchment.
 *   4. Contact band    — small horizontal band + bark rounded-2xl CTA.
 *
 * Preserves the existing helpCenterContent data source (TOPICS, FAQ_SECTIONS,
 * SECTION_ACCENTS) verbatim — the same client-side search over FAQ_SECTIONS
 * ships as before, just presented in the editorial tone.
 */

// ─── Topic anchor slugs — same order as TOPICS ────────────────────────────────
// Slugs let the topic grid deep-link into the FAQ list's per-section anchors.
const topicSlug = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ─── FaqRow — hairline-divider expandable, no glass panel ─────────────────────
const FaqRow = ({
  q,
  a,
  defaultOpen = false,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="border-b last:border-0"
      style={{ borderColor: "hsl(var(--olivewood) / 0.18)" }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-6 py-5 sm:py-6 text-left transition-opacity hover:opacity-80"
      >
        <span
          className="font-sans font-semibold text-ds-15 sm:text-ds-17 leading-snug"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {q}
        </span>
        <ChevronDown
          className="w-5 h-5 shrink-0 mt-1 transition-transform duration-200"
          style={{
            color: "hsl(var(--olivewood))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <div className="pb-5 sm:pb-6 pr-8">
          <p
            className="font-serif italic text-ds-14 sm:text-ds-15 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.9)" }}
          >
            {a}
          </p>
        </div>
      )}
    </div>
  );
};

// ─── TopicSection — collapsible topic wrapper (topic click expands the FAQ list) ─
const TopicSection = ({
  section,
  accent,
  forceOpen,
  itemKeyQuery,
}: {
  section: { topic: string; items: Array<{ q: string; a: string }> };
  accent: string;
  forceOpen: boolean;
  itemKeyQuery: string;
}) => {
  const [manualOpen, setManualOpen] = useState(false);
  const open = forceOpen || manualOpen;
  return (
    <div
      id={`faq-${topicSlug(section.topic)}`}
      className="scroll-mt-24 rounded-2xl"
      style={{
        background: "hsl(var(--burnt-sienna) / 0.04)",
        border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
        boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManualOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-6 py-4 sm:py-5 px-5 sm:px-6 text-left transition-opacity hover:opacity-80"
      >
        <span
          className="font-sans font-semibold uppercase text-[0.72rem] sm:text-[0.78rem] tracking-[0.18em] inline-flex items-center gap-3"
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
            className="ml-1 font-sans font-medium normal-case tracking-normal text-[0.7rem]"
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

  return (
    <PublicLayout>
      {/* ───────────────────────────── 1. Editorial hero ─────────────────────── */}
      <section className="relative px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24">
        <div className="relative z-10 mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl flex flex-col items-center text-center gap-8 sm:gap-10 lg:gap-12">
          {/* Warm ambient halo behind the H1 — same gold-warm → burnt-sienna
              radial pattern as the landing hero, so the two pages read as
              cut from the same paper. */}
          <div className="relative flex items-center justify-center w-full">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-16 sm:-inset-24 lg:-inset-32 -z-0"
              style={{
                background:
                  "radial-gradient(50% 50% at 50% 50%, hsl(var(--gold-warm) / 0.24) 0%, hsl(var(--burnt-sienna) / 0.10) 40%, transparent 75%)",
                filter: "blur(32px)",
              }}
            />
            <div className="relative z-10 flex flex-col items-center gap-5 sm:gap-6">
              <span className="text-display-eyebrow">Help Center</span>
              <h1
                className="font-display font-black leading-[1.0] text-balance break-words text-[2.75rem] sm:text-[4rem] md:text-[5rem] lg:text-[5.5rem] xl:text-[6.25rem]"
                style={{
                  color: "hsl(var(--olivewood))",
                  letterSpacing: "-0.03em",
                }}
              >
                How can we{" "}
                <em
                  className="relative inline-block"
                  style={{
                    fontStyle: "italic",
                    color: "hsl(var(--burnt-sienna))",
                  }}
                >
                  help?
                </em>
              </h1>
            </div>
          </div>

          {/* One-line subhead — the two audiences we serve, in one flowing line. */}
          <p
            className="max-w-xl lg:max-w-3xl text-ds-15 sm:text-ds-17 lg:text-ds-20 leading-relaxed text-balance"
            style={{
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 400,
              letterSpacing: "-0.005em",
              color: "hsl(var(--stormy-sky))",
            }}
          >
            Answers, guides, and support — for posters and Helprs alike.
          </p>

          {/* Large squircle search pill — client-side filter drives the FAQ
              list below. Olivewood outline on parchment; no glass. */}
          <div className="w-full max-w-2xl">
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
                placeholder="Search answers, guides, and topics..."
                aria-label="Search help articles"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ds-15 sm:text-ds-17 placeholder:text-[hsl(var(--olivewood)/0.6)]"
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
          </div>
        </div>
      </section>

      {/* ───────────────────────── 2. Browse by topic ────────────────────────── */}
      {!searching && (
        <section
          id="topics"
          ref={topicsRef}
          aria-labelledby="topics-heading"
          className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-16 lg:pb-24 scroll-mt-24"
        >
          <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16">
            {/* Left column — masthead */}
            <div className="md:col-span-4 lg:col-span-3 text-center md:text-left">
              <span className="text-display-eyebrow">Topics</span>
              <h2
                id="topics-heading"
                className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
                style={{
                  fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
                  letterSpacing: "-0.025em",
                  color: "hsl(var(--ink-deep))",
                }}
              >
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
              </h2>
            </div>

            {/* Right column — magazine grid of topics with giant Bodoni
                numerals as the anchor. Sequential fade-in matches HIW. */}
            <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 sm:gap-y-14 lg:gap-y-16">
              {TOPICS.map((topic, i) => (
                <div
                  key={topic.label}
                  className="text-center sm:text-left rounded-2xl p-6 sm:p-7 lg:p-8 flex flex-col"
                  style={{
                    opacity: topicsInView ? 1 : 0,
                    transform: topicsInView
                      ? "translateY(0)"
                      : "translateY(24px)",
                    transition: `opacity 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${
                      i * 400
                    }ms, transform 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${
                      i * 400
                    }ms`,
                    willChange: "opacity, transform",
                    background: "hsl(var(--burnt-sienna) / 0.04)",
                    border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                    boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
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
                    className="mt-3 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-xs mx-auto sm:mx-0"
                    style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                  >
                    {topic.desc}
                  </p>
                  <a
                    href={`#faq-${topicSlug(topic.label)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      const target = document.getElementById(
                        `faq-${topicSlug(topic.label)}`,
                      );
                      if (target) {
                        target.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      } else {
                        scrollToFaq();
                      }
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 font-sans font-semibold text-ds-13 sm:text-ds-14 transition-transform hover:translate-x-0.5"
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
        className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-16 lg:pb-24 scroll-mt-24"
      >
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16">
          {/* Left column — masthead */}
          <div className="md:col-span-4 lg:col-span-3 text-center md:text-left">
            <span className="text-display-eyebrow">FAQ</span>
            <h2
              id="faq-heading"
              className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
              style={{
                fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
                letterSpacing: "-0.025em",
                color: "hsl(var(--ink-deep))",
              }}
            >
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
            </h2>
            {searching && (
              <p
                className="mt-4 font-serif italic text-ds-14 leading-relaxed max-w-xs mx-auto md:mx-0"
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
                  Try a different word, or{" "}
                  <a
                    href="mailto:admin@louisianahelpr.com"
                    className="font-semibold underline"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    email our team
                  </a>
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
                    itemKeyQuery={q}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Closing "Still need help?" section removed — the FAQ +
          Topics grid already carries the primary support paths;
          this closing CTA was making the page too long. */}
    </PublicLayout>
  );
};

export default HelpCenter;
