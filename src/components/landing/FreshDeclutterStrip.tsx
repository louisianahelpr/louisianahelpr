import { Link } from "react-router-dom";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { PriceInclFee } from "@/components/declutter/PriceInclFee";
import { PhotoTag, PhotoTagStack } from "@/components/ui/PhotoTag";
import { PRICE_DEAL } from "@/components/ui/designScale";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";
import { FRESH_DECLUTTER_LIMIT, FRESH_GRID, type FreshItem } from "./FreshDeclutterSection";
import { DECLUTTER_SHELL, LandingBrowseShell } from "./LandingBrowseShell";

/**
 * The landing's Declutter grid markup (FreshDeclutterSection.tsx has the read and the rules). Its own chunk,
 * fetched with the listings, so the landing's page chunk carries only the loader and the placeholder.
 */
export function FreshDeclutterFailed() {
  return (
    <LandingBrowseShell testId="landing-fresh-declutter-failed-section" titleId="landing-fresh-declutter-title" {...DECLUTTER_SHELL}>
      <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-fresh-declutter-failed">
        We couldn’t load the Declutter listings just now.
      </p>
    </LandingBrowseShell>
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
        <span data-card-price="" className="mt-0.5 flex min-w-0 flex-col leading-tight">
          {it.current_price_cents > 0 ? (
            <>
              {/* Owner 11-09 (10:35 PM, reverses pick 2 of 11-08): the LIST price is the big bold one; "$X.XX incl. fee"
                  sits under it, smaller. F007 (owner's UI audit 11-09): the small text is 12px in the landing's body ink
                  (--lp-body, #4F4C45 / #D6D2C8 dark), which reads at arm's length. */}
              <span data-card-base-price="" className="text-ds-16 font-bold tabular-nums text-foreground">
                {itemPriceLabel(it.current_price_cents)}
                {it.current_price_cents < it.price_cents && (
                  <span className="ml-1.5 text-ds-12 font-medium text-[color:var(--lp-body)]">
                    <span className="sr-only">Price dropped, was </span>
                    <s aria-hidden>{formatPrice(it.price_cents)}</s>
                  </span>
                )}
              </span>
              <PriceInclFee priceCents={it.current_price_cents} className="text-ds-12 font-medium tabular-nums text-[color:var(--lp-body)]" />
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
    // Owner 11-09 (10:35 PM): the same frame as the Jobs view (LandingBrowseShell), so the two modes look alike.
    <LandingBrowseShell testId="landing-fresh-declutter" titleId="landing-fresh-declutter-title" {...DECLUTTER_SHELL}>
      <ul className={FRESH_GRID} data-testid="landing-fresh-declutter-list">
        {items.slice(0, FRESH_DECLUTTER_LIMIT).map((it) => (
          <li key={it.id} className="min-w-0">
            <FreshCard it={it} />
          </li>
        ))}
      </ul>
    </LandingBrowseShell>
  );
}
