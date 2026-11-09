import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { PriceInclFee } from "@/components/declutter/PriceInclFee";
import { PhotoTag, PhotoTagStack } from "@/components/ui/PhotoTag";
import { PRICE_DEAL } from "@/components/ui/designScale";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";
import { FRESH_DECLUTTER_LIMIT, type FreshItem } from "./FreshDeclutterSection";

/**
 * The "Fresh on Declutter" strip's markup (FreshDeclutterSection.tsx has the read and the rules). Its own chunk,
 * fetched with the listings, so the landing's page chunk carries only the loader.
 */
function SeeEverything({ className }: { className: string }) {
  return (
    <Link to="/declutter" className={`group items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard ${className}`} style={{ color: "var(--lp-action-strong)" }}>
      See everything
      <ArrowRight className="w-4 h-4" aria-hidden />
    </Link>
  );
}

export function FreshDeclutterFailed() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 pb-12 lg:pb-20" style={{ background: "var(--lp-surface)" }}>
      <div className="mx-auto w-full max-w-6xl flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-fresh-declutter-failed">
          We couldn’t load the newest Declutter listings just now.
        </p>
        <SeeEverything className="inline-flex" />
      </div>
    </section>
  );
}

/**
 * One card in the /declutter browse card's style (DeclutterItemCard.tsx's ItemCard, owner picks 2 and 4, 11-08): the
 * 4:5 photo with Porch pickup as a PhotoTag, then three lines: title; condition; the incl.-fee price bold with the base
 * price small and grey (or Free). Not ItemCard itself: it imports the Declutter api (Supabase) and the category icons,
 * and as part of this lazy chunk that regrouped the shared icon chunks (measured with scripts/perf/critical-path.mjs:
 * /declutter?tab=selling 557 -> 563 KB gz, over its budget), so this card uses the same shared pieces without them.
 * A guest has no location here, so there is no distance; a missing photo leaves the empty photo tile.
 */
function FreshCard({ it }: { it: FreshItem }) {
  const condition = CONDITION_LABEL[it.condition_stars] ?? null;
  return (
    <Link to={`/declutter/item/${encodeURIComponent(it.id)}`} data-item-card="" className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-photo-empty">
        {it.photo && (
          <img
            loading="lazy"
            decoding="async"
            src={it.photo}
            alt=""
            width={240}
            height={300}
            className="relative h-full w-full object-cover"
            onError={(e) => {
              const img = e.currentTarget;
              if (it.photoFull && img.src !== it.photoFull) img.src = it.photoFull;
            }}
          />
        )}
        {it.porch_ok && (
          <PhotoTagStack>
            <PhotoTag data-card-porch="">Porch pickup</PhotoTag>
          </PhotoTagStack>
        )}
      </span>
      <span className="block min-w-0 px-0.5 pt-2">
        <span data-card-title className="block truncate text-ds-13 font-semibold leading-snug" style={{ color: "var(--lp-ink)" }} title={it.title}>{it.title}</span>
        {condition && <span data-card-condition={it.condition_stars} title={condition} className="block truncate text-ds-11 text-muted-foreground">{condition}</span>}
        <span data-card-price="" className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-tight">
          {it.current_price_cents > 0 ? (
            <>
              {/* F007 (owner's UI audit 11-09): the "incl. fee" words and the base price were 11px light text; 12px in
                  the landing's body ink (--lp-body, #4F4C45 / #D6D2C8 dark) reads at arm's length. */}
              <PriceInclFee priceCents={it.current_price_cents} className="text-ds-16 font-bold tabular-nums text-foreground" wordsClassName="text-ds-12 font-semibold text-primary" />
              <span data-card-base-price="" className="text-ds-12 font-medium tabular-nums" style={{ color: "var(--lp-body)" }}>
                {itemPriceLabel(it.current_price_cents)}
                {it.current_price_cents < it.price_cents && (
                  <span className="ml-1">
                    <span className="sr-only">Price dropped, was </span>
                    <s aria-hidden>{formatPrice(it.price_cents)}</s>
                  </span>
                )}
              </span>
            </>
          ) : (
            <span data-card-free="" className={`text-ds-16 ${PRICE_DEAL}`}>{itemPriceLabel(it.current_price_cents)}</span>
          )}
        </span>
      </span>
    </Link>
  );
}

/**
 * The Shop Declutter grid (owner 11-08): up to FRESH_DECLUTTER_LIMIT items in the /declutter browse card style (FreshCard
 * above), two across on a phone, three from sm, four from lg, then "See everything".
 */
export default function FreshDeclutterStrip({ items }: { items: FreshItem[] }) {
  return (
    <section
      data-testid="landing-fresh-declutter"
      aria-labelledby="landing-fresh-declutter-title"
      className="px-5 sm:px-8 lg:px-12 pt-8 lg:pt-12 pb-12 lg:pb-20"
      style={{ background: "var(--lp-surface)" }}
    >
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="landing-fresh-declutter-title" className="font-display landing-serif leading-[1.05] text-ds-28" style={{ color: "var(--lp-ink)" }}>
            Fresh on Declutter
          </h2>
          <SeeEverything className="hidden sm:inline-flex" />
        </div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-8" data-testid="landing-fresh-declutter-list">
          {items.slice(0, FRESH_DECLUTTER_LIMIT).map((it) => (
            <li key={it.id} className="min-w-0">
              <FreshCard it={it} />
            </li>
          ))}
        </ul>
        <SeeEverything className="sm:hidden self-center inline-flex" />
      </div>
    </section>
  );
}
