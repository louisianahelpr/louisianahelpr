import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { RentBrowse, SaleBrowse } from "./listings/RentBrowse";

/**
 * HOMES -> Browse (owner 2026-10-18/19: the section once called Rentals is
 * "Homes"; Browse holds the listings, with a Rent | Buy switch inside it).
 * RENT = homes for rent (RL1a listings, RentBrowse). BUY = homes for sale by
 * their verified owners (for-sale-by-owner, SaleBrowse, 20261019061241).
 *
 * Mounted by the Homes page (RentalsHomeView) and, once the shared section
 * shell lands, by its Browse tab. The switch lives in the URL as `?kind=buy`
 * (RENT is the default and has no parameter), NOT `?tab=`, which belongs to
 * the shell's Browse | Renting | Owning toggle.
 */
type HomesKind = "rent" | "buy";

function useHomesKind(): [HomesKind, (k: HomesKind) => void] {
  const [params, setParams] = useSearchParams();
  const kind: HomesKind = params.get("kind") === "buy" ? "buy" : "rent";
  return [
    kind,
    (k) => {
      const next = new URLSearchParams(params);
      if (k === "rent") next.delete("kind");
      else next.set("kind", k);
      setParams(next, { replace: true });
    },
  ];
}

function HomesKindSwitch({ value, onChange }: { value: HomesKind; onChange: (k: HomesKind) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Rent or buy"
      semantics="tab"
      panelIdPrefix="homes"
      className="w-full sm:max-w-xs"
      value={value}
      onChange={onChange}
      options={[
        { value: "rent", label: "Rent" },
        { value: "buy", label: "Buy" },
      ]}
    />
  );
}

/**
 * BUY: homes for sale by their verified owners (20261019061241). No
 * commission and no negotiating on our side; a title company or attorney
 * closes the sale. The line says so above the list.
 */
function HomesBuy() {
  return (
    <section id="homes-panel-buy" role="tabpanel" aria-labelledby="homes-tab-buy" className="space-y-3">
      <p className="flex items-start gap-2 px-1 text-ds-13 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Homes listed by their verified owners. No commission. A title company or attorney handles the closing.</span>
      </p>
      <SaleBrowse />
    </section>
  );
}

export function HomesBrowse() {
  const [kind, setKind] = useHomesKind();
  return (
    <div className="space-y-4">
      <HomesKindSwitch value={kind} onChange={setKind} />
      {kind === "buy" ? (
        <HomesBuy />
      ) : (
        <div id="homes-panel-rent" role="tabpanel" aria-labelledby="homes-tab-rent">
          <RentBrowse />
        </div>
      )}
    </div>
  );
}
