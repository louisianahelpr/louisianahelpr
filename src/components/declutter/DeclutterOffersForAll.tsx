/**
 * LEAD-OFFERS-CHOICE (3), owner 2026-10-31: under Listing defaults, turn offers off or on for every listing already
 * up, in one tap each (src/lib/declutter/offersForAll.ts). The defaults above only change NEW listings.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { myItemsQuery } from "./myItemsQuery";
import { listingsToSwitch, setOffersForAll } from "@/lib/declutter/offersForAll";

const listingsWord = (n: number) => `${n} ${n === 1 ? "listing" : "listings"}`;

export function OffersForAllListings({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const mine = useQuery(myItemsQuery(userId));
  const items = mine.data ?? [];
  const toOff = listingsToSwitch(items, false).length;
  const toOn = listingsToSwitch(items, true).length;
  const run = useMutation({
    mutationFn: (on: boolean) => setOffersForAll(items, on),
    onSuccess: ({ changed, failed }, on) => {
      const done = `Offers turned ${on ? "on" : "off"} for ${listingsWord(changed)}.`;
      if (failed > 0) toast.error(`${changed > 0 ? `${done} ` : ""}${listingsWord(failed)} could not be changed. Try again.`);
      else toast(done);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: () => toast.error("We couldn't change your listings. Try again."),
  });
  if (mine.isLoading || mine.isError || (toOff === 0 && toOn === 0)) return null;
  // Audit 11-10 F345: one line says where offers stand across the listings up; the two buttons are short.
  const total = toOff + toOn;
  return (
    <div className="space-y-2 border-t border-border pt-4" role="group" aria-labelledby="offers-for-all" data-offers-for-all="">
      <p id="offers-for-all" className="text-ds-14 font-semibold text-foreground">Listings already up</p>
      <p className="text-ds-13 text-muted-foreground" data-offers-standing="">
        Offers are on for {toOff} of {listingsWord(total)}.
      </p>
      <div className="flex flex-wrap gap-2">
        {toOn > 0 && (
          <Button type="button" size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(true)}>
            Turn all on
          </Button>
        )}
        {toOff > 0 && (
          <Button type="button" size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(false)}>
            Turn all off
          </Button>
        )}
      </div>
    </div>
  );
}
