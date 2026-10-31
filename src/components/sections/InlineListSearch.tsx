import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { DESKTOP_SEARCH_PILL_SURFACE, DESKTOP_SEARCH_PILL_WIDTH } from "./searchPill";

/**
 * THE SEARCH OPENS WHERE IT IS (owner, 2026-10-27, /jobs at 1440: "search should just open where its
 * at. not at the top but like open to the left of where it is").
 *
 * Closed: the 40px ghost square at the end of the toolbar row (the same square as Browse's "Search jobs").
 * Open: a field in the SAME place, on the same row, growing LEFTWARD out of the square: the row's other
 * controls keep their place and the status chips' scroller yields the width. The field takes focus when
 * it opens. It closes back into the square on its X, on Escape, or when it loses focus while empty.
 * Closing with X or Escape also clears the words, so a filter is never left on with no field to show it.
 *
 * It filters the tab's own list (Posted / Working: useActivityFilters' searchQuery, mirrored to ?q=),
 * the same way Browse's field filters the feed. Guard: src/test/jobsSearchOpensInPlace.test.tsx.
 */
export function InlineListSearch({ value, onChange, label, onOpenChange, fill = false }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Told when the field opens and closes (Posted / Working: the chip row keeps only its lit chip while it is open). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Phone only: the open field takes exactly the row's free width (`min-w-0 flex-1`) instead of its fixed
   * `clamp(200px,55vw,320px)`, for a row whose other control shrinks to make room (Posted / Working, audit
   * 2026-10-28 F20). It never pushes past the row: with "Not picked · 19" lit at 320 it gets 134px, still room
   * for "Search" and its X. Desktop keeps its 260px pill.
   */
  fill?: boolean;
}) {
  // Open on arrival when the address already carries words (?q=), so a filtered list always shows its field.
  const [open, setOpen] = useState(() => value.trim().length > 0);
  const desktop = useIsWebDesktop();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reopenFocus = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    onOpenChangeRef.current?.(open);
    if (open) inputRef.current?.focus();
    else if (reopenFocus.current) {
      reopenFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const close = (clear: boolean, focusTrigger: boolean) => {
    if (clear && value) onChange("");
    reopenFocus.current = focusTrigger;
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true, true);
    }
  };

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        data-jobs-search=""
        aria-label={label}
        title={label}
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-ds-md btn-press text-muted-foreground ctl-tint hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <Search className="w-5 h-5" aria-hidden />
      </button>
    );
  }

  return (
    <form
      role="search"
      aria-label={label}
      data-jobs-search=""
      data-open=""
      onSubmit={(e) => e.preventDefault()}
      className={
        desktop
          ? // The desktop pill (owner 2026-10-28, the mock-up's "Today" row; searchPill.ts).
            `${DESKTOP_SEARCH_PILL_SURFACE} ${DESKTOP_SEARCH_PILL_WIDTH} min-w-0 shrink flex items-center gap-2 pl-3.5 pr-1 focus-within:border-[hsl(var(--bark)/0.55)]`
          : `h-10 ${fill ? "search-fill min-w-0 flex-1 gap-1 pl-2" : "w-[clamp(200px,55vw,320px)] shrink-0 gap-1.5 pl-3"} flex items-center pr-1 rounded-full border border-border bg-card focus-within:ring-2 focus-within:ring-ring`
      }
    >
      {/* `search-fill-glyph`: below a 160px filling field the magnifier steps aside so "Search" stays whole (index.css). */}
      <Search className={`w-[18px] h-[18px] shrink-0 text-muted-foreground ${fill && !desktop ? "search-fill-glyph" : ""}`} aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Leaving for the X inside this field is not leaving the field.
          if (e.currentTarget.form?.contains(e.relatedTarget as Node | null)) return;
          if (!value.trim()) close(false, false);
        }}
        // Phone: the words fit the field at 375 (about 130px of room); the field's name is the full label.
        // Desktop: the pill has room for the label ("Search jobs…", the mock-up's words).
        placeholder={desktop ? `${label}…` : "Search"}
        aria-label={label}
        enterKeyHint="search"
        className={`flex-1 min-w-0 bg-transparent ${desktop ? "text-ds-15" : "text-ds-16"} text-foreground outline-none focus:outline-none focus-visible:outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden`}
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => close(true, true)}
        // Desktop: a 32px X inside the 42px pill (index.css's 44px tap floor would poke out of it; a mouse needs no 44).
        className={`ctl-exit ctl-tint w-8 h-8 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground ${desktop ? "!min-h-0 !min-w-0" : ""}`}
      >
        <X className="w-4 h-4" aria-hidden />
      </button>
    </form>
  );
}
