import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
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

// ─── Topic anchor slugs ───────────────────────────────────────────────────────
//
// Each section carries `id="faq-<slug>"`, which is what makes
// `/help#faq-payments-escrow` a real destination — the shape a support reply, a
// push deep link or a search result uses to send someone to ONE answer instead
// of to the top of a seven-section page.
//
// The ids were being stamped and nothing honoured them. The topic grid that
// once linked to them was deleted (owner, 2026-08-30: the grid and the
// accordion were the same list twice), and grepping `src/` for `href="#faq-`
// returns zero hits, so every one of these anchors pointed at a section that
// stayed collapsed even when the browser scrolled to it: the reader landed on
// a closed row with the answer still hidden. `useHashTarget` below is what
// makes the anchor do what the id promises.
const topicSlug = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The `faq-…` slug currently addressed by `location.hash`, live. */
function useHashTarget(): string | null {
  const read = () =>
    typeof window === "undefined" ? null : decodeURIComponent(window.location.hash.replace(/^#/, "")) || null;
  const [hash, setHash] = useState<string | null>(read);
  useEffect(() => {
    const onChange = () => setHash(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}


// Blurb lookup for the merged topic list — TOPICS still owns the copy even
// though its card grid is gone.
const topicDesc = (topic: string): string | undefined =>
  TOPICS.find((t) => t.label.toLowerCase() === topic.toLowerCase())?.desc;

// ─── TopicSection — collapsible topic wrapper ────────────────────────────────
const TopicSection = ({
  section,
  accent,
  targeted,
}: {
  section: { topic: string; items: Array<{ q: string; a: string }> };
  accent: string;
  /** True when `location.hash` addresses THIS section. */
  targeted: boolean;
}) => {
  // Collapsed by default at EVERY width (owner, 2026-08-25: "the tabs in help
  // center also should open as expanded. They should be collapsed").
  // This reverses the 2026-08-24 md+ auto-expand, which was trying to solve a
  // different problem — a desktop screen of nothing but category headers. The
  // answer to that is the spacing and the topic cards above, not seven
  // sections open at once: expanded-by-default made the page a wall of text
  // you had to scroll past to find the one question you came for, and it is
  // what pushed the real content so far below the title.
  //
  // The ONE exception is the section the URL asked for. `/help#faq-payments-escrow`
  // is a request for that topic, not for the page, so it opens and scrolls
  // itself into view — the browser's own anchor jump fires before React has
  // painted the section's contents, so `scroll-mt-24` alone lands the reader on
  // a closed row. `targeted` is a floor, never a lock: tapping the header still
  // closes it.
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState(false);
  const open = manualOpen || (targeted && !dismissed);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!targeted) {
      // Re-arm: navigating away and back to this anchor should open it again.
      setDismissed(false);
      return;
    }
    // rAF so the section's rows exist before we measure where to scroll to.
    const id = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [targeted]);

  return (
    <div
      ref={ref}
      id={`faq-${topicSlug(section.topic)}`}
      className="scroll-mt-24 rounded-2xl transition-colors duration-200"
      style={{
        // OPEN AND CLOSED HAVE TO LOOK DIFFERENT. Both states used to paint the
        // identical 0.04 wash and 0.15 hairline, so the only signal that a
        // section had opened was the chevron's rotation and whatever content
        // happened to be below the fold — on a seven-row list where every row
        // is the same height, that is not a state, it is a guess. Open leans on
        // the section's own accent (each topic already owns one) rather than a
        // new colour, so the page gains a state without gaining a palette.
        background: open ? "hsl(var(--burnt-sienna) / 0.09)" : "hsl(var(--burnt-sienna) / 0.04)",
        border: `1.5px solid hsl(var(--burnt-sienna) / ${open ? "0.34" : "0.15"})`,
        boxShadow: open ? "var(--elev-rest)" : "var(--elev-inset-hairline)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`faq-panel-${topicSlug(section.topic)}`}
        onClick={() => {
          setManualOpen((v) => !(v || (targeted && !dismissed)));
          if (targeted) setDismissed(true);
        }}
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
        <div id={`faq-panel-${topicSlug(section.topic)}`} className="px-5 sm:px-6 pb-2">
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
  const hash = useHashTarget();
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
    // Shared shell (PublicHeaderPage) — same component Legal, Jobs and
    // Support render through, so the header-to-body contract (24px above/
    // below the title, one gutter ladder, no double padding) lives in one
    // place (owner, 2026-08-30: "legal help center and jobs should all be
    // one component and share the same shell").
    //
    // No lede under the title (desktop-only marketing framing that restated
    // the title) and no search (removed — see the note at the top of the
    // component). The "Contact support" escape hatch closes the page.
    //
    // FAQ + contact support are still ONE block, not three (owner,
    // 2026-08-30: "this should be 1 component not 3" — the masthead heading
    // ("Quick answers.") is gone for the same reason: a second title next to
    // PageHeader's own "Help Center" repeated the page's own name).
    <PublicHeaderPage title="Help Center" width="public" bottomPaddingClassName="pb-12 md:pb-16 lg:pb-24">
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="scroll-mt-24"
      >
        <h2 id="faq-heading" className="sr-only">Frequently asked questions</h2>
        <div className="mx-auto page-measure space-y-6">
          <div className="space-y-3 sm:space-y-4">
            {FAQ_SECTIONS.map((section) => (
              <TopicSection
                key={section.topic}
                section={section}
                targeted={hash === `faq-${topicSlug(section.topic)}`}
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
          <PolicyFooter cta />
        </div>
      </section>
    </PublicHeaderPage>
  );
};

export default HelpCenter;
