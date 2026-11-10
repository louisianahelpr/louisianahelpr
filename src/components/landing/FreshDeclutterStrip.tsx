import { Link } from "react-router-dom";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { PriceInclFee } from "@/components/declutter/PriceInclFee";
import { PhotoTag, PhotoTagStack } from "@/components/ui/PhotoTag";
import { PRICE_DEAL } from "@/components/ui/designScale";
import { FRESH_GRID, FRESH_INCL, FRESH_PRICE, FRESH_TITLE, FRESH_TOWN, type FreshItem } from "./FreshDeclutterSection";
import { LANDING_CARD_PHOTO } from "@/lib/declutter/landingCardPhoto";
import type { NearCard, NearJob } from "./nearYouCards";

/**
 * The landing's "Near you this week" grid markup (Direction A, owner 11-10; NearYouSection.tsx has the reads and the
 * rules). Its own chunk, fetched with the listings, so the landing's page chunk carries only the loader and the
 * placeholder.
 */

/**
 * One Declutter card in the /declutter browse card's style (DeclutterItemCard.tsx's ItemCard, owner picks 2 and 4,
 * 11-08): the 4:5 photo, then the title, the town and the price. Not ItemCard itself: it imports the Declutter api
 * (Supabase) and the category icons, and as part of this lazy chunk that regrouped the shared icon chunks (measured
 * with scripts/perf/critical-path.mjs: /declutter?tab=selling 557 -> 563 KB gz, over its budget), so this card uses the
 * same shared pieces without them. A guest has no location here, so there is no distance; a missing photo leaves the
 * empty photo tile.
 *
 * D006 (landing design audit 11-10): every card said "Porch pickup" and "Like new", so neither told the cards apart.
 * The Porch pickup tag shows only when the grid mixes porch and non-porch items (porchTagTellsApart), and the town
 * takes the condition's line. Type sizes: FRESH_TITLE / FRESH_TOWN / FRESH_PRICE / FRESH_INCL.
 */
function FreshCard({ it, showPorch }: { it: FreshItem; showPorch: boolean }) {
  return (
    <Link to={`/declutter/item/${encodeURIComponent(it.id)}`} data-item-card="" className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-photo-empty">
        {it.photo && (
          <img
            loading="lazy"
            decoding="async"
            src={it.photo}
            alt=""
            width={LANDING_CARD_PHOTO.width}
            height={LANDING_CARD_PHOTO.height}
            className="relative h-full w-full object-cover"
            onError={(e) => {
              const img = e.currentTarget;
              if (it.photoFull && img.src !== it.photoFull) img.src = it.photoFull;
            }}
          />
        )}
        {showPorch && it.porch_ok && (
          <PhotoTagStack>
            <PhotoTag data-card-porch="">Porch pickup</PhotoTag>
          </PhotoTagStack>
        )}
      </span>
      <span className="block min-w-0 px-0.5 pt-2">
        <span data-card-title className={`line-clamp-2 break-words ${FRESH_TITLE}`} style={{ color: "var(--lp-ink)" }} title={it.title}>{it.title}</span>
        <span data-card-town="" className={`block truncate ${FRESH_TOWN}`} style={{ color: "var(--lp-body)" }}>{it.area_label || "\u00a0"}</span>
        <span data-card-price="" className="mt-0.5 flex min-w-0 flex-col leading-tight">
          {it.current_price_cents > 0 ? (
            <>
              {/* Owner 11-09 (10:35 PM, reverses pick 2 of 11-08): the LIST price is the big bold one; "$X.XX incl. fee"
                  sits under it, smaller, in the landing's body ink (--lp-body, #4F4C45 / #D6D2C8 dark). */}
              <span data-card-base-price="" className={`${FRESH_PRICE} font-bold tabular-nums text-foreground`}>
                {itemPriceLabel(it.current_price_cents)}
                {it.current_price_cents < it.price_cents && (
                  <span className="ml-1.5 text-ds-13 font-medium text-[color:var(--lp-body)]">
                    <span className="sr-only">Price dropped, was </span>
                    <s aria-hidden>{formatPrice(it.price_cents)}</s>
                  </span>
                )}
              </span>
              <PriceInclFee priceCents={it.current_price_cents} className={`${FRESH_INCL} font-medium tabular-nums text-[color:var(--lp-body)]`} />
            </>
          ) : (
            <span data-card-free="" className={`${FRESH_PRICE} ${PRICE_DEAL}`}>{itemPriceLabel(it.current_price_cents)}</span>
          )}
        </span>
      </span>
    </Link>
  );
}

/**
 * One open job in the same card shape (Direction A: jobs and Declutter items side by side, town and price). A job has
 * no photo of its own, so its 4:5 tile is the landing's deep olive (the safety band's colour, so it never reads as a
 * loading placeholder) with the job's category in the serif and a "Job" tag; then the title, the parish and day, and
 * the Helpr's take-home (the /browse card's number). Every word is worked out in the page chunk (nearYouCards.ts:
 * NearJob), so this chunk imports no jobs code.
 */
function JobCard({ job }: { job: NearJob }) {
  return (
    <Link to={`/browse?job=${encodeURIComponent(job.id)}`} data-job-card="" className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="relative flex aspect-[4/5] items-end overflow-hidden rounded-xl p-3 lg:p-4" style={{ background: "var(--lp-band)" }}>
        <PhotoTagStack>
          <PhotoTag data-card-job="">Job</PhotoTag>
        </PhotoTagStack>
        <span className="landing-serif-text text-ds-20 lg:text-ds-28 leading-tight break-words" style={{ color: "var(--lp-band-ink)" }}>
          {job.label}
        </span>
      </span>
      <span className="block min-w-0 px-0.5 pt-2">
        <span data-card-title className={`line-clamp-2 break-words ${FRESH_TITLE}`} style={{ color: "var(--lp-ink)" }} title={job.title}>{job.title}</span>
        <span data-card-town="" className={`block truncate ${FRESH_TOWN}`} style={{ color: "var(--lp-body)" }}>{job.where || "\u00a0"}</span>
        <span data-card-price="" className="mt-0.5 flex min-w-0 flex-col leading-tight">
          <span data-card-base-price="" className={`${FRESH_PRICE} font-bold tabular-nums text-foreground`}>{job.price}</span>
          {/* The incl.-fee line's height, so a job card is exactly as tall as an item card beside it. */}
          <span aria-hidden className={`${FRESH_INCL} invisible`}>&nbsp;</span>
        </span>
      </span>
    </Link>
  );
}

/** D006: the Porch pickup tag tells cards apart only when some items have it and some do not. */
export function porchTagTellsApart(items: Pick<FreshItem, "porch_ok">[]): boolean {
  return items.some((i) => i.porch_ok) && items.some((i) => !i.porch_ok);
}

/** The Near you grid: jobs and items in the order NearYouSection chose (mixNearCards), two across, three from sm, four from lg. */
export default function NearYouGrid({ cards }: { cards: NearCard[] }) {
  const showPorch = porchTagTellsApart(cards.flatMap((c) => (c.kind === "item" ? [c.item] : [])));
  return (
    <ul className={FRESH_GRID} data-testid="landing-near-you-list">
      {cards.map((c) => (
        <li key={`${c.kind}-${c.kind === "job" ? c.job.id : c.item.id}`} className="min-w-0">
          {c.kind === "job" ? <JobCard job={c.job} /> : <FreshCard it={c.item} showPorch={showPorch} />}
        </li>
      ))}
    </ul>
  );
}
