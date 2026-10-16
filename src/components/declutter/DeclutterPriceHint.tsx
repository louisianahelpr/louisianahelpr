/**
 * The Declutter fair-price hint (docs/specs/declutter-wanted-price-hint.md,
 * W9-W12): "Most items like this sold for $X-$Y", from OUR completed sales
 * only. Renders NOTHING unless the server answered with a real range: no
 * placeholder, no "not enough data" line, never a made-up number.
 */
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { fetchPriceHint, priceHintWords, type HintPlace } from "@/lib/declutter/priceHint";

/**
 * The fair-price hint for one category + condition near a point. `at` null
 * (place unknown) or the switch off: nothing at all.
 */
export default function PriceHint({ category, conditionStars, at, place }: {
  category: string;
  conditionStars: number;
  at: { lat: number; lng: number } | null;
  /** "near_you" only where the point is the member's own (the sell flow); a listing's page says "in this area". */
  place: HintPlace;
}) {
  const on = useFeature("declutter_price_hint");
  // Round the point the way the server does (2 decimals), so a moving device
  // fix does not refetch the same answer.
  const lat = at ? Math.round(at.lat * 100) / 100 : null;
  const lng = at ? Math.round(at.lng * 100) / 100 : null;
  const hint = useQuery({
    queryKey: ["declutter", "price-hint", category, conditionStars, lat, lng],
    queryFn: () => fetchPriceHint(category, conditionStars, { lat: lat as number, lng: lng as number }),
    enabled: on && lat !== null && lng !== null && !!category,
    staleTime: 10 * 60_000,
  });
  // A hint is extra help, never a promise: when it cannot load we say nothing
  // rather than a number we do not have (W10). The failed query is reported
  // to error_logs by the app's QueryCache, so it is not silent to us.
  if (hint.isError) return null;
  const words = priceHintWords(hint.data, place);
  if (!on || !words) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3" role="note" aria-label="Recent sale prices">
      <p className="text-sm font-semibold">{words.headline}</p>
      <p className="text-xs text-muted-foreground">{words.basis}</p>
    </div>
  );
}

