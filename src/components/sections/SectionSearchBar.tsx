import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchIconButton } from "./SearchIconButton";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enSections";

/** Router state that asks a section's Browse field to take focus (a tap on another tab's bar). */
const FOCUS_SEARCH_STATE = { focusSectionSearch: true } as const;

/**
 * The bar's words, never cut (senior-mode-no-silent-cut): "Search Declutter" (etc.), or "Search" alone below 360px,
 * where the bell and the photo leave the field about 100px (320: "Search Dec" was cut at the Filters edge). Drawn as a
 * span over the empty field, since a placeholder cannot change its words by width.
 */
// F260q (owner 11-11): the bar's words in the reader's language; a noun not listed here is shown as given.
const NOUN_KEY: Record<string, MsgKey> = {
  jobs: "section.noun.jobs", "jobs and items": "section.noun.jobsAndItems", "posted jobs": "section.noun.postedJobs",
  "jobs you're working": "section.noun.jobsWorking", homes: "section.noun.homes", shops: "section.noun.shops",
  Declutter: "section.noun.declutter", "your listings": "section.noun.yourListings",
};
function useNoun(noun: string): { search: string; noun: string } {
  const { t } = useLanguage();
  const key = NOUN_KEY[noun];
  return { search: t("section.search"), noun: key ? t(key) : noun };
}

/**
 * The noun drops (never cut) below the width where it no longer fits beside the top row's Messages, bell and photo
 * (owner 11-14 put Messages on the row). Measured in Chromium at 320-450, English and Spanish: "Search jobs" fits
 * from 360, "Search Declutter" / "Buscar trabajos" from 410, "Buscar en Declutter" from 430 (not 414), "Buscar trabajos
 * y artículos" at 450. Guard: src/test/navSoonAndTopMessages.test.tsx.
 */
export function nounHideClass(full: string): string {
  return full.length <= 12 ? "max-[359px]:hidden" : full.length <= 16 ? "max-[409px]:hidden" : full.length <= 22 ? "max-[429px]:hidden" : "max-[449px]:hidden";
}

function Words({ noun }: { noun: string }) {
  const w = useNoun(noun);
  return <>{w.search}<span className={nounHideClass(`${w.search} ${w.noun}`)}> {w.noun}</span></>;
}

const BAR = "flex h-11 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-card pl-4 pr-1";

type FieldProps = { value: string; onChange: (v: string) => void; filter?: ReactNode };
type LinkProps = { value?: undefined; onChange?: undefined; filter?: undefined };

/**
 * THE SECTION SEARCH BAR (owner 11-08, the Vinted header): the phone top bar's search for a section, "Search <noun>",
 * with the Filters button beside it where the section has filters.
 *
 * JUST THE ICON (owner 11-21, pop-up: "just the icon" for search, everywhere a wide always-open box sat): it starts as
 * the shared magnifier (SearchIconButton), Filters beside it. Where the list it searches is on screen a tap opens the
 * rounded field IN PLACE, focused (the top bar hands it the row: AppTopBar reads `data-search-open`); Escape or its X
 * clears the words and folds it back into the icon; it folds on leaving only while empty, so a query stays visible.
 * It opens by itself when it already holds words (?q=) or another tab's icon asked for focus. Elsewhere the icon takes
 * the member to `home` (the section's Browse) with the field open and focused.
 * Guards: src/test/searchIsAnIconEverywhere1121.test.tsx, src/test/declutterHeaderVinted.test.tsx.
 */
export function SectionSearchBar(props: { noun: string; home: string } & (FieldProps | LinkProps)) {
  const { noun, home } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const focusAsked = !!(location.state as { focusSectionSearch?: boolean } | null)?.focusSectionSearch;
  const [opened, setOpened] = useState(focusAsked);
  const hasWords = !!props.value;
  const open = props.onChange !== undefined && (opened || hasWords);
  // Focus follows the tap that opened it (or the other tab's ask); never on a page load that merely carries ?q=.
  const focusOnOpen = useRef(focusAsked);
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
  useEffect(() => {
    if (!focusAsked) return;
    focusOnOpen.current = true;
    setOpened(true);
    inputRef.current?.focus({ preventScroll: true });
  }, [focusAsked]);
  const words = useNoun(noun);
  const { t } = useLanguage();
  const label = `${words.search} ${words.noun}`;

  if (props.onChange === undefined) {
    return (
      <SearchIconButton label={label} data-section-search-bar="" onClick={() => navigate(home, { state: FOCUS_SEARCH_STATE })} />
    );
  }
  const { value, onChange, filter } = props;
  const filterSlot = filter && <span data-search-bar-filter="" className="flex shrink-0 items-center">{filter}</span>;
  if (!open) {
    return (
      <div data-section-search-bar="" className="flex shrink-0 items-center justify-end gap-1">
        <SearchIconButton ref={iconRef} label={label} onClick={() => { focusOnOpen.current = true; setOpened(true); }} />
        {filterSlot}
      </div>
    );
  }
  const close = () => {
    if (value) onChange("");
    iconOnClose.current = true;
    setOpened(false);
  };
  return (
    <form role="search" aria-label={label} data-section-search-bar="" data-open="" data-search-open="" onSubmit={(e) => e.preventDefault()}
      className={`${BAR} focus-within:ring-2 focus-within:ring-ring`}>
      <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
      <span className="relative flex min-w-0 flex-1 items-center">
      {!value && <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-ds-16 text-muted-foreground"><Words noun={noun} /></span>}
      <Input
        look="bare"
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
        onBlur={(e) => {
          // Leaving for the X or Filters inside this field is not leaving it; words keep it open.
          if (e.currentTarget.form?.contains(e.relatedTarget as Node | null)) return;
          if (!e.currentTarget.value) setOpened(false);
        }}
        aria-label={label}
        enterKeyHint="search"
        className="text-ds-16 text-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      </span>
      <Button type="button" variant="ghost" size="iconCompact" aria-label={t("section.closeSearch")} onClick={close}
        className="ctl-exit -my-px shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-4">
        <X className="h-4 w-4" aria-hidden />
      </Button>
      {filter && <span data-search-bar-filter="" className="flex shrink-0 items-center border-l border-border/60 pl-1">{filter}</span>}
    </form>
  );
}
