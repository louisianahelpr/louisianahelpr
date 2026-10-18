/**
 * The shop's private pickup address (Shops M1b part 2, migration
 * 20261018210400_shops_pickup_address). Orders are pickup only, so a shop
 * needs one before it can take an order (the server refuses an order without
 * it: pickup_address_missing). It is never on the shop page: only the owner
 * reads it here, and a buyer sees it once the shop accepts their order. Sales
 * tax on a pickup is worked out at this address (tax memo Q3).
 *
 * Saves on its own, outside the shop form (like the items below it).
 */
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchMyPickupAddress, LOUISIANA_ZIP, saveMyPickupAddress } from "@/lib/shops/pickupAddress";
import { shopsErrorMessage } from "@/lib/shops/errors";

const KEY = ["shops", "my-pickup-address"] as const;

export default function ShopPickupAddressSection() {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: KEY, queryFn: fetchMyPickupAddress });
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (loaded || current.isLoading || current.isError) return;
    const a = current.data;
    if (a) {
      setLine1(a.line1);
      setLine2(a.line2 ?? "");
      setCity(a.city);
      setZip(a.postal_code);
    }
    setLoaded(true);
  }, [current.data, current.isLoading, current.isError, loaded]);

  const save = useMutation({
    mutationFn: () => saveMyPickupAddress({ line1, line2, city, postal_code: zip.trim() }),
    onSuccess: () => {
      toast.success("Pickup address saved.");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (line1.trim().length < 3 || city.trim().length < 2) {
      setProblem("Enter the street and city where buyers pick up.");
      return;
    }
    if (!LOUISIANA_ZIP.test(zip.trim())) {
      setProblem("Enter a Louisiana ZIP code. Shops are for Louisiana pickups only.");
      return;
    }
    setProblem(null);
    save.mutate();
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="shop-pickup-heading" data-testid="shop-pickup-address">
      <div className="space-y-1">
        <h2 id="shop-pickup-heading" className="text-base font-semibold">Pickup address</h2>
        <p className="text-sm text-muted-foreground">
          Private. It never shows on your shop page: a buyer sees it only after you accept their order. You need one before you can take orders, and sales tax is worked out for this address.
        </p>
      </div>
      {current.isError ? (
        <ErrorState variant="inline" title="We couldn't load your pickup address." body={shopsErrorMessage(current.error)} onRetry={() => void current.refetch()} />
      ) : current.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading your pickup address">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ) : (
        <form className="space-y-3" onSubmit={onSubmit} noValidate>
          {!current.data && (
            <p className="text-sm font-medium">Add your pickup address to start taking orders.</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pickup-line1">Street address</Label>
            <Input id="pickup-line1" autoComplete="address-line1" value={line1} maxLength={120} onChange={(e) => setLine1(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup-line2">Apt, suite or unit (optional)</Label>
            <Input id="pickup-line2" autoComplete="address-line2" value={line2} maxLength={120} onChange={(e) => setLine2(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="pickup-city">City</Label>
              <Input id="pickup-city" autoComplete="address-level2" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} required />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="pickup-zip">ZIP code</Label>
              <Input id="pickup-zip" autoComplete="postal-code" inputMode="numeric" value={zip} maxLength={5} onChange={(e) => setZip(e.target.value)} required />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">State: Louisiana</p>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          <Button type="submit" className="w-full" variant="outline" disabled={save.isPending}>
            {save.isPending ? "Saving…" : current.data ? "Save pickup address" : "Add pickup address"}
          </Button>
        </form>
      )}
    </section>
  );
}
