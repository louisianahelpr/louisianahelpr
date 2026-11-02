/**
 * Declutter Selling: "Bundle discount" (Q2427, owner 2026-10-27; migration 20261027211754). The seller picks
 * "Buy 2+, get N% off" (5-50%) or Off. At checkout every paid item from them is N% off its own price when a buyer
 * takes 2 or more, never below the lowest price the seller set for that item. No fee numbers (owner rule).
 *
 * LEAD-BUNDLE-DROPDOWN (owner 2026-10-31): ONE row, the label on the left and a native dropdown on the right, the
 * free-after row's look (AutoFreeChoice), directly under that row in Listing defaults. The rule is the seller's,
 * applied at checkout to ALL their listings (declutter_bundle_targets), so its line says "Applies to all your listings".
 * A3-91 (audit 11-01): it used to save the moment it changed, inside the one card whose other fields wait for Save,
 * with nothing on screen saying which was which. Every other Selling setting saves with its card's Save, so this does
 * too: the dropdown only reports the pick (`onPick`) and Listing defaults' Save writes it (setBundleDiscount).
 * Guard: src/components/declutter/bundleDiscountOff.test.tsx.
 */
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeature } from "@/hooks/useFeature";
import { BUNDLE_PERCENTS, fetchBundleRule } from "@/lib/declutter/bundle";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { ErrorState } from "@/components/ui/ErrorState";

const BUNDLE_APPLIES_LINE = "Applies to all your listings";

/** The saved bundle rule's query key (the card and Listing defaults' Save share it). */
export const bundleRuleKey = (userId: string) => ["declutter", "bundle-rule", userId] as const;

/** The saved rule (null = Off), for Listing defaults to compare a pick against. */
export function useBundleRule() {
  const on = useFeature("declutter");
  const { user } = useCurrentUser();
  return useQuery({ queryKey: bundleRuleKey(user?.id ?? ""), queryFn: () => fetchBundleRule(user!.id), enabled: on && !!user });
}

/** `pick`: the seller's unsaved choice (undefined = untouched, null = Off). */
export function BundleDiscountCard({ pick, onPick, disabled = false }: { pick: number | null | undefined; onPick: (next: number | null) => void; disabled?: boolean }) {
  const on = useFeature("declutter");
  const { user } = useCurrentUser();
  const id = useId();
  const rule = useBundleRule();
  if (!on || !user) return null;
  // NIGHT-SET-Declutterse-1: a failed read says so, with Try again.
  if (rule.isError) return <ErrorState variant="inline" title="We couldn't load your bundle discount." body={declutterErrorMessage(rule.error)} onRetry={() => void rule.refetch()} />;
  // Off is null (NIGHT-SET-Declutterse-2: never 0 left unshown).
  const current = pick !== undefined ? pick : (rule.data ?? null);
  const value = current ? String(current) : "off";
  return (
    <div className="space-y-2 rounded-[14px] bg-[hsl(var(--muted)/0.55)] px-3 py-3" role="group" aria-labelledby={`${id}-label`} data-bundle-card="">
      <div className="flex items-center justify-between gap-3" data-bundle-row="">
        <label id={`${id}-label`} htmlFor={id} className="min-w-0 flex-1 text-ds-14 font-semibold text-foreground">Bundle discount</label>
        <select
          id={id}
          value={value}
          disabled={rule.isLoading || disabled}
          onChange={(e) => onPick(e.target.value === "off" ? null : Number(e.target.value))}
          className="h-11 w-auto max-w-[65%] shrink-0 rounded-[12px] border border-border bg-card px-3 text-ds-14 text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="off">Off</option>
          {BUNDLE_PERCENTS.map((p) => <option key={p} value={String(p)}>Buy 2+, {p}% off</option>)}
        </select>
      </div>
      <p className="text-ds-13 text-muted-foreground">
        <span className="font-semibold text-foreground" data-bundle-applies="">{BUNDLE_APPLIES_LINE}.</span>{" "}
        When a buyer takes 2 or more of your items in one checkout, each one is this much off. Never below the lowest price you set for an item.
      </p>
    </div>
  );
}
