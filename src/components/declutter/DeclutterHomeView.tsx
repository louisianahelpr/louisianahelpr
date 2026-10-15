/**
 * /declutter — Declutter's own tab (spec rows 1, 2): Browse (nearest first,
 * a distance filter, area + miles only: rows 5, 27) and My listings (every
 * status in plain words, incl. waiting for a review: row 33). Hidden unless
 * the 'declutter' switch is on for the member (DeclutterGate).
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUserLocation } from "@/hooks/useUserLocation";
import {
  fetchLiveItems,
  fetchMyItems,
  fetchPhotos,
  photoPublicUrl,
  withdrawItem,
  type DeclutterItem,
  type DeclutterPhoto,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DISTANCE_CHOICES, formatPrice, milesLabel, nearestFirst } from "@/lib/declutter/distance";
import { ConditionStars, DeclutterNotice, STATUS_HELP, STATUS_LABEL } from "./declutterUi";

type View = "browse" | "mine";

function firstPhotos(photos: DeclutterPhoto[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of photos) if (!out.has(p.item_id)) out.set(p.item_id, p.storage_path);
  return out;
}

function ItemCard({ item, photoPath, miles }: { item: DeclutterItem; photoPath?: string; miles: number | null }) {
  const away = milesLabel(miles);
  return (
    <Link
      to={`/declutter/item/${item.id}`}
      className="block rounded-2xl border border-border bg-card overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-square bg-muted">
        {photoPath ? (
          <img src={photoPublicUrl(photoPath)} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : null}
      </div>
      <div className="p-3 space-y-1 min-w-0">
        <p className="font-semibold text-sm truncate" title={item.title}>{item.title}</p>
        <p className="text-base font-bold">{formatPrice(item.current_price_cents)}</p>
        <ConditionStars stars={item.condition_stars} showLabel={false} />
        <p className="text-xs text-muted-foreground truncate" title={`${item.area_label}${away ? ` · ${away}` : ""}`}>
          {item.area_label}
          {away ? ` · ${away}` : ""}
        </p>
      </div>
    </Link>
  );
}

function BrowseView({ userId }: { userId: string }) {
  const [maxMiles, setMaxMiles] = useState<number | null>(25);
  const geo = useUserLocation(true);
  const from = geo.status === "ready" ? { lat: geo.lat, lng: geo.lng } : null;
  const items = useQuery({ queryKey: ["declutter", "live"], queryFn: fetchLiveItems });
  const others = useMemo(() => (items.data ?? []).filter((i) => i.seller_id !== userId), [items.data, userId]);
  const photos = useQuery({
    queryKey: ["declutter", "photos", others.map((i) => i.id).join(",")],
    queryFn: () => fetchPhotos(others.map((i) => i.id)),
    enabled: others.length > 0,
  });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  const rows = nearestFirst(others, from, from ? maxMiles : null);
  // ONE gate for the list and its cover photos, so the cards arrive in one
  // paint instead of the list first and its photos in a second wave
  // (oneLoadingGatePerScreen.test.ts). The photos query is disabled (never
  // loading) when there is nothing to show.
  const listLoading = items.isLoading || photos.isLoading;

  if (items.isError) {
    return <ErrorState variant="inline" title="We couldn't load items." body={declutterErrorMessage(items.error)} onRetry={() => void items.refetch()} />;
  }
  return (
    <div className="space-y-4">
      {from ? (
        <SegmentedControl
          ariaLabel="How far away"
          layout="wrap"
          value={maxMiles === null ? "any" : String(maxMiles)}
          onChange={(v) => setMaxMiles(v === "any" ? null : Number(v))}
          options={DISTANCE_CHOICES.map((m) => ({ value: m === null ? "any" : String(m), label: m === null ? "Any distance" : `${m} mi` }))}
        />
      ) : (
        <DeclutterNotice title="Nearest items show first once we know where you are.">
          Turn on location, or add your ZIP code in your profile, to see how far each item is.
        </DeclutterNotice>
      )}
      {listLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading items…</p>
      ) : rows.length === 0 ? (
        <DeclutterNotice title={others.length === 0 ? "Nothing for sale yet." : "Nothing for sale this close."}>
          {others.length === 0 ? "Check back soon, or sell something of your own." : "Try a bigger distance."}
        </DeclutterNotice>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {rows.map(({ item, miles }) => (
            <li key={item.id} className="min-w-0">
              <ItemCard item={item} photoPath={cover.get(item.id)} miles={miles} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MyListingsView({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mine = useQuery({ queryKey: ["declutter", "mine", userId], queryFn: () => fetchMyItems(userId) });
  const takeDown = useMutation({
    mutationFn: (itemId: string) => withdrawItem(itemId),
    onSuccess: () => {
      toast.success("Taken down.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  if (mine.isError) {
    return <ErrorState variant="inline" title="We couldn't load your listings." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  }
  if (mine.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading your listings…</p>;
  const list = (mine.data ?? []).filter((i) => i.status !== "withdrawn");
  if (list.length === 0) {
    return <DeclutterNotice title="You haven't listed anything yet.">Tap "Sell an item" to start.</DeclutterNotice>;
  }
  return (
    <ul className="space-y-3">
      {list.map((item) => (
        <li key={item.id} className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <p className="font-semibold truncate">{item.title}</p>
              <p className="text-sm text-muted-foreground">{formatPrice(item.current_price_cents)}</p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium" data-status={item.status}>
              {STATUS_LABEL[item.status]}
            </span>
          </div>
          {STATUS_HELP[item.status] && <p className="text-xs text-muted-foreground">{STATUS_HELP[item.status]}</p>}
          <div className="flex flex-wrap gap-2">
            {item.status === "draft" ? (
              <button
                type="button"
                className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold"
                onClick={() => navigate(`/declutter/sell?item=${item.id}`)}
              >
                Finish listing
              </button>
            ) : (
              <Link to={`/declutter/item/${item.id}`} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">
                View
              </Link>
            )}
            {(item.status === "draft" || item.status === "pending_review" || item.status === "live") && (
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={takeDown.isPending}
                onClick={() => {
                  if (window.confirm(item.status === "draft" ? "Delete this unfinished listing?" : "Take this item off sale?")) {
                    takeDown.mutate(item.id);
                  }
                }}
              >
                {item.status === "draft" ? "Delete" : "Take down"}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function DeclutterHome() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "mine" ? "mine" : "browse";
  if (!user) return null;
  return (
    <AppPage
      title="Declutter"
      titleActions={
        <button
          type="button"
          className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap"
          onClick={() => navigate("/declutter/sell")}
        >
          Sell an item
        </button>
      }
    >
      <p className="text-sm text-muted-foreground">Buy and sell used household items near you. Pick up in person.</p>
      <SegmentedControl
        ariaLabel="Declutter view"
        semantics="tab"
        value={view}
        onChange={(v) => setParams(v === "mine" ? { view: "mine" } : {}, { replace: true })}
        options={[
          { value: "browse", label: "Browse" },
          { value: "mine", label: "My listings" },
        ]}
      />
      {view === "browse" ? <BrowseView userId={user.id} /> : <MyListingsView userId={user.id} />}
    </AppPage>
  );
}
