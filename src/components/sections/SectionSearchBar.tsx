import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * (owner 11-14 put Messages on the row). Measured at 320/360/375/390/414/430 in Chromium: "Search jobs" fits from
 * 360, "Search Declutter" and "Search jobs and items" from 414 (not at 390). Guard: src/test/navSoonAndTopMessages.test.tsx.
 */
export function nounHideClass(full: string): string {
  return full.length <= 12 ? "max-[359px]:hidden" : full.length <= 22 ? "max-[409px]:hidden" : "max-[449px]:hidden";
}

function Words({ noun }: { noun: string }) {
  const w = useNoun(noun);
  return <>{w.search}<span className={nounHideClass(`${w.search} ${w.noun}`)}> {w.noun}</span></>;
}

const BAR = "flex h-11 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-card pl-4 pr-1";

type FieldProps = { value: string; onChange: (v: string) => void; filter?: ReactNode };
type LinkProps = { value?: undefined; onChange?: undefined; filter?: undefined };

/**
 * THE SECTION SEARCH BAR (owner 11-08, the Vinted header): the phone top bar's rounded field, "Search <noun>", with
 * the Filters button inside its right end where the section has filters. Where the list it searches is on screen it
 * IS the field (Declutter's Browse: the feed, kept in ?q=). Elsewhere it is a button that takes the member to `home`
 * (the section's Browse) with the field focused. Guard: src/test/declutterHeaderVinted.test.tsx.
 */
export function SectionSearchBar(props: { noun: string; home: string } & (FieldProps | LinkProps)) {
  const { noun, home } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAsked = !!(location.state as { focusSectionSearch?: boolean } | null)?.focusSectionSearch;
  useEffect(() => {
    if (focusAsked) inputRef.current?.focus({ preventScroll: true });
  }, [focusAsked]);
  const words = useNoun(noun);
  const { t } = useLanguage();
  const label = `${words.search} ${words.noun}`;

  if (props.onChange === undefined) {
    return (
      // The shared Button (OWN-SHARED), worn as the bar: left-aligned, regular weight, no focus offset.
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        data-section-search-bar=""
        onClick={() => navigate(home, { state: FOCUS_SEARCH_STATE })}
        className={`${BAR} pr-4 justify-start py-0 text-left text-ds-16 font-normal tracking-normal text-muted-foreground`}
      >
        <Search className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span aria-hidden className="min-w-0 whitespace-nowrap text-ds-16"><Words noun={noun} /></span>
      </Button>
    );
  }
  const { value, onChange, filter } = props;
  return (
    <form role="search" aria-label={label} data-section-search-bar="" data-open="" onSubmit={(e) => e.preventDefault()}
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
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); } }}
        aria-label={label}
        enterKeyHint="search"
        className="text-ds-16 text-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      </span>
      {value && (
        <Button type="button" variant="ghost" size="iconCompact" aria-label={t("section.clearSearch")} onClick={() => { onChange(""); inputRef.current?.focus(); }}
          className="ctl-exit -my-px shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-4">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {filter && <span data-search-bar-filter="" className="flex shrink-0 items-center border-l border-border/60 pl-1">{filter}</span>}
    </form>
  );
}
