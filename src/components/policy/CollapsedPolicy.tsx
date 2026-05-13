import { useState, useMemo, createContext, useContext, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Shared search state — Legal page wraps the tab content in
// <PolicySearchContext.Provider value={query}> so every PolicySection
// and PolicyRowItem can self-filter / auto-expand based on the query
// without having to thread the prop through every JSX call site.
export const PolicySearchContext = createContext<string>("");

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
        className={`group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-ds-md text-left transition-colors btn-press ${warning ? "hover:bg-destructive/10" : "hover:bg-primary/5"}`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${warning ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
          </span>
          {/* Two-line clamp so long item labels ("Job budget limits —
              $5 minimum, $5,000 maximum") read in full instead of
              truncating to "$5,00…". */}
          <span className="text-ds-13 font-semibold text-foreground line-clamp-2 leading-snug">
            {title}
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
          {body}
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
  children: ReactNode;
}

export const PolicySection = ({ icon: Icon, title, subtitle, warning, defaultOpen = false, children }: PolicySectionProps) => {
  const query = useContext(PolicySearchContext);
  const isSearching = !!query.trim();
  const [open, setOpen] = useState(defaultOpen);

  // A section is "hit" when its own title/subtitle match, OR when at
  // least one PolicyRowItem child matches (the section is the gateway
  // to find the matching row). Children matching is implicit: matching
  // PolicyRowItem children render normally while non-matching ones
  // hide themselves via their own self-filter.
  const sectionHit = matches(query, `${title} ${subtitle}`);

  // Force-open while searching so matching rows are visible without
  // the user having to tap each section header. Outside of search,
  // behave as a normal Collapsible.
  const effectiveOpen = isSearching ? true : open;

  return (
    <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
      <div className={`rounded-2xl border squircle overflow-hidden transition-colors ${warning ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"}`}>
        <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left btn-press">
          <span className="flex items-center gap-3 min-w-0">
            <span className={`shrink-0 w-9 h-9 rounded-ds-md flex items-center justify-center ${warning ? "bg-destructive/15 text-destructive" : "bg-primary/12 text-primary"}`}>
              <Icon className="w-4 h-4" strokeWidth={2.25} />
            </span>
            <span className="min-w-0">
              <p className="font-display font-bold text-foreground leading-tight text-ds-15">{title}</p>
              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">{subtitle}</p>
            </span>
          </span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${effectiveOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className="px-2 pb-2 pt-1 space-y-0.5 border-t border-border/50">{children}</div>
        </CollapsibleContent>
      </div>
      {/* When searching and neither the section header nor any child
          matched, the section still renders so the layout stays stable —
          but it can show a faint "(no matches)" hint. Keeping it out
          for now to avoid noise; uncomment if testers ask for it. */}
      {isSearching && !sectionHit && null}
    </Collapsible>
  );
};
