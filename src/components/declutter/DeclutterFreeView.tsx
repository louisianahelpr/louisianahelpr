/**
 * Declutter > Free (OWN-FREE; owner request via the lead, 2026-10-30): the live free items nearby, closest first.
 * The same read and the same rule as Browse's "Free" filter (the Free section, 20261027170717): fetchLiveItems
 * under Browse's query key (one cache), then applyBrowseFilters with only freeOnly on, so the tab and the filter
 * can never disagree about what is free. A member's own listings are left out, as on Browse.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gift } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { fetchLiveItems, fetchPhotos, fetchWatching, setWatch } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { nearestFirst } from "@/lib/declutter/distance";
import { NO_FILTERS, applyBrowseFilters } from "@/lib/declutter/browseFilters";
import { ItemCard, firstPhotos } from "./DeclutterItemCard";
import { DeclutterMilesFrom } from "./DeclutterMilesFrom";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { DECLUTTER_GRID, DeclutterBrowseBones } from "./DeclutterSkeletons";

const FREE_ONLY = { ...NO_FILTERS, freeOnly: true };

export function FreeView({ userId }: { userId: string }) {
  const { origin, askDevice, asked, asking, canAskAgain, deviceNote, zip } = useDeclutterOrigin();
  const lat = origin.status === "ready" ? origin.lat : null;
  const lng = origin.status === "ready" ? origin.lng : null;
  const items = useQuery({ queryKey: ["declutter", "live"], queryFn: fetchLiveItems });
  const rows = useMemo(() => {
    const from = lat !== null && lng !== null ? { lat, lng } : null;
    return applyBrowseFilters(nearestFirst((items.data ?? []).filter((i) => i.seller_id !== userId), from, null), FREE_ONLY, "", undefined);
  }, [items.data, userId, lat, lng]);
  const ids = rows.map((r) => r.item.id);
  const photos = useQuery({ queryKey: ["declutter", "photos", ids.join(",")], queryFn: () => fetchPhotos(ids), enabled: ids.length > 0 });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  // The hearts: the same watchlist read and write as Browse's cards.
  const qc = useQueryClient();
  const watching = useQuery({ queryKey: ["declutter", "watching", userId], queryFn: () => fetchWatching(userId) });
  const toggleWatch = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setWatch(id, on),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["declutter", "watching"] }),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const phase = useFeedPhase(items);

  if (items.isError) return <ErrorState variant="inline" title="We couldn't load free items." body={declutterErrorMessage(items.error)} onRetry={() => void items.refetch()} />;
  // ONE gate for the list and its cover photos (oneLoadingGatePerScreen.test.ts).
  if (items.isLoading || photos.isLoading || watching.isLoading || origin.status === "pending") return <DeclutterBrowseBones />;
  if (phase === "offline-empty") return <OfflineEmptyState body="Free items will show here once you're back online." onRetry={() => void items.refetch()} />;
  if (rows.length === 0) {
    return <BrowseEmptyState icon={Gift} title="Nothing free right now." body="Check back soon, or give something away yourself." />;
  }
  const approximate = origin.status === "ready" && origin.approximate;
  return (
    <div className="space-y-4">
      {/* Where the miles are measured from, and "Use my location", as on Browse (DA-10). */}
      <DeclutterMilesFrom ask={{ origin, askDevice, asked, asking, canAskAgain, deviceNote, zip }} />
      <ul className={DECLUTTER_GRID} data-testid="declutter-free-list">
        {rows.map(({ item, miles }) => (
          <li key={item.id} className="min-w-0">
            <ItemCard item={item} photoPath={cover.get(item.id)} miles={miles} approximate={approximate}
              save={{
                on: watching.data?.has(item.id) ?? false,
                toggle: () => toggleWatch.mutate({ id: item.id, on: !(watching.data?.has(item.id) ?? false) }),
                pending: toggleWatch.isPending && toggleWatch.variables?.id === item.id,
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
