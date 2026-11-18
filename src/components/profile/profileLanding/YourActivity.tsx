import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, openingSoonLine } from "@/components/mobileNav/useSectionTabs";
import { useHomeSummary } from "@/pages/home/homeDashboard/useHomeSummary";
import type { SectionKey } from "@/components/sections/sectionsConfig";
import { GlassTileButton } from "@/components/ui/GlassTileButton";
import "@/lib/i18n/enYourPage";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import { navKey } from "@/lib/i18n/navLabels";

/** What the member reads on each tile (design audit r2 #31); the English labels stay the tiles' ids. */
const TILE_KEY: Record<string, MsgKey> = {
  Posted: "yp.you.tile.posted",
  Working: "yp.you.tile.working",
  Buying: "yp.you.tile.buying",
  Selling: "yp.you.tile.selling",
  Orders: "yp.you.tile.orders",
  "My shop": "yp.you.tile.myShop",
  Renting: "yp.you.tile.renting",
  Owning: "yp.you.tile.owning",
};
const COUNT_KEY: Record<CountKey, MsgKey> = {
  posted: "yp.you.count.posted",
  working: "yp.you.count.working",
  selling: "yp.you.count.selling",
  shopOrders: "yp.you.count.shopOrders",
  buying: "yp.you.count.buying",
};

type CountKey = "posted" | "working" | "selling" | "shopOrders" | "buying";

/**
 * F088 (owner UI audit 11-09): a count alone ("Selling · 255") said nothing at a glance. Each count carries its status
 * word ("255 live", "1 booked"). Owner 2026-11-17 (signed-in tweaks, item 8): a count that has answered 0 reads
 * "None yet" rather than a bare label; a count still loading shows nothing (never a false "None yet").
 */
const COUNT_WORD: Record<CountKey, string> = {
  posted: "live",
  working: "booked",
  selling: "live",
  shopOrders: "open",
  buying: "in progress",
};

/**
 * Board 18 "YOUR ACTIVITY": both sides of every section, two tiles each, in the
 * member's Customize order (hidden sections hidden). A count only when it is
 * real and non-zero ("Posted · 2"). A section not open to this viewer has NO
 * tiles (owner, 2026-10-21: six dead "Opening soon" tiles were clutter); one
 * quiet line names them all instead ("Declutter, Shops and Homes are opening
 * soon"), spec v2 §1.8.
 */
export const ACTIVITY_TILES: Record<SectionKey, readonly { label: string; to: string; count?: CountKey }[]> = {
  jobs: [
    { label: "Posted", to: "/jobs?tab=posted", count: "posted" },
    { label: "Working", to: "/jobs?tab=working", count: "working" },
  ],
  declutter: [
    { label: "Buying", to: "/declutter?tab=buying", count: "buying" },
    { label: "Selling", to: "/declutter?tab=selling", count: "selling" },
  ],
  shops: [
    { label: "Orders", to: "/shops?tab=orders", count: "shopOrders" },
    { label: "My shop", to: "/shops?tab=shop" },
  ],
  homes: [
    { label: "Renting", to: "/rentals?tab=rent" },
    { label: "Owning", to: "/rentals?tab=own" },
  ],
};

export function YourActivity() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const summary = useHomeSummary(user);
  const { visible } = useSectionPrefs();
  const live = useSectionTabs();
  const { t: tr } = useLanguage();
  const sectionName = (s: { path: string; label: string }) => { const k = navKey(s.path, s.label); return k ? tr(k) : s.label; };

  const isOn = (s: (typeof visible)[number]) => s.feature === null || !!live.find((t) => t.path === s.path)?.on;
  // A section not yet open to everyone is not listed (owner 10-31 in the app; owner 2026-11-17 on the website too, for
  // testers as well: Shops' and Homes' "Coming soon" tiles are gone until they launch), via the tab's `listed` answer.
  const isListedHere = (s: (typeof visible)[number]) => live.find((t) => t.path === s.path)?.listed !== false;
  const open = visible.filter((s) => isOn(s) && isListedHere(s));
  // M8/M9 (owner 11-16): a section closed to the viewer is not listed, so the line never names it.
  const soon = openingSoonLine(visible.filter((s) => !isOn(s) && isListedHere(s)).map((s) => s.label));

  return (
    <section aria-label={tr("yp.you.activity")} className="flex flex-col gap-2" data-testid="you-activity">
      <h2 className="px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{tr("yp.you.activity")}</h2>
      {/* Every row is one height (auto-rows-fr). */}
      <div className="grid grid-cols-2 auto-rows-fr gap-2.5">
        {open.flatMap((s) =>
          ACTIVITY_TILES[s.key].map((t) => {
            const n = t.count ? summary.counts[t.count] ?? 0 : 0;
            const word = t.count ? COUNT_WORD[t.count] : "";
            const label = TILE_KEY[t.label] ? tr(TILE_KEY[t.label]) : t.label;
            const countLine = t.count ? tr(COUNT_KEY[t.count], { n }) : `${n} ${word}`;
            const section = sectionName(s);
            const status = n > 0 ? countLine : t.count && summary.countsKnown?.[t.count] ? tr("yp.you.count.none") : "";
            return (
              <GlassTileButton
                key={`${s.key}-${t.label}`}
                data-activity-tile={`${s.key}:${t.label}`}
                onClick={() => navigate(t.to)}
                title={`${section} ${label}${status ? ` · ${status}` : ""}`}
                className="px-4 py-3"
              >
                {/* No aria-label: the tile's words ("Jobs Posted 2") are its name, so the visible text is in it (axe
                    label-content-name-mismatch, WCAG 2.5.3; ui-sweep #3491). The space keeps the two lines two words;
                    whitespace between flex items draws nothing. */}
                <span className="text-ds-12 text-muted-foreground">{section}</span>{" "}
                {/* F449 (audit 11-10): at 375 "Buying · 1 in progress" was cut to "Buying · 1 in ..." by truncate; it wraps.
                    F260a (11-14): wrapped once its count came in, it grew its row 24 px under the reader at 360-390
                    (cwv-lab 375: 0.0114 of /profile's 0.1518). A tile that can carry a count keeps room for two lines
                    on a phone (2 x line-height 1.5 = 3em); from sm up the longest one fits on one line. */}
                <span className={`text-ds-15 font-bold text-foreground break-words${t.count ? " min-h-[3em] sm:min-h-0" : ""}`}>
                  {label}
                  {status && <><span aria-hidden="true"> ·</span> <span data-activity-status="" className={n > 0 ? undefined : "font-normal text-muted-foreground"}>{status}</span></>}
                </span>
              </GlassTileButton>
            );
          }),
        )}
      </div>
      {soon && <p data-testid="you-activity-soon" className="px-1 text-ds-13 text-muted-foreground">{soon}</p>}
    </section>
  );
}
