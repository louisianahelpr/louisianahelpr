import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";

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
export function InlineListSearch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  // Open on arrival when the address already carries words (?q=), so a filtered list always shows its field.
  const [open, setOpen] = useState(() => value.trim().length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reopenFocus = useRef(false);

  useEffect(() => {
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
      className="h-10 w-[clamp(200px,55vw,320px)] shrink-0 flex items-center gap-1.5 pl-3 pr-1 rounded-full border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      <Search className="w-[18px] h-[18px] shrink-0 text-muted-foreground" aria-hidden />
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
        // The words fit the field at 375 (about 130px of room); the field's name is the full label.
        placeholder="Search"
        aria-label={label}
        enterKeyHint="search"
        className="flex-1 min-w-0 bg-transparent text-ds-16 text-foreground outline-none focus:outline-none focus-visible:outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => close(true, true)}
        className="ctl-exit ctl-tint w-8 h-8 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <X className="w-4 h-4" aria-hidden />
      </button>
    </form>
  );
}
