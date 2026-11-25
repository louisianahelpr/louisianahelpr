import { GUIDE_UPDATED } from "@/content/guideUpdated.mjs";
import { GUIDE_SEARCH } from "@/content/guideSearch.mjs";
import { SMALL_BIZ_CATEGORIES } from "@/content/giftGuideSmallBiz.mjs";
import smallBiz from "@/content/giftGuideSmallBiz.json";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import { louisianaDay } from "@/content/giftGuideDeals.mjs";
import { QA_BYLINE, QA_TITLE, catalogGuideQa, dealsDayQa, holidayHubQa, newestPriceDay, smallBizQa, toStoreQaPick, updatedLine, type QaDeal, type QaDealListed, type QaItem } from "@/lib/guideQa.mjs";
import { STORES, type CatalogPick } from "@/content/giftGuideCatalog";
import { THEME_GUIDE_NAMES_1124, isDealTheme } from "@/content/giftGuideLive.mjs";
import { themeGuideSearch } from "@/content/themeGuideSearch.mjs";

/**
 * A guide page's "Common questions" (owner pop-up 2026-11-22 9:40 PM: "Q&A + updated date + byline"), near its end:
 * 3 to 5 questions answered from the page's own rows (src/lib/guideQa.mjs, the same function api/share.ts writes into
 * the pre-JS body and its FAQPage JSON-LD), the day its data last changed and who picks. Always open (owner 11-22:
 * everything on the guides opens expanded). Its own lazy chunk (LazyGuideQa): never on the guide route's first load.
 * Guard: src/test/guideAiSearch1122.test.tsx.
 */
export type GuideQaProps =
  | { kind: "catalog"; page: string; picks: readonly CatalogPick[] }
  | { kind: "deals"; page: string; deals: readonly QaDeal[]; listed: QaDealListed }
  | { kind: "small-biz"; page: string }
  | { kind: "holidays"; page: "holidays" };

const QA_CSS = `
.gqa{margin:32px 0 8px;max-width:46rem}
.gqa h2{margin:0 0 4px;font-size:20px;line-height:1.25;font-weight:700;color:hsl(var(--foreground))}
.gqa dt{margin-top:16px;font-size:15px;line-height:1.4;font-weight:600;color:hsl(var(--foreground))}
.gqa dd{margin:4px 0 0;font-size:15px;line-height:1.55;color:hsl(var(--foreground))}
.gqa-intro{margin:0 0 20px;font-size:15px;line-height:1.55;color:hsl(var(--foreground))}
.gqa-by{margin:18px 0 0;font-size:13px;line-height:1.5;color:hsl(var(--muted-foreground))}
`;

function questions(p: GuideQaProps, today: string): QaItem[] {
  if (p.kind === "catalog") return catalogGuideQa(p.page, p.picks.filter((x) => x.name).map((x) => toStoreQaPick(x, STORES[x.store]?.name)), today);
  if (p.kind === "deals") return dealsDayQa(p.page, [...p.deals], today, p.listed);
  if (p.kind === "small-biz") return smallBizQa(smallBiz as { name: string; town?: string; category?: string; ships?: string }[], SMALL_BIZ_CATEGORIES);
  return holidayHubQa(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, today);
}

/** A themed kids guide's name (src/content/giftGuideLive.mjs), or null. */
const themeName = (page: string): string | null => (Object.prototype.hasOwnProperty.call(THEME_GUIDE_NAMES_1124, page) ? THEME_GUIDE_NAMES_1124[page as keyof typeof THEME_GUIDE_NAMES_1124] : null);

/**
 * A themed kids guide's intro (owner 11-25, search: src/content/themeGuideSearch.mjs, the words the pre-JS body has under
 * its H1), from its picks and their unique links, as the head counts them.
 */
function themeIntro(page: string, picks: readonly CatalogPick[], today: string): string | null {
  const name = themeName(page);
  if (!name) return null;
  const seen = new Set<string>();
  const rows = picks.filter((p) => p.name && p.href && !seen.has(p.href) && seen.add(p.href));
  return themeGuideSearch(name, rows.map((p) => ({ name: p.name, price: p.price, priceAt: p.priceAt, priceFrom: p.priceFrom, store: STORES[p.store]?.name ?? "" })), rows.length, today, { deals: isDealTheme(page) })?.intro ?? null;
}

export function GuideQa(props: GuideQaProps) {
  const today = louisianaDay(new Date());
  const qa = questions(props, today);
  if (qa.length === 0) return null;
  // A themed kids guide has no row in guideUpdated.mjs: its Updated day is its newest price check (as api/share.ts says).
  const updatedDay = Object.prototype.hasOwnProperty.call(GUIDE_UPDATED, props.page) ? GUIDE_UPDATED[props.page].day : props.kind === "catalog" && themeName(props.page) ? newestPriceDay([...props.picks]) : undefined;
  const updated = updatedDay ? updatedLine(updatedDay) : "";
  const byline = props.kind === "catalog" && props.page !== "25-days-sponsors" ? QA_BYLINE.gifts : QA_BYLINE.other;
  // Google search setup (owner 11-23): Her, Him and Kids open this section with their short intro (guideSearch.mjs), the
  // same words the pre-JS body has under its H1. Not under the banner: owner 11-18, no subtitle under a guide's title.
  const intro = props.kind !== "catalog" ? null : Object.prototype.hasOwnProperty.call(GUIDE_SEARCH, props.page) ? GUIDE_SEARCH[props.page as keyof typeof GUIDE_SEARCH].intro : themeIntro(props.page, props.picks, today);
  return (
    <section className="gqa" aria-labelledby="guide-qa-title" data-guide-qa={props.page}>
      <style>{QA_CSS}</style>
      {intro && <p className="gqa-intro" data-guide-intro="">{intro}</p>}
      <h2 id="guide-qa-title">{QA_TITLE}</h2>
      <dl>
        {qa.map(({ q, a }) => (
          <div key={q} data-guide-qa-item="">
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        ))}
      </dl>
      <p className="gqa-by" data-guide-qa-byline="">{[updated, byline].filter(Boolean).join(" · ")}</p>
    </section>
  );
}
