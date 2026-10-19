import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { HomesListings, type HomesKind } from "./listings/RentBrowse";
import { SavedHomes } from "./listings/SavedHomes";

/**
 * HOMES -> Browse (owner 2026-10-18/19: the section once called Rentals is
 * "Homes"). RENT = homes for rent (RL1a listings). BUY = homes for sale by
 * their verified owners (for-sale-by-owner, 20261019061241).
 *
 * Rent or Buy is a choice IN THE FILTER SHEET, Rent the default (owner,
 * 2026-10-19: the extra Rent | Buy pill row under the toggle went away, so
 * Homes has exactly the rows every other section has); RentBrowse.tsx. It
 * lives in the URL as `?kind=buy`; `?mode=buy` deep links work too. Never
 * `?tab=`, which belongs to the Browse | Renting | Owning toggle.
 */
function useHomesKind(): [HomesKind, (k: HomesKind) => void] {
  const [params, setParams] = useSearchParams();
  const kind: HomesKind = params.get("kind") === "buy" || params.get("mode") === "buy" ? "buy" : "rent";
  return [
    kind,
    (k) => {
      const next = new URLSearchParams(params);
      next.delete("mode");
      if (k === "rent") next.delete("kind");
      else next.set("kind", k);
      setParams(next, { replace: true });
    },
  ];
}

/** Buy's line above the list: no commission and no negotiating on our side;
 *  a title company or attorney closes the sale. */
function BuyIntro() {
  return (
    <p className="flex items-start gap-2 px-1 text-ds-13 text-muted-foreground">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>Homes listed by their verified owners. No commission. A title company or attorney handles the closing.</span>
    </p>
  );
}

export function HomesBrowse() {
  const [kind, setKind] = useHomesKind();
  const [params] = useSearchParams();
  // Saved homes (the hearts) open under Browse at ?view=saved.
  if (params.get("view") === "saved") return <SavedHomes />;
  return <HomesListings homes={kind} onKind={setKind} intro={kind === "buy" ? <BuyIntro /> : undefined} />;
}
