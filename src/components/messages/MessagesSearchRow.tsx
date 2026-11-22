import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { t } from "@/lib/i18n/language";
import { SearchIconButton } from "@/components/ui/SearchIconButton";

/**
 * The inbox's slim permanent search row (Q2231, owner 2026-10-19): on the phone and in the two-pane desktop list
 * (board 38), search, options and Active/All fold into this one row under the section tabs, its "more" menu at the
 * row's right edge. Moved verbatim out of ConversationList (Q806 god-component ratchet); the list keeps the query
 * state and builds the menu.
 *
 * JUST THE ICON (owner 11-21, pop-up): the row starts as the shared magnifier beside the "more" menu; a tap opens the
 * pill in its place, focused. Escape or its X clears and folds it back; it folds on leaving only while empty, so a
 * query stays visible. Guard: src/test/searchIsAnIconEverywhere1121.test.tsx.
 */
export function MessagesSearchRow({ value, onChange, moreMenu, inBar = false }: { value: string; onChange: (v: string) => void; moreMenu: ReactNode; inBar?: boolean }) {
  const [opened, setOpened] = useState(false);
  const open = opened || value.length > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const iconOnClose = useRef(false);
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      inputRef.current?.focus({ preventScroll: true });
    } else if (!open && iconOnClose.current) {
      iconOnClose.current = false;
      iconRef.current?.focus({ preventScroll: true });
    }
  }, [open]);
  const close = () => {
    if (value) onChange("");
    iconOnClose.current = true;
    setOpened(false);
  };
  // inBar (owner 11-14, the compact top): the row is the top bar's search, beside the bell and the photo, so it adds
  // no padding of its own under it.
  const wrap = inBar ? "shrink-0 min-w-0" : "shrink-0 pb-1.5";
  if (!open) {
    return (
      <div data-testid="messages-search-row" className={wrap}>
        <div className="flex h-11 items-center justify-end gap-1">
          <SearchIconButton ref={iconRef} label={t("chat.search")} onClick={() => { focusOnOpen.current = true; setOpened(true); }} />
          {moreMenu}
        </div>
      </div>
    );
  }
  return (
    <div data-testid="messages-search-row" className={wrap}>
      <div role="search" data-search-open="" className="flex h-11 items-center gap-1 rounded-full border border-border bg-card pl-3.5 max-[359px]:pl-2.5 pr-1">
        <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <span className="relative flex min-w-0 flex-1 items-center">
        {/* The field's words, never cut: "Search conversations", or "Search" alone below 460px, where Messages, the bell
            and the photo beside the field leave it too little room (measured: "Buscar conversaciones" still overran by
            1px at 450; owner 11-14 put Messages on the row; SectionSearchBar's nounHideClass, same rule). */}
        {!value && (
          <span aria-hidden data-search-words="" className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-ds-15 text-muted-foreground">
            {t("chat.searchShort")}<span className="max-[459px]:hidden"> {t("chat.searchNoun")}</span>
          </span>
        )}
        <input
          ref={inputRef}
          type="search"
          aria-label={t("chat.search")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
          onBlur={(e) => {
            // Leaving for the X or the menu inside this row is not leaving it; words keep it open.
            if (e.currentTarget.closest("[role=search]")?.contains(e.relatedTarget as Node | null)) return;
            if (!e.currentTarget.value) setOpened(false);
          }}
          enterKeyHint="search"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent pl-1.5 text-ds-15 outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        </span>
        <button
          type="button"
          aria-label={t("chat.closeSearch")}
          onClick={close}
          className="ctl-exit ctl-tint flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        {moreMenu}
      </div>
    </div>
  );
}
