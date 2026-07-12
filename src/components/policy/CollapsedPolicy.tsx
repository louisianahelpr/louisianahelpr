import React, { useState, useMemo, useEffect, createContext, useContext, Children, isValidElement, cloneElement, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Shared search state — Legal page wraps the tab content in
// <PolicySearchContext.Provider value={query}> so every PolicySection
// and PolicyRowItem can self-filter / auto-expand based on the query
// without having to thread the prop through every JSX call site.
export const PolicySearchContext = createContext<string>("");

// During a cross-tab search the Legal page renders all three policy tabs
// at once; this carries the human label of the tab a section belongs to
// ("Terms", "Community Rules", "Privacy") so each result can show where it
// lives. Empty string = normal single-tab browsing (no origin chip).
export const PolicyTabContext = createContext<string>("");

// Wrap any case-insensitive occurrences of `query` in the given text with a
// highlight <mark>, so search results visibly point at the matched term.
const highlight = (text: string, query: string): React.ReactNode => {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  if (!lower.includes(ql)) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let i = lower.indexOf(ql);
  while (i !== -1) {
    if (i > cursor) parts.push(text.slice(cursor, i));
    parts.push(
      <mark
        key={i}
        className="rounded px-0.5"
        style={{
          background: "hsl(var(--burnt-sienna) / 0.18)",
          color: "hsl(var(--ink-deep))",
        }}
      >
        {text.slice(i, i + q.length)}
      </mark>,
    );
    cursor = i + q.length;
    i = lower.indexOf(ql, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
};

// Recursively wrap query matches inside arbitrary React children (leaf strings
// only). Any element whose `type` is in SKIP_TYPES — links, code, mark itself
// — is left untouched so we don't wrap link labels or inline code. When the
// element has children, we recurse and rebuild it via cloneElement.
const SKIP_TAGS = new Set(["a", "code", "pre", "kbd", "mark"]);
const isSkippedType = (t: unknown): boolean => {
  if (typeof t === "string") return SKIP_TAGS.has(t);
  // React Router <Link> and other components render as functions/objects;
  // skip anything whose displayName / name looks like a link, to be safe.
  if (typeof t !== "function" && (typeof t !== "object" || t === null)) return false;
  const name = (t as { displayName?: string; name?: string }).displayName
    ?? (t as { name?: string }).name;
  if (!name) return false;
  return name === "Link" || name === "NavLink" || name === "Anchor";
};

const highlightChildren = (
  node: React.ReactNode,
  query: string,
): React.ReactNode => {
  if (!query.trim()) return node;
  if (node == null || typeof node === "boolean") return node;
  if (typeof node === "string") return highlight(node, query);
  if (typeof node === "number") return node;
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={i}>{highlightChildren(child, query)}</React.Fragment>
    ));
  }
  if (isValidElement(node)) {
    if (isSkippedType(node.type)) return node;
    const props = node.props as { children?: React.ReactNode };
    if (props.children === undefined) return node;
    return cloneElement(
      node,
      undefined,
      highlightChildren(props.children, query),
    );
  }
  return node;
};

export type PolicyRow = {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
  warning?: boolean;
  /** Optional plain-text content blob used purely for search matching.
   *  Pass when `body` contains text that should be findable but the
   *  caller doesn't want to traverse the rendered tree at runtime. */
  searchText?: string;
};

const matches = (query: string, haystack: string) =>
  !query.trim() || haystack.toLowerCase().includes(query.trim().toLowerCase());

export const PolicyRowItem = ({ icon: Icon, title, body, warning, searchText }: PolicyRow) => {
  const query = useContext(PolicySearchContext);
  const isSearching = !!query.trim();
  const [open, setOpen] = useState(false);

  const haystack = useMemo(
    () => `${title} ${searchText ?? ""}`,
    [title, searchText],
  );
  const hit = matches(query, haystack);

  // When searching, only render matching rows AND force them open so
  // the user can read the matching body without an extra tap.
  if (isSearching && !hit) return null;
  const effectiveOpen = isSearching ? true : open;

  return (
    <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-ds-md text-left transition-colors btn-press hover:bg-primary/5"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {/* Caution is conveyed purely by the icon tint — a warm
              burnt-sienna pill instead of the plain sage primary one.
              No full-row wash: every row reads as one consistent set. */}
          <span
            className={`shrink-0 w-7 h-7 rounded-ds-sm flex items-center justify-center ${warning ? "" : "bg-primary/10 text-primary"}`}
            style={
              warning
                ? { background: "hsl(var(--burnt-sienna) / 0.14)", color: "hsl(var(--burnt-sienna))" }
                : undefined
            }
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
          </span>
          {/* Two-line clamp so long item labels ("Job budget limits —
              $10 minimum, $5,000 maximum") read in full instead of
              truncating to "$5,00…". */}
          <span className="text-ds-13 font-semibold text-foreground line-clamp-2 leading-snug">
            {isSearching ? highlight(title, query) : title}
          </span>
        </span>
        {/* ChevronDown that rotates 180° on open — matches the parent
            PolicySection accordion language. The previous ChevronRight
            implied "tap to navigate forward" but this is an inline
            expand. */}
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${effectiveOpen ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
        <div className="px-3 pt-2 pb-3 text-ds-11 text-muted-foreground space-y-1.5 border-l-2 border-border/40 ml-5 my-1">
          {isSearching ? highlightChildren(body, query) : body}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

interface PolicySectionProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  warning?: boolean;
  defaultOpen?: boolean;
  /** Anchor slug used for deep-links (e.g. `/legal?tab=privacy#data-retention`).
   *  When the URL hash matches this slug, the section auto-expands and the
   *  page scrolls it into view. Rendered as the section's DOM `id` so
   *  browser hash navigation works without extra JS. */
  anchorId?: string;
  children: ReactNode;
}

export const PolicySection = ({ icon: Icon, title, subtitle, warning, defaultOpen = false, anchorId, children }: PolicySectionProps) => {
  const query = useContext(PolicySearchContext);
  const tabLabel = useContext(PolicyTabContext);
  const isSearching = !!query.trim();
  const [open, setOpen] = useState(defaultOpen);

  // Auto-open + scroll into view when the page URL hash targets this
  // section. We listen to hashchange so an in-page anchor link tap from
  // another section also triggers the expand. The 1-frame delay lets the
  // Collapsible finish its open animation before we scroll, so the final
  // position lands the heading at the top of the viewport rather than
  // mid-animation.
  useEffect(() => {
    if (!anchorId) return;
    const checkHash = () => {
      const hash = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#/, "");
      if (hash && hash === anchorId) {
        setOpen(true);
        requestAnimationFrame(() => {
          const el = document.getElementById(anchorId);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [anchorId]);

  // A section is "hit" when its own title/subtitle match, OR when at
  // least one PolicyRowItem child matches (the section is the gateway
  // to find the matching row). We inspect children's `title`/`searchText`
  // props directly so a non-matching section can fully remove itself
  // during search instead of rendering an empty open card.
  const childMatches = Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    const props = child.props as Partial<PolicyRow>;
    return matches(query, `${props.title ?? ""} ${props.searchText ?? ""}`);
  });
  const sectionHit = matches(query, `${title} ${subtitle}`) || childMatches;

  // While searching, a section that matches nothing (header or any row)
  // removes itself entirely so the results read as a tight list.
  if (isSearching && !sectionHit) return null;

  // Force-open while searching so matching rows are visible without
  // the user having to tap each section header. Outside of search,
  // behave as a normal Collapsible.
  const effectiveOpen = isSearching ? true : open;

  return (
    <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
      {/* Every section card is the same clean white-on-border surface —
          no muddy destructive wash. A `warning` section is marked only
          by a crisp burnt-sienna left accent edge + a small "Caution"
          chip in the header, so all cards on the page read as one set. */}
      <div
        data-policy-section
        id={anchorId}
        className="rounded-2xl border border-border bg-card squircle overflow-hidden transition-colors scroll-mt-24"
        style={{
          // Soft lift matching the TLDR summary card so every surface on the
          // page reads as one lifted material rather than flat-white rows
          // floating below a shadowed summary.
          boxShadow:
            "0 1px 2px hsl(var(--olivewood) / 0.05), 0 6px 14px -8px hsl(var(--olivewood) / 0.12)",
          borderLeft: warning
            ? "3px solid hsl(var(--burnt-sienna) / 0.55)"
            : "3px solid hsl(var(--bark) / 0.35)",
        }}
      >
        <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left btn-press">
          <span className="flex items-center gap-3 min-w-0">
            <span
              className={`shrink-0 w-9 h-9 rounded-ds-md flex items-center justify-center ${warning ? "" : "bg-primary/12 text-primary"}`}
              style={
                warning
                  ? { background: "hsl(var(--burnt-sienna) / 0.14)", color: "hsl(var(--burnt-sienna))" }
                  : undefined
              }
            >
              <Icon className="w-4 h-4" strokeWidth={2.25} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <p className="font-display font-bold text-foreground leading-tight text-ds-15">
                  {isSearching ? highlight(title, query) : title}
                </p>
                {/* During a cross-tab search, mark which policy this section
                    lives under so results spanning all three tabs stay
                    legible. Only shown when a tab origin is supplied. */}
                {isSearching && tabLabel && (
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-sans font-semibold uppercase tracking-wider"
                    style={{
                      background: "hsl(var(--bark) / 0.10)",
                      color: "hsl(var(--bark))",
                    }}
                  >
                    {tabLabel}
                  </span>
                )}
                {warning && (
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-sans font-semibold uppercase tracking-wider"
                    style={{
                      background: "hsl(var(--burnt-sienna) / 0.06)",
                      color: "hsl(var(--burnt-sienna))",
                    }}
                  >
                    Caution
                  </span>
                )}
              </span>
              <p className="text-ds-11 text-muted-foreground line-clamp-2 leading-snug">
                {isSearching ? highlight(subtitle, query) : subtitle}
              </p>
            </span>
          </span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${effectiveOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className="px-2 pb-2 pt-1 space-y-0.5 border-t border-border/50">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
