/**
 * The shop's daily order limit (L22; Shops slice 2, shops_set_daily_order_cap).
 * Its own file so /shops/mine's item list keeps one loading gate. An empty
 * box removes a saved limit only as its own, named action, and a failed read
 * shows the error with a retry instead of a blank box that would clear it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchDailyOrderCap, setDailyOrderCap } from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopDailyCap({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const cap = useQuery({ queryKey: ["shops", "daily-cap", shopId], queryFn: () => fetchDailyOrderCap(shopId) });
  const [value, setValue] = useState<string | null>(null);
  // The browser hands a half-typed number ("1e") back as "": never read that as "no limit".
  const [badInput, setBadInput] = useState(false);
  const shown = value ?? (cap.data != null ? String(cap.data) : "");
  // An empty box removes a saved limit only as its own, named action
  // (lh-silent-failure review should-fix 3).
  const clearing = shown.trim() === "" && cap.data != null;
  const save = useMutation({
    mutationFn: () => {
      if (badInput || (shown.trim() !== "" && !/^\d+$/.test(shown.trim()))) throw new Error("invalid_daily_cap");
      return setDailyOrderCap(shown.trim() === "" ? null : Number(shown));
    },
    onSuccess: () => {
      toast.success(clearing ? "The daily limit is removed." : "Saved.");
      setValue(null);
      void qc.invalidateQueries({ queryKey: ["shops", "daily-cap", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <div className="space-y-1.5">
      <Label htmlFor="shop-daily-cap">Most orders you take a day (optional)</Label>
      <div className="flex gap-2">
        <Input
          id="shop-daily-cap"
          type="number"
          min={1}
          max={200}
          className="min-w-0"
          value={shown}
          disabled={cap.isPending || cap.isError}
          onChange={(e) => {
            setBadInput(e.target.validity.badInput);
            setValue(e.target.value);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending || cap.isPending || cap.isError || value === null}
          onClick={() => save.mutate()}
        >
          {clearing ? "Remove limit" : "Save"}
        </Button>
      </div>
      {cap.isError && (
        <p className="text-sm" role="alert">
          {shopsErrorMessage(cap.error)}{" "}
          <button type="button" className="underline" onClick={() => void cap.refetch()}>Try again</button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">Once a day is full, buyers can't pick it. Your order days are your open days above.</p>
    </div>
  );
}
