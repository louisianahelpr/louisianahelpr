import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * HOMES (owner 2026-10-18: the section once called Rentals is "Homes", with
 * two tabs). RENT holds the rentals product (repair requests today, listings
 * next); BUY is for-sale-by-owner, not built yet ("Coming soon"). The tab
 * lives in the URL (`?tab=buy`) so a link can open either one; RENT is the
 * default and has no parameter.
 */
export type HomesTab = "rent" | "buy";

export function useHomesTab(): [HomesTab, (t: HomesTab) => void] {
  const [params, setParams] = useSearchParams();
  const tab: HomesTab = params.get("tab") === "buy" ? "buy" : "rent";
  return [tab, (t) => setParams(t === "rent" ? {} : { tab: t }, { replace: true })];
}

export function HomesTabs({ value, onChange }: { value: HomesTab; onChange: (t: HomesTab) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Homes"
      semantics="tab"
      panelIdPrefix="homes"
      value={value}
      onChange={onChange}
      options={[
        { value: "rent", label: "Rent" },
        { value: "buy", label: "Buy" },
      ]}
    />
  );
}

/** BUY until for-sale-by-owner is specced and built (queue row homes-fsbo). */
export function HomesBuyComingSoon() {
  return (
    <section
      id="homes-panel-buy"
      role="tabpanel"
      aria-labelledby="homes-tab-buy"
      className="rounded-2xl border border-border bg-card p-4 space-y-2"
    >
      <h2 className="font-semibold text-base">Coming soon</h2>
      <p className="text-sm text-muted-foreground">
        Homes for sale by their owners, right here in the app. Check back soon.
      </p>
    </section>
  );
}
