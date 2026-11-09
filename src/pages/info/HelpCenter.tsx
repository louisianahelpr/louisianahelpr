import { ListRow } from "@/components/ui/ListRow";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { FieldClearButton } from "@/components/ui/FieldClearButton";
import { Input } from "@/components/ui/input";
import FaqRow from "@/components/marketing/FaqRow";
// The card that closes every legal policy tab. Shared, not copied, so the
// Help Center and the policy pages cannot drift into two support cards.
import { PolicyFooter } from "@/pages/info/legal/LegalChrome";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useFeature } from "@/hooks/useFeature";
import { withDeclutterShipping } from "./declutterShippingCopy";
import {
  TOPICS,
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
 * Preserves the existing helpCenterContent data source (TOPICS, FAQ_SECTIONS)
 * verbatim. Topics paint in one style (spec v2: no per-section colours).
 */

// ─── Topic anchor slugs ───────────────────────────────────────────────────────
//
// Each section carries `id="faq-<slug>"`, which is what makes
// `/help#faq-payments-how-your-money-is-held` a real destination — the shape a support reply, a
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

/**
 * Anchors a renamed topic used to have. A support reply, a notice or a search
 * result sent before the rename still opens the topic it meant (JOBS-28:
 * "Payments & Escrow" became "Payments & how your money is held").
 */
// @two-way src/pages/info/HelpCenter.test.tsx:stale topic anchor alias
export const LEGACY_TOPIC_ANCHORS: Readonly<Record<string, string>> = {
  "faq-payments-escrow": "faq-payments-how-your-money-is-held",
};

/** The `faq-…` slug currently addressed by `location.hash`, live. */
function useHashTarget(): string | null {
  const read = () => {
    if (typeof window === "undefined") return null;
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, "")) || null;
    return raw ? LEGACY_TOPIC_ANCHORS[raw] ?? raw : null;
  };
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
/** "Trust & Safety" -> "Trust & safety" (spec v2: sentence case). */
const sentenceCase = (t: string): string => t.charAt(0) + t.slice(1).toLowerCase();

const TopicSection = ({
  section,
  targeted,
  searching = false,
}: {
  section: { topic: string; items: Array<{ q: string; a: string }> };
  /** True when `location.hash` addresses THIS section. */
  targeted: boolean;
  /** F034: a search is on, so this (matching) section shows its matches open. */
  searching?: boolean;
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
  // The ONE exception is the section the URL asked for. `/help#faq-trust-safety`
  // is a request for that topic, not for the page, so it opens and scrolls
  // itself into view — the browser's own anchor jump fires before React has
  // painted the section's contents, so `scroll-mt-24` alone lands the reader on
  // a closed row. `targeted` is a floor, never a lock: tapping the header still
  // closes it.
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState(false);
  const open = searching || manualOpen || (targeted && !dismissed);
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
      // Spec v2 rebuild (audit 2026-10-21): the ONE card (white, 20px radius,
      // 1px --line border) for every topic. No per-topic colours, no rust
      // wash, no uppercase tracked label. Open vs closed still differ: an open
      // topic's border turns olive, so the state is never only the chevron.
      className={`scroll-mt-24 rounded-[20px] border bg-card transition-colors duration-200 ${open ? "border-[hsl(var(--bark)/0.45)]" : "border-border"}`}
    >
      <ListRow variant="flush"
        aria-expanded={open}
        aria-controls={`faq-panel-${topicSlug(section.topic)}`}
        onClick={() => {
          setManualOpen((v) => !(v || (targeted && !dismissed)));
          if (targeted) setDismissed(true);
        }}
        className="w-full flex items-center justify-between gap-6 py-4 sm:py-5 px-5 sm:px-6 text-left transition-opacity hover:opacity-80 min-h-11"
      >
        <span className="inline-flex flex-col gap-0.5 min-w-0">
          <span className="font-sans font-bold text-ds-15 text-foreground leading-snug">
            {sentenceCase(section.topic)}
          </span>
          {/* F035 (owner UI audit 11-09): the count beside the name looked like an unread badge. It is said in words,
              muted, on the line under the name ("4 questions"), after the topic's blurb. */}
          <span className="font-sans text-ds-13 text-muted-foreground" data-help-topic-count="">
            {topicDesc(section.topic) ? `${topicDesc(section.topic)} · ` : ""}
            {section.items.length === 1 ? "1 question" : `${section.items.length} questions`}
          </span>
        </span>
        <ChevronDown
          className="w-5 h-5 shrink-0 transition-transform duration-200"
          style={{
            color: "hsl(var(--olivewood))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          aria-hidden
        />
      </ListRow>
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

// ─── Search ───────────────────────────────────────────────────────────────────

type FaqSection = { topic: string; items: Array<{ q: string; a: string }> };

/**
 * F034 (owner UI audit 11-09; the owner decided 11-09 to ADD the search back, reversing the 2026-08-22 removal):
 * the questions whose question or answer holds every word typed, case-insensitive, grouped under their topics.
 * An empty query returns the sections unchanged. Exported for the guard.
 */
export function filterFaqSections(sections: readonly FaqSection[], query: string): FaqSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...sections];
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        const text = `${s.topic} ${i.q} ${i.a}`.toLowerCase();
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((s) => s.items.length > 0);
}

// ─── HelpCenter ───────────────────────────────────────────────────────────────

const HelpCenter = () => {
  const hash = useHashTarget();
  // F034: "Search help" at the top filters the questions as you type (owner 2026-11-09, reversing the 2026-08-22
  // "no search on this page" decision: people had to open every topic to find an answer). Matching topics open
  // with only their matching questions; no match says so and points at Contact support below.
  const [query, setQuery] = useState("");

  // Same table api/share.ts serves pre-JS (src/lib/publicPageMeta.mjs).
  usePageMeta(PUBLIC_PAGE_META["/help"]);
  // An answer that names the ID check reads the identity_check switch (helpCenterContent's getter); re-render when it changes.
  useIdentityCheckOnStore();
  // Shipping answers show only where Declutter shipping is on (switch declutter_shipping); elsewhere "Shipping isn't
  // offered." stays, and stays true (declutterShippingCopy.ts).
  const shippingOn = useFeature("declutter_shipping");
  const allSections = shippingOn ? withDeclutterShipping(FAQ_SECTIONS) : FAQ_SECTIONS;
  const searching = query.trim().length > 0;
  const sections = filterFaqSections(allSections, query);

  return (
    // Shared shell (PublicHeaderPage) — same component Legal, Jobs and
    // Support render through, so the header-to-body contract (24px above/
    // below the title, one gutter ladder, no double padding) lives in one
    // place (owner, 2026-08-30: "legal help center and jobs should all be
    // one component and share the same shell").
    //
    // No lede under the title (desktop-only marketing framing that restated
    // the title). "Search help" opens the column (F034, owner 2026-11-09).
    // The "Contact support" escape hatch closes the page.
    //
    // FAQ + contact support are still ONE block, not three (owner,
    // 2026-08-30: "this should be 1 component not 3" — the masthead heading
    // ("Quick answers.") is gone for the same reason: a second title next to
    // PageHeader's own "Help Center" repeated the page's own name).
    <PublicHeaderPage title="Help center" width="public" bottomPaddingClassName="pb-12 md:pb-16 lg:pb-24">
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="scroll-mt-24"
      >
        <h2 id="faq-heading" className="sr-only">Frequently asked questions</h2>
        {/* F033 (owner UI audit 11-09): a reading measure on the answers, centred. At 1440 they ran ~1,250px a line. */}
        <div className="mx-auto page-measure max-w-[760px] space-y-section" data-help-measure="">
          <div className="relative" data-help-search="">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search help"
              aria-label="Search help"
              enterKeyHint="search"
              className="h-12 w-full rounded-full border border-border bg-card pl-11 pr-11 text-ds-15 font-sans text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] [&::-webkit-search-cancel-button]:hidden"
            />
            {/* The shared field ✕ (FieldClearButton), so a press keeps it under the pointer (pressKeepsTranslate). */}
            {searching && (
              <FieldClearButton onClick={() => setQuery("")} aria-label="Clear search" className="right-3 rounded-full">
                <X className="h-4 w-4" aria-hidden />
              </FieldClearButton>
            )}
          </div>
          <div className="space-y-3 sm:space-y-4">
            {sections.map((section) => (
              <TopicSection
                key={section.topic}
                section={section}
                targeted={hash === `faq-${topicSlug(section.topic)}`}
                searching={searching}
              />
            ))}
            {searching && sections.length === 0 && (
              <p role="status" data-help-no-match="" className="rounded-[20px] border border-border bg-card px-5 py-4 text-ds-15 font-sans text-muted-foreground">
                No answers match "{query.trim()}". Try other words, or contact support below.
              </p>
            )}
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
          {/* Owner, 2026-10-07 (Q1028): "Report a bug" opens the support form on
              "Something's not working", which attaches the screen, route,
              device, build and recent errors. /support, not the Profile tab:
              this page is public, and /support serves guests and members. */}
          <p className="text-center text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
            Something not working?{" "}
            <Link to="/support?topic=report" className="link-standard font-semibold" style={{ color: "hsl(var(--bark))" }}>
              Report a bug
            </Link>
          </p>
        </div>
      </section>
    </PublicHeaderPage>
  );
};

export default HelpCenter;
