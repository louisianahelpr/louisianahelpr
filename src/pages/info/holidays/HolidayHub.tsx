/**
 * /holidays, the Louisiana Holiday Hub (owner-approved 2026-11-20): three cards (Christmas lights, Holiday events, Hire a
 * Helpr for the holidays) on the white page, in the site's own type. The only holiday touch is a thin classic-Christmas
 * rule on each card (hunter green, oxblood, antique gold: the 25 Days palette, owner 11-09). No data is loaded here: each
 * list ships in its own page's chunk. Linked from the footer and the gift guides landing. Guard: src/test/holidayHub.test.tsx.
 */
import { Link } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { HOLIDAY_EVENTS_PATH, HOLIDAY_HIRE_PATH, HOLIDAY_LIGHTS_PATH, HOLIDAY_WORDS as W } from "@/content/holidayHub/holidayHub.mjs";
import { HUB_COLUMN, HUB_HEADER_COLUMN, useHolidayPageView } from "./holidayParts";

/** The 25 Days palette's three accents (src/pages/sponsor/sponsor.css): hunter green, oxblood, antique gold. */
const CARDS = [
  { to: HOLIDAY_LIGHTS_PATH, title: "Christmas lights", body: W.lightsCard, cta: "See the lights", rule: "#1f3a2b" },
  { to: HOLIDAY_EVENTS_PATH, title: "Holiday events", body: W.eventsCard, cta: "See the events", rule: "#6e1423" },
  { to: HOLIDAY_HIRE_PATH, title: "Hire a Helpr for the holidays", body: W.hireCard, cta: "Get holiday help", rule: "#b08d57" },
] as const;

export default function HolidayHub() {
  usePageMeta(PUBLIC_PAGE_META["/holidays"]);
  useHolidayPageView("holidays");
  return (
    <PublicHeaderPage title={W.hubTitle} backTo="/" wrapTitle bottomPaddingClassName="pb-12 md:pb-16" headerWrapperClassName={HUB_HEADER_COLUMN}>
      <div className={`${HUB_COLUMN} space-y-6 font-sans`} data-holiday-page="hub">
        <p className="max-w-[68ch] text-ds-17 text-foreground">{W.hubIntro}</p>
        <ul className="grid gap-4 md:grid-cols-3" data-holiday-cards="">
          {CARDS.map((c) => (
            <li key={c.to} className="min-w-0">
              <Link to={c.to} data-holiday-card={c.to}
                className="group flex h-full min-h-11 flex-col rounded-[20px] border border-border border-t-[3px] bg-card p-5 text-foreground no-underline transition-colors hover:border-foreground/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ borderTopColor: c.rule }}>
                <h2 className="text-ds-20 font-semibold leading-snug">{c.title}</h2>
                <p className="mt-1.5 text-ds-15 text-muted-foreground">{c.body}</p>
                <span className="mt-auto pt-4 text-ds-15 font-semibold text-[hsl(var(--olivewood))]">{c.cta} ›</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-ds-14 text-muted-foreground">
          Shopping too? <Link to="/gift-guides" className="link-standard">See the holiday gift guides</Link>.
        </p>
      </div>
    </PublicHeaderPage>
  );
}
