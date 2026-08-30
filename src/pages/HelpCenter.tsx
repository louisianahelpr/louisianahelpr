import { useState } from "react";
import { ChevronDown } from "lucide-react";
import PageHeader from "@/components/PageHeader";
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
 * Help Center — ONE component serving two surfaces, and now ONE visual block.
 *
 * `/help` is a public marketing route (a Footer destination, rendered inside
 * <PublicLayout> with the marketing Navbar + Footer) AND the in-app help
 * screen: on native, PublicLayout swaps its own chrome for AppShell and
 * renders this exact body. Identical at every width — no
 * `Capacitor.isNativePlatform()` branch, phone-width web and the native app
 * are the same surface.
 *
 * Structure (owner, 2026-08-30: "this should be 1 component not 3" — was a
 * PageHeader title, a separate masthead+accordion section carrying its OWN
 * "Quick answers." heading on md+, and a separately-padded contact-support
 * section; three disconnected chunks, one of them a second title competing
 * with PageHeader's):
 *   1. The shared PageHeader — the ONE title, "Help Center".
 *   2. One section: the seven collapsible FAQ topics, then the
 *      "Contact support" escape hatch (PolicyFooter), sharing one top/bottom
 *      padding. No masthead heading of its own — `faq-heading` is a
 *      screen-reader-only h2 that names the section without painting a
 *      second visible title.
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
      {/* The shared PageHeader, NOT a hand-rolled copy of it. `width="public"`
          carries this page's own `px-5 sm:px-8 lg:px-12` gutter over
          `.page-measure`, so the title lines up with the topic / FAQ columns
          below at every breakpoint — and it renders that container itself, so
          it must NOT be nested inside another padded section (that would
          double the gutter).

          `topInsetHandled`: PublicLayout already clears the notch — the web
          branch via its nav spacer (`max(safe-area-top, 1.5rem) + 3rem`), the
          native branch via AppShell's status-bar cap. Without this flag the
          header would absorb `--safe-area-top` a second time.

          No lede under the title (desktop-only marketing framing that restated
          the title) and no search (removed — see the note at the top of the
          component). The "Contact support" escape hatch closes the page. */}
      <PageHeader title="Help Center" width="public" topInsetHandled />

      {/* ───────────────────────── 2. FAQ + contact support, ONE block ─────────
          Owner, 2026-08-30: "this should be 1 component not 3" (was PageHeader
          title / FAQ masthead+accordion / a separately-padded contact-support
          section — three visually disconnected chunks with different top/bottom
          paddings and, on md+, a SECOND title: "Quick answers." next to
          PageHeader's own "Help Center", the exact "one main title" violation
          already banned everywhere else in the app since 2026-07-25).

          Both fixes land together:
            1. The masthead heading is gone — "FAQ" eyebrow, the two-tone
               "Quick answers." Bodoni headline, and the 12-col label/content
               split it justified. `aria-labelledby` still needs a real element
               to name the section, so `faq-heading` is now a plain `sr-only`
               h2 (never painted, at any width) rather than a second visible
               title.
            2. The accordion and PolicyFooter render inside ONE section with
               ONE top/bottom padding, instead of two <section>s each owning a
               piece of the page's vertical rhythm. */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="px-5 sm:px-8 lg:px-12 pt-4 pb-12 md:pb-16 lg:pb-24 scroll-mt-24"
      >
        <h2 id="faq-heading" className="sr-only">Frequently asked questions</h2>
        <div className="mx-auto page-measure space-y-6">
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

          {/* Escape hatch to a human — at the BOTTOM (owner: "contact support
              at bottom"), which is where someone who has read the FAQ and
              still has a question actually ends up. Links to /support, never a
              raw `mailto:` — a mailto needs a configured mail client and does
              nothing at all inside the native app.

              The SAME card the legal tabs close with (PolicyFooter), not a
              lookalike — owner: "help center contact support should be more
              similar to legals". No right-hand slot here (owner): the policy
              tabs use it for their revision date, and the Help Center has no
              equivalent fact to put there. */}
          <PolicyFooter />
        </div>
      </section>
    </PublicLayout>
  );
};

export default HelpCenter;
