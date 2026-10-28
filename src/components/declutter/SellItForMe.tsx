/**
 * "Sell it for me" (owner order 2026-10-19 ~21Z; src/lib/declutter/sellForMe.ts).
 * A seller who doesn't want to photograph and list things picks who helps,
 * in one sheet:
 *   A. Hire a local Helpr: Post a Job, pre-filled as a Declutter Help job.
 *   B. Ask a local business: nearby shops in "Declutter and estate sale
 *      services", on the Shops Browse card. Only while the 'shops' switch is
 *      on for the viewer; otherwise the sheet offers A alone.
 * "Request a quote" is greyed with "Coming soon" (lead, 2026-10-19): a shop
 * cannot be asked yet, neither by quote invite (Q1869) nor by message
 * (Q1947), so a tap only says so. The card itself opens the shop's page.
 * The entry shows only where Declutter shows (the 'declutter' switch).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, HandHelping, Store, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { useFeature } from "@/hooks/useFeature";
import { useAgeGate } from "@/hooks/useAgeGate";
import { browseShops, fetchShopCardExtras } from "@/lib/shops/api";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { sellForMePostJobPath, SELL_FOR_ME_SHOP_CATEGORY } from "@/lib/declutter/sellForMe";
import { ShopBrowseCard } from "@/components/shops/ShopBrowseCard";
import { categoryLabel, useShopCategories } from "@/components/shops/shopsUi";
import { useDeclutterOrigin } from "./useDeclutterOrigin";

/** At most this many businesses in the sheet, nearest first. */
const MAX_SHOPS = 6;

/** What a tap on the greyed "Request a quote" says (no shop can be asked yet). */
export const QUOTE_SOON_LINE = "Asking a business for a quote opens soon. For now, see their shop or hire a Helpr.";

const ROW = "flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The way in: on Declutter's Selling tab (with the listings, so it shows on
 * the empty state too) and on the Sell an item page. Opens the sheet.
 */
export function SellItForMeEntry({ grouped = false }: { grouped?: boolean }) {
  const declutterOn = useFeature("declutter");
  const [open, setOpen] = useState(false);
  if (!declutterOn) return null;
  // grouped: a row inside the Selling tab's "More ways to sell" card (owner 2026-10-28: rows, not loose grey pills),
  // so the card draws the border and this row only its own padding.
  const rowClass = grouped
    ? "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    : ROW;
  return (
    <>
      <button type="button" className={rowClass} onClick={() => setOpen(true)} data-testid="sell-it-for-me-entry">
        <HandHelping className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-sm">Sell it for me</span>
          <span className="block text-xs text-muted-foreground">Too busy? Get help photographing and listing your stuff</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <SellItForMeSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function SellItForMeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const shopsOn = useFeature("shops");
  const navigate = useNavigate();
  // Under 18 cannot post a job (Q1586): the choice is greyed and a tap says why.
  const { underAge, explain, gatedProps } = useAgeGate();
  const hireHelpr = () => {
    if (underAge) {
      explain("post");
      return;
    }
    onOpenChange(false);
    navigate(sellForMePostJobPath());
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] overflow-y-auto">
        <SheetHero title="Sell it for me" />
        <div className="space-y-5" data-testid="sell-it-for-me-sheet">
          <p className="text-sm text-muted-foreground">
            {shopsOn ? "Pick who helps. It's your choice." : "A local Helpr can do the photos and listings with you."}
          </p>
          <button type="button" className={ROW} onClick={hireHelpr} data-testid="sell-for-me-hire-helpr" {...gatedProps("post")}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-ds-15">Hire a local Helpr</span>
              <span className="block text-ds-13 text-muted-foreground">
                They come over, take the photos and write the listings with you. You post them from your account. You set the price.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          {shopsOn && open && <LocalBusinesses />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Option B: nearby shops that sell things for people. With none nearby it only says so: "Hire a local Helpr" sits
 * right above, and a second "Hire a Helpr instead" button did the same thing (deep audit #34, shot 107).
 */
function LocalBusinesses() {
  const { origin } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const categories = useShopCategories();
  const shops = useQuery({
    queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, "category", SELL_FOR_ME_SHOP_CATEGORY],
    queryFn: () => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null, category: SELL_FOR_ME_SHOP_CATEGORY }),
    enabled: origin.status !== "pending",
  });
  const list = (shops.data ?? []).slice(0, MAX_SHOPS);
  const ids = list.map((s) => s.id);
  const extras = useQuery({
    queryKey: ["shops", "browse-extras", ids.join(",")],
    queryFn: () => fetchShopCardExtras(ids),
    enabled: shops.isSuccess && ids.length > 0,
  });
  const loading = origin.status === "pending" || shops.isLoading || categories.isLoading || (ids.length > 0 && extras.isLoading);
  const [asked, setAsked] = useState<string | null>(null);
  const group = categories.data?.find((c) => c.slug === SELL_FOR_ME_SHOP_CATEGORY)?.group_slug ?? null;

  return (
    <section className="space-y-3" aria-labelledby="sell-for-me-businesses" data-testid="sell-for-me-businesses">
      <div>
        <h3 id="sell-for-me-businesses" className="font-semibold text-ds-15">Or ask a local business</h3>
        <p className="text-ds-13 text-muted-foreground">Consignment, estate sale and cleanout businesses near you.</p>
      </div>
      {shops.isError ? (
        <ErrorState variant="inline" title="We couldn't load businesses." body={shopsErrorMessage(shops.error)} onRetry={() => void shops.refetch()} />
      ) : loading ? (
        <div role="status" aria-label="Loading businesses" className="space-y-2">
          <Skeleton className="aspect-[2/1] w-full rounded-2xl bg-photo-empty" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-center" data-testid="sell-for-me-no-businesses">
          <Store className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-semibold">No local businesses offer this yet.</p>
        </div>
      ) : (
        // One card across in a phone-width sheet, two side by side once the sheet is wide (desktop).
        <ul className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
          {list.map((s) => (
            <li key={s.id} className="min-w-0 space-y-2" data-testid="sell-for-me-shop">
              <ShopBrowseCard shop={s} category={categoryLabel(categories.data, s.category)} group={group} extras={extras.data?.get(s.id)} />
              <div className="flex items-center gap-2 px-0.5">
                <SectionActionPill
                  variant="outline"
                  aria-disabled="true"
                  aria-label="Request a quote, coming soon"
                  className="bg-muted/50 text-muted-foreground shadow-none hover:bg-muted/50 hover:text-muted-foreground"
                  onClick={() => setAsked(s.id)}
                  data-testid="sell-for-me-request-quote"
                >
                  Request a quote
                </SectionActionPill>
                <span className="text-ds-13 text-muted-foreground">Coming soon</span>
              </div>
              {asked === s.id && (
                <p role="status" className="px-0.5 text-ds-13 text-muted-foreground">
                  {QUOTE_SOON_LINE}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
