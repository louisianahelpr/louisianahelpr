import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import FaqRow from "@/components/marketing/FaqRow";
// The card that closes every legal policy tab. Shared, not copied, so the
// Help Center and the policy pages cannot drift into two support cards.
import { PolicyFooter } from "@/pages/info/legal/LegalChrome";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { MEMBERSHIPS_HIDDEN_IN_THIS_APP } from "@/hooks/useMembershipsOn";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
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
}: {
  section: { topic: string; items: Array<{ q: string; a: string }> };
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
  // The ONE exception is the section the URL asked for. `/help#faq-trust-safety`
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
      // Spec v2 rebuild (audit 2026-10-21): the ONE card (white, 20px radius,
      // 1px --line border) for every topic. No per-topic colours, no rust
      // wash, no uppercase tracked label. Open vs closed still differ: an open
      // topic's border turns olive, so the state is never only the chevron.
      className={`scroll-mt-24 rounded-[20px] border bg-card transition-colors duration-200 ${open ? "border-[hsl(var(--bark)/0.45)]" : "border-border"}`}
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
        <span className="inline-flex flex-col gap-0.5 min-w-0">
          <span className="font-sans font-bold text-ds-15 text-foreground leading-snug">
            {sentenceCase(section.topic)}
            {/* The count is real (this topic's question list), muted, and
                hidden from a screen reader, which already hears the name. */}
            <span aria-hidden className="ml-2 font-medium text-ds-13 text-muted-foreground">
              {section.items.length}
            </span>
          </span>
          {topicDesc(section.topic) && (
            <span className="font-sans text-ds-13 text-muted-foreground">{topicDesc(section.topic)}</span>
          )}
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

  // Same table api/share.ts serves pre-JS (src/lib/publicPageMeta.mjs).
  usePageMeta(PUBLIC_PAGE_META["/help"]);
  // An answer that names the ID check reads the identity_check switch (helpCenterContent's getter); re-render when it changes.
  useIdentityCheckOnStore();

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
    <PublicHeaderPage title="Help center" width="public" bottomPaddingClassName="pb-12 md:pb-16 lg:pb-24">
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="scroll-mt-24"
      >
        <h2 id="faq-heading" className="sr-only">Frequently asked questions</h2>
        <div className="mx-auto page-measure space-y-section">
          <div className="space-y-3 sm:space-y-4">
            {/* The store app never shows memberships (useMembershipsOn), so
                their plans, prices and billing answers are left out there. */}
            {FAQ_SECTIONS.filter((section) => !(MEMBERSHIPS_HIDDEN_IN_THIS_APP && section.topic === "Membership & Billing")).map((section) => (
              <TopicSection
                key={section.topic}
                section={section}
                targeted={hash === `faq-${topicSlug(section.topic)}`}
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
