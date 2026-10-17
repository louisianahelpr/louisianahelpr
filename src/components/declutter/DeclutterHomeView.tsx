/**
 * /declutter — Declutter's own tab (spec rows 1, 2): Browse (nearest first,
 * a distance filter, area + miles only: rows 5, 27) and My listings (every
 * status in plain words, incl. waiting for a review: row 33). Hidden unless
 * the 'declutter' switch is on for the member (DeclutterGate).
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeature } from "@/hooks/useFeature";
import { ChevronRight, Truck } from "lucide-react";
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
import { useDeclutterOrigin, type DeclutterOrigin } from "./useDeclutterOrigin";
import { CartView, OffersView, StrikeCount } from "./DeclutterTradeViews";
import { WantedView } from "./DeclutterWantedViews";
// The delivery screens load on their own (Q178, 2026-10-17): imported statically
// from two Declutter screens, the shared Helpr task module rode in
// signed-in-shared and put /posts over its critical-path budget.
const DeliverView = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.DeliverView })));

type View = "browse" | "mine" | "offers" | "cart" | "deliver" | "wanted";
const VIEWS: View[] = ["browse", "mine", "offers", "cart", "deliver", "wanted"];

function firstPhotos(photos: DeclutterPhoto[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of photos) if (!out.has(p.item_id)) out.set(p.item_id, p.storage_path);
  return out;
}

function ItemCard({ item, photoPath, miles, approximate }: { item: DeclutterItem; photoPath?: string; miles: number | null; approximate: boolean }) {
  const away = milesLabel(miles, approximate);
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
        <p className="text-base font-bold">
          {formatPrice(item.current_price_cents)}
          {item.current_price_cents < item.price_cents && (
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              <span className="sr-only">Price dropped, was </span>
              <s aria-hidden>{formatPrice(item.price_cents)}</s>
            </span>
          )}
        </p>
        <ConditionStars stars={item.condition_stars} showLabel={false} />
        <p className="text-xs text-muted-foreground truncate" title={`${item.area_label}${away ? ` · ${away}` : ""}`}>
          {item.area_label}
          {away ? ` · ${away}` : ""}
        </p>
      </div>
    </Link>
  );
}

/** Where the miles are counted from, and the one place Declutter asks for the device's location. */
function OriginLine({
  origin,
  asked,
  asking,
  canAskAgain,
  deviceNote,
  onUse,
}: {
  origin: DeclutterOrigin;
  asked: boolean;
  asking: boolean;
  canAskAgain: boolean;
  deviceNote: string | null;
  onUse: () => void;
}) {
  if (origin.status !== "ready" || origin.source === "device") return null;
  const from = origin.source === "profile" ? "your saved location" : origin.source === "zip" ? "your ZIP code's area" : "your parish's center";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-xs text-muted-foreground">Miles are counted from {from}.</p>
      {(!asked || canAskAgain) && (
        <Button type="button" variant="outline" size="sm" onClick={onUse}>
          {asked ? "Try my location again" : "Use my location"}
        </Button>
      )}
      {asking && <p className="text-xs text-muted-foreground" role="status">Finding you…</p>}
      {deviceNote && <p className="text-xs text-muted-foreground" role="status">{deviceNote}</p>}
    </div>
  );
}

function BrowseView({ userId }: { userId: string }) {
  const [maxMiles, setMaxMiles] = useState<number | null>(25);
  // No location prompt on landing: miles come from what we already know, and
  // the device is asked only from the "Use my location" button below.
  const { origin, askDevice, asked, asking, canAskAgain, deviceNote } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
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
  const listLoading = items.isLoading || photos.isLoading || origin.status === "pending";

  if (items.isError) {
    return <ErrorState variant="inline" title="We couldn't load items." body={declutterErrorMessage(items.error)} onRetry={() => void items.refetch()} />;
  }
  return (
    <div className="space-y-4">
      {origin.status === "pending" ? null : from ? (
        <>
          <SegmentedControl
            ariaLabel="How far away"
            layout="wrap"
            value={maxMiles === null ? "any" : String(maxMiles)}
            onChange={(v) => setMaxMiles(v === "any" ? null : Number(v))}
            options={DISTANCE_CHOICES.map((m) => ({ value: m === null ? "any" : String(m), label: m === null ? "Any distance" : `${m} mi` }))}
          />
          <OriginLine origin={origin} asked={asked} asking={asking} canAskAgain={canAskAgain} deviceNote={deviceNote} onUse={askDevice} />
        </>
      ) : (
        <DeclutterNotice title="Nearest items show first once we know where you are.">
          <p>
            {origin.status === "none" && origin.zipOnFile
              ? // The profile HAS a ZIP; we just couldn't place it. Never tell them to add one.
                "We couldn't find the area for the ZIP code on your profile, so items show without miles for now."
              : asked
                ? "Add your ZIP code in your profile to see how far each item is."
                : "Use your location, or add your ZIP code in your profile, to see how far each item is."}
          </p>
          {asking && <p className="mt-1" role="status">Finding you…</p>}
          {deviceNote && <p className="mt-1" role="status">{deviceNote}</p>}
          {(!asked || canAskAgain) && (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={askDevice}>
              {asked ? "Try my location again" : "Use my location"}
            </Button>
          )}
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
              <ItemCard item={item} photoPath={cover.get(item.id)} miles={miles} approximate={origin.status === "ready" && origin.approximate} />
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
              <Button type="button" size="sm" onClick={() => navigate(`/declutter/sell?item=${item.id}`)}>
                Finish listing
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link to={`/declutter/item/${item.id}`}>View</Link>
              </Button>
            )}
            {(item.status === "draft" || item.status === "pending_review" || item.status === "live") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={takeDown.isPending}
                onClick={() => {
                  if (window.confirm(item.status === "draft" ? "Delete this unfinished listing?" : "Take this item off sale?")) {
                    takeDown.mutate(item.id);
                  }
                }}
              >
                {item.status === "draft" ? "Delete" : "Take down"}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Moving-out mode's way in (docs/specs/declutter-moving-out.md), only while its switch is on. */
function MovingOutEntry() {
  const on = useFeature("declutter_moving_out");
  if (!on) return null;
  return (
    <Link
      to="/declutter/move"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Truck className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Moving out?</span>
        <span className="block text-xs text-muted-foreground">Photograph each room and list everything at once</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export default function DeclutterHome() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // W14: "Wanted" exists only while its own switch is on for this member.
  const wantedOn = useFeature("declutter_wanted");
  const asked = params.get("view") as View | null;
  const view: View = asked && VIEWS.includes(asked) && (asked !== "wanted" || wantedOn) ? asked : "browse";
  if (!user) return null;
  return (
    <AppPage
      title="Declutter"
      titleActions={
        <Button type="button" size="sm" className="whitespace-nowrap" onClick={() => navigate("/declutter/sell")}>
          Sell an item
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">Buy and sell used household items near you. Pick up, or have a Helpr deliver it.</p>
      <SegmentedControl
        ariaLabel="Declutter view"
        semantics="tab"
        value={view}
        layout="wrap"
        onChange={(v) => setParams(v === "browse" ? {} : { view: v }, { replace: true })}
        options={[
          { value: "browse", label: "Browse" },
          { value: "mine", label: "My listings" },
          { value: "offers", label: "Offers" },
          { value: "cart", label: "Cart" },
          { value: "deliver", label: "Deliver" },
          ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []),
        ]}
      />
      <StrikeCount userId={user.id} />
      {view === "mine" && <MovingOutEntry />}
      {view === "browse" ? <BrowseView userId={user.id} />
        : view === "mine" ? <MyListingsView userId={user.id} />
          : view === "offers" ? <OffersView />
            : view === "deliver" ? <Suspense fallback={<HelprSpinner />}><DeliverView /></Suspense>
              : view === "wanted" ? <WantedView />
              : <CartView />}
    </AppPage>
  );
}
