/**
 * Declutter: donate what doesn't sell (Q2428, owner 2026-10-27; migration 20261027222743), on the "Haul it away"
 * card. The seller picks a partner charity near the items (admins curate them); "Post a donation job" opens Post a
 * Job pre-filled to drop them there. When that job is completed, each item has a receipt: the item, the date, the
 * charity. No value is ever stated.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { chooseDonation, donatePostJobPath, fetchDonationPartnersNear, fetchMyDonations } from "@/lib/declutter/donate";
import { haulAwayErrorMessage } from "@/lib/declutter/haulAwayErrors";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
import { ErrorState } from "@/components/ui/ErrorState";

/** The charity choice for the items on the card, and the way to post the donation job. Nothing when none is near. */
export function DonatePicker({ itemIds }: { itemIds: string[] }) {
  const qc = useQueryClient();
  const key = ["declutter", "donation-partners", itemIds.join(",")];
  const partners = useQuery({ queryKey: key, queryFn: () => fetchDonationPartnersNear(itemIds), enabled: itemIds.length > 0 });
  const choose = useMutation({
    mutationFn: (id: string) => chooseDonation(itemIds, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (err) => toast.error(haulAwayErrorMessage(err)),
  });
  const rows = partners.data ?? [];
  if (partners.isError || rows.length === 0) return null;
  const chosen = rows.find((p) => p.chosen);
  return (
    <fieldset className="min-w-0 space-y-2 rounded-2xl border border-border p-3" data-donate-picker="">
      <legend className="px-1 text-ds-15 font-semibold">Or donate it</legend>
      <p className="text-ds-13 text-muted-foreground">
        Pick a charity near you. The Helpr drops {itemIds.length === 1 ? "it" : "them"} there, and you get a receipt here
        (the item, the date and the charity).
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="Charity">
        {rows.map((p) => (
          <label key={p.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-2">
            <input
              type="radio"
              name="donate-partner"
              className="mt-1 h-4 w-4 min-h-0 min-w-0"
              style={{ accentColor: "hsl(var(--primary))" }}
              checked={p.chosen}
              disabled={choose.isPending}
              onChange={() => choose.mutate(p.id)}
            />
            <span className="min-w-0">
              <span className="block text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.name}</span>
              <span className="block text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">
                {p.address} · about {p.miles} {p.miles === 1 ? "mile" : "miles"}
              </span>
              {p.takes && <span className="block text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">Takes: {p.takes}</span>}
            </span>
          </label>
        ))}
      </div>
      {chosen && (
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={donatePostJobPath(haulAwayPostJobPath(itemIds))}>Post a donation job</Link>
        </Button>
      )}
    </fieldset>
  );
}

/** The seller's donation receipts. Nothing until there is one. */
export function DonationReceipts() {
  const mine = useQuery({ queryKey: ["declutter", "my-donations"], queryFn: () => fetchMyDonations() });
  // An error with a retry (audit 2026-10-28: "Pull to refresh" with no button, and a desktop page cannot be pulled).
  if (mine.isError) return <ErrorState variant="inline" title="We couldn't load your donation receipts." body={haulAwayErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  const receipts = (mine.data ?? []).filter((d) => d.receipt && d.donated_at);
  if (receipts.length === 0) return null;
  return (
    <section aria-labelledby="donation-receipts-title" className="space-y-2 rounded-2xl border border-border bg-card p-4" data-donation-receipts="">
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-5 w-5 shrink-0" aria-hidden />
        <h2 id="donation-receipts-title" className="text-ds-17 font-bold">Donation receipts</h2>
      </div>
      <ul className="divide-y divide-border">
        {receipts.map((d) => (
          <li key={d.item_id} className="py-2 min-w-0">
            <p className="text-ds-14 font-semibold [overflow-wrap:anywhere]">{d.item_title}</p>
            <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">
              Your Helpr took it to {d.partner_name}, {d.partner_address}, on{" "}
              {new Date(d.donated_at!).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}.
            </p>
          </li>
        ))}
      </ul>
      <p className="text-ds-13 text-muted-foreground">A record of what you gave and where. It doesn't state a value.</p>
    </section>
  );
}
