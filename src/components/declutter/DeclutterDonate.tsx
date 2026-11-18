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
import { RadioCardList } from "@/components/ui/RadioCardList";
import { getLang, t } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclSell";

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
      <legend className="px-1 text-ds-15 font-semibold">{t("dsl.don.title")}</legend>
      <p className="text-ds-13 text-muted-foreground">
        {itemIds.length === 1 ? t("dsl.don.bodyOne") : t("dsl.don.bodyMany")}
      </p>
      {/* The shared choice cards (deep audit #53: the bare radios read as bullets). A pick saves at once; a second
          tap while it saves is ignored. */}
      <RadioCardList
        label={t("dsl.don.charity")}
        value={chosen?.id ?? ""}
        onChange={(id) => {
          if (!choose.isPending && id !== chosen?.id) choose.mutate(id);
        }}
        options={rows.map((p) => ({
          value: p.id,
          label: <span className="[overflow-wrap:anywhere]">{p.name}</span>,
          sub: (
            <>
              <span className="block [overflow-wrap:anywhere]">
                {t(p.miles === 1 ? "dsl.don.aboutMile" : "dsl.don.aboutMiles", { address: p.address, n: p.miles })}
              </span>
              {p.takes && <span className="block [overflow-wrap:anywhere]">{t("dsl.don.takes", { what: p.takes })}</span>}
            </>
          ),
        }))}
      />
      {chosen && (
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={donatePostJobPath(haulAwayPostJobPath(itemIds))}>{t("dsl.don.post")}</Link>
        </Button>
      )}
    </fieldset>
  );
}

/** The seller's donation receipts. Nothing until there is one. */
export function DonationReceipts() {
  const mine = useQuery({ queryKey: ["declutter", "my-donations"], queryFn: () => fetchMyDonations() });
  // An error with a retry (audit 2026-10-28: "Pull to refresh" with no button, and a desktop page cannot be pulled).
  if (mine.isError) return <ErrorState variant="inline" title={t("dsl.don.loadError")} body={haulAwayErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  const receipts = (mine.data ?? []).filter((d) => d.receipt && d.donated_at);
  if (receipts.length === 0) return null;
  return (
    <section aria-labelledby="donation-receipts-title" className="space-y-2 rounded-2xl border border-border bg-card p-4" data-donation-receipts="">
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-5 w-5 shrink-0" aria-hidden />
        <h2 id="donation-receipts-title" className="text-base font-semibold">{t("dsl.don.receipts")}</h2>
      </div>
      <ul className="divide-y divide-border">
        {receipts.map((d) => (
          <li key={d.item_id} className="py-2 min-w-0">
            <p className="text-ds-14 font-semibold [overflow-wrap:anywhere]">{d.item_title}</p>
            <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">
              {/* Area 06b L12 (design audit 11-18): the app's one date style, "Nov 17, 2026", in the member's language. */}
              {t("dsl.don.tookIt", { name: d.partner_name, address: d.partner_address, date: new Date(d.donated_at!).toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" }) })}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-ds-13 text-muted-foreground">{t("dsl.don.record")}</p>
      {/* L12: the receipt can be kept (the browser's print sheet saves it as a PDF). */}
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()} data-donation-save="">{t("dsl.don.save")}</Button>
    </section>
  );
}
