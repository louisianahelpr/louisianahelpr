import { useState } from "react";
import { ChevronDown } from "lucide-react";
import BackButton from "@/components/BackButton";
import PublicLayout from "@/components/marketing/PublicLayout";
import FaqRow from "@/components/marketing/FaqRow";
// The card that closes every legal policy tab. Shared, not copied, so the
// Help Center and the policy pages cannot drift into two support cards.
import { PolicyFooter } from "@/pages/legal/LegalChrome";
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
 *      normal-size "Help Center" title (same row shape as /jobs). No search
 *      (removed — see the note inside the component) and no lede.
 *   2. Quick answers — the seven collapsible FAQ topic sections; the
 *      "Contact support" escape hatch closes the page.
 *
 * Preserves the existing helpCenterContent data source (TOPICS, FAQ_SECTIONS,
 * SECTION_ACCENTS) verbatim.
 */

// ─── Topic anchor slugs — same order as TOPICS ────────────────────────────────
// Slugs let the topic grid deep-link into the FAQ list's per-section anchors.
const topicSlug = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");


// Blurb lookup for the merged topic list — TOPICS still owns the copy even
// though its card grid is gone.
const topicDesc = (topic: string): string | undefined =>
  TOPICS.find((t) => t.label.toLowerCase() === topic.toLowerCase())?.desc;

// ─── TopicSection — collapsible topic wrapper ────────────────────────────────
const TopicSection = ({
  section,
  accent,
}: {
  section: { topic: string; items: Array<{ q: string; a: string }> };
  accent: string;
}) => {
  // Collapsed by default at EVERY width (owner, 2026-08-25: "the tabs in help
  // center also should open as expanded. They should be collapsed").
  // This reverses the 2026-08-24 md+ auto-expand, which was trying to solve a
  // different problem — a desktop screen of nothing but category headers. The
  // answer to that is the spacing and the topic cards above, not seven
  // sections open at once: expanded-by-default made the page a wall of text
  // you had to scroll past to find the one question you came for, and it is
  // what pushed the real content so far below the title.
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const open = manualOpen;
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
          <span className="inline-flex flex-col gap-0.5 min-w-0">
            <span className="inline-flex items-center gap-2">
              {section.topic}
              <span
                aria-hidden
                className="font-sans font-medium normal-case tracking-normal text-ds-11"
                style={{ color: "hsl(var(--olivewood) / 0.6)" }}
              >
                {section.items.length}
              </span>
            </span>
            {/* Blurb from the deleted "Browse by topic" grid. That grid only
                scrolled to and opened THIS accordion — the same list twice —
                so folding its copy in here keeps the value and drops the dupe. */}
            {topicDesc(section.topic) && (
              <span
                className="font-serif italic normal-case tracking-normal text-ds-11"
                style={{ color: "hsl(var(--olivewood) / 0.75)" }}
              >
                {topicDesc(section.topic)}
              </span>
            )}
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
            <FaqRow key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── HelpCenter ───────────────────────────────────────────────────────────────

const HelpCenter = () => {
  // No search on this page (owner, 2026-08-22). It was a client-side filter
  // over FAQ_SECTIONS — a static array of seven topics — reached through a
  // control that had already been moved three times looking for a place where
  // it did not read as clutter. Seven labelled, collapsible topics are a list
  // you scan, not a corpus you query, and the browser's own find-in-page
  // already covers the rest. The whole feature is gone rather than relocated
  // again: the filter, its "Matching …" caption, and the no-results dead end.

  usePageMeta({
    title: "Help Center — Helpr",
    description:
      "Answers, guides, and support for posters and Helprs — posting tasks, payments, safety, and account settings.",
    canonical: "https://www.louisianahelpr.com/help",
    ogTitle: "Louisiana Helpr Help Center",
    ogDescription:
      "Answers, guides, and support — for posters and Helprs alike.",
  });

  return (
    <PublicLayout>
      {/* ─────────────────────── 1. Compact page header ───────────────────── */}
      {/* Back button LEFT of a normal-size title, same row shape as /jobs.
          Container + padding match every section below so the title lines up
          with the topic / FAQ columns. */}
      <section className="px-5 sm:px-8 lg:px-12">
        <div className="mx-auto page-measure">
          <div className="flex items-center gap-3 mt-4 mb-3 md:mt-5 md:mb-4">
            <div className="shrink-0">
              <BackButton />
            </div>
            <div className="flex flex-col leading-none min-w-0 flex-1">
              <h1 className="text-page-title leading-tight truncate">
                Help Center
              </h1>
            </div>
          </div>

          {/* No lede under the title (desktop-only marketing framing that
              restated the title) and no search (removed — see the note at the
              top of the component). The "Contact support" escape hatch closes
              the page — see the bottom of this file. */}
        </div>
      </section>

      {/* ───────────────────────── 3. FAQ / Quick answers ────────────────────── */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        // pt-0 below md. The `pt-6` here was spacing the FAQ away from the
        // lede above it — but that lede is `hidden md:block`, so on a phone
        // this padding separated the title from nothing and left 45px of
        // dead air under "Help Center". The md+ editorial spacing is
        // unchanged, because there the lede really is there.
        /* pt-16/pt-24 was hero breathing room from when this section opened
           the page. It now sits directly under the PageHeader title row,
           which brings its own margin, so the two stacked into ~190px of
           empty band between "Help Center" and the first answer (owner,
           2026-08-25: "a lot of space from the title of help center to the
           actual info"). Kept a rhythm step, dropped the hero gap. */
        className="px-5 sm:px-8 lg:px-12 pt-0 md:pt-6 lg:pt-8 pb-8 scroll-mt-24"
      >
        <div className="mx-auto page-measure grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-10 lg:gap-16">
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
              {/* The plain "Quick answers" label is gone from the phone/app
                  surface (owner). It stays in the accessibility tree rather
                  than being deleted outright: this <section> is
                  `aria-labelledby="faq-heading"`, so an h2 with no text would
                  leave the section unnamed and the page with a heading that
                  announces nothing. Visually hidden, not removed. */}
              <span className="sr-only md:hidden">Quick answers</span>
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
          </div>

          {/* Right column — hairline accordion, no glass panels. */}
          <div className="md:col-span-8 lg:col-span-9">
            <div className="space-y-3 sm:space-y-4">
              {FAQ_SECTIONS.map((section) => (
                <TopicSection
                  key={section.topic}
                  section={section}
                  accent={
                    SECTION_ACCENTS[section.topic] ??
                    "hsl(var(--burnt-sienna))"
                  }
                />
              ))}
            </div>
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
        <div className="mx-auto page-measure">
          {/* The SAME card the legal tabs close with (PolicyFooter), not a
              lookalike — owner: "help center contact support should be more
              similar to legals". It used to be a centred parchment panel with a
              burnt-sienna underlined link, which is a different card doing an
              identical job two clicks away. No right-hand slot here (owner):
              the policy tabs use it for their revision date, and the Help
              Center has no equivalent fact to put there. */}
          <PolicyFooter />
        </div>
      </section>
    </PublicLayout>
  );
};

export default HelpCenter;
