import { useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { RentBrowse } from "./listings/RentBrowse";

/**
 * HOMES -> Browse (owner 2026-10-18/19: the section once called Rentals is
 * "Homes"; Browse holds the listings, with a Rent | Buy switch inside it).
 * RENT = homes for rent (RL1a listings, RentBrowse). BUY = homes for sale by
 * their verified owners (for-sale-by-owner): not built yet, so it says what it
 * will be and reads nothing.
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

/** BUY until for-sale-by-owner listings are built. No commission and no
 *  negotiating on our side; a title company or attorney closes the sale. */
function HomesBuyComingSoon() {
  return (
    <section id="homes-panel-buy" role="tabpanel" aria-labelledby="homes-tab-buy">
      <EmptyState
        variant="bare"
        icon={KeyRound}
        title="Homes for sale: coming soon"
        body="Homes listed by their verified owners. No commission. A title company or attorney handles the closing."
      />
    </section>
  );
}

export function HomesBrowse() {
  const [kind, setKind] = useHomesKind();
  return (
    <div className="space-y-4">
      <HomesKindSwitch value={kind} onChange={setKind} />
      {kind === "buy" ? (
        <HomesBuyComingSoon />
      ) : (
        <div id="homes-panel-rent" role="tabpanel" aria-labelledby="homes-tab-rent">
          <RentBrowse />
        </div>
      )}
    </div>
  );
}
