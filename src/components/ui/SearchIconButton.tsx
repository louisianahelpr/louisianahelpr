import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Search } from "lucide-react";

/**
 * THE SEARCH ICON (owner 11-21, pop-up: page headers use "just the icon" for search). A plain magnifier, no circle and
 * no border, the same ghost square as the tabs row's filters and gear: 40px drawn, 44px to the finger (index.css's
 * button floor). A tap opens the page's field in its place (InlineListSearch, SectionSearchBar, SectionSearchRow,
 * MessagesSearchRow, Help, Saved Helprs); the field takes the focus, Escape or its X clears and folds it back into
 * this icon, and it stays open while words are in it.
 *
 * One component, so every header's magnifier is the same shape. Guard: src/test/searchIsAnIconEverywhere1121.test.tsx.
 */
export const SEARCH_ICON_BUTTON_CLASS =
  "h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-ds-md btn-press text-muted-foreground ctl-tint hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";

export const SearchIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children" | "aria-label"> & { label: string }
>(({ label, className = "", ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    aria-expanded={false}
    data-search-icon=""
    {...props}
    className={`${SEARCH_ICON_BUTTON_CLASS} ${className}`.trim()}
  >
    <Search className="w-5 h-5" aria-hidden />
  </button>
));
SearchIconButton.displayName = "SearchIconButton";
