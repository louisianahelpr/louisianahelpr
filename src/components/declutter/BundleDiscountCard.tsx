/**
 * Declutter Selling: "Bundle discount" (Q2427, owner 2026-10-27; migration 20261027211754). The seller picks
 * "Buy 2+, get N% off" (5-50%) or Off. At checkout every paid item from them is N% off its own price when a buyer
 * takes 2 or more, never below the lowest price the seller set for that item. No fee numbers (owner rule).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeature } from "@/hooks/useFeature";
import { BUNDLE_PERCENTS, bundleLabel, fetchBundleRule, setBundleDiscount } from "@/lib/declutter/bundle";
import { bundleErrorMessage } from "@/lib/declutter/bundleErrors";

export function BundleDiscountCard() {
  const on = useFeature("declutter");
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const key = ["declutter", "bundle-rule", user?.id ?? ""] as const;
  const rule = useQuery({ queryKey: key, queryFn: () => fetchBundleRule(user!.id), enabled: on && !!user });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: (p: number | null) => setBundleDiscount(p),
    onSuccess: (p) => {
      toast(p ? `Saved: ${bundleLabel(p)}.` : "Bundle discount off.");
      void qc.invalidateQueries({ queryKey: ["declutter", "bundle-rule"] });
      setOpen(false);
    },
    onError: (err) => toast.error(bundleErrorMessage(err)),
  });
  if (!on || !user || rule.isError) return null;
  const current = rule.data ?? null;
  const chosen = pick ?? current;
  return (
    <section className="rounded-2xl border border-border bg-card" aria-label="Bundle discount" data-bundle-card="">
      <button type="button" className="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Layers className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Bundle discount</span>
          <span className="block text-xs text-muted-foreground">{rule.isLoading ? "Loading…" : current ? bundleLabel(current) : "Off"}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            When a buyer takes 2 or more of your items in one checkout, each one is this much off. Never below the lowest price you set for an item.
          </p>
          <div role="radiogroup" aria-label="Bundle discount" className="flex flex-wrap gap-2">
            <Button type="button" size="sm" role="radio" aria-checked={chosen === null} variant={chosen === null ? "primary" : "outline"} className="rounded-full" onClick={() => setPick(0)}>
              Off
            </Button>
            {BUNDLE_PERCENTS.map((p) => (
              <Button key={p} type="button" size="sm" role="radio" aria-checked={chosen === p} variant={chosen === p ? "primary" : "outline"} className="rounded-full" onClick={() => setPick(p)}>
                {p}%
              </Button>
            ))}
          </div>
          <Button type="button" size="sm" disabled={save.isPending || pick === null} onClick={() => save.mutate(pick === 0 ? null : pick)}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </section>
  );
}
