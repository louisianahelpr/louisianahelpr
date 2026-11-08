import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";

/** Router state that asks Browse's field to take focus (a tap on another tab's bar). */
const FOCUS_SEARCH_STATE = { focusDeclutterSearch: true } as const;

/**
 * The bar's words, never cut (senior-mode-no-silent-cut): "Search Declutter", or "Search" alone below 360px, where
 * the bell and the photo leave the field about 100px (320: "Search Dec" was cut at the Filters edge). Drawn as a span
 * over the empty field, since a placeholder cannot change its words by width.
 */
function Words() {
  return <>Search<span className="max-[359px]:hidden"> Declutter</span></>;
}

const BAR = "flex h-11 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-card pl-4 pr-1";

/**
 * THE SEARCH BAR (owner 11-08, Declutter's Vinted header): its own full-width rounded row under the title, "Search
 * Declutter", with the Filters button inside its right end. On Browse it IS the field (it filters the feed, as the
 * old search square did, kept in ?q=). On Buying, Selling and the other tabs it is a button that takes the member
 * to Browse with the field focused. Guard: src/test/declutterHeaderVinted.test.tsx.
 */
export function DeclutterSearchBar(props: { value: string; onChange: (v: string) => void; filter?: ReactNode } | { value?: undefined; onChange?: undefined; filter?: undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAsked = !!(location.state as { focusDeclutterSearch?: boolean } | null)?.focusDeclutterSearch;
  useEffect(() => {
    if (focusAsked) inputRef.current?.focus({ preventScroll: true });
  }, [focusAsked]);

  if (props.onChange === undefined) {
    return (
      <button
        type="button"
        data-declutter-search-bar=""
        onClick={() => navigate("/declutter", { state: FOCUS_SEARCH_STATE })}
        className={`${BAR} pr-4 text-left text-muted-foreground ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <Search className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span className="min-w-0 whitespace-nowrap text-ds-16"><Words /></span>
      </button>
    );
  }
  const { value, onChange, filter } = props;
  return (
    <form role="search" aria-label="Search Declutter" data-declutter-search-bar="" data-open="" onSubmit={(e) => e.preventDefault()}
      className={`${BAR} focus-within:ring-2 focus-within:ring-ring`}>
      <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
      <span className="relative flex min-w-0 flex-1 items-center">
      {!value && <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-ds-16 text-muted-foreground"><Words /></span>}
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); } }}
        aria-label="Search Declutter"
        enterKeyHint="search"
        className="w-full min-w-0 bg-transparent text-ds-16 text-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      </span>
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => { onChange(""); inputRef.current?.focus(); }}
          className="ctl-exit flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
      {filter && <span data-search-bar-filter="" className="flex shrink-0 items-center border-l border-border/60 pl-1">{filter}</span>}
    </form>
  );
}
