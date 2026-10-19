/**
 * /declutter — Declutter's own tab (spec rows 1, 2). Its tabs (owner,
 * 2026-10-18; src/lib/declutter/tabs.ts): Browse (nearest first, a distance
 * filter, area + miles only: rows 5, 27) · Buying (cart, your offers,
 * purchases) · Selling (your listings with every status in plain words, incl.
 * waiting for a review: row 33; offers on your items; sales waiting to be paid;
 * paid sales and payouts) · Wanted · Deliver. Old links (?view=mine|offers|cart)
 * open the tab that now holds them. Hidden unless the 'declutter' switch is on
 * for the member (DeclutterGate).
 */
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeatureStatus } from "@/hooks/useFeature";
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
import { BuyingView, OffersSection, PaidOrders, SalesWaiting, SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTradeViews";
import {
  DECLUTTER_TABS,
  OLD_DECLUTTER_VIEWS,
  oldDeclutterView,
  type DeclutterTab,
  type OldDeclutterView,
} from "@/lib/declutter/tabs";
import { WantedView } from "./DeclutterWantedViews";
import { HaulAwayCard, HaulAwayItemActions, HaulAwayItemLine } from "./DeclutterHaulAway";
import { report } from "@/lib/errorLogger";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
// Types only: the predicates (oneTripGroup, haulJobToDelete) come with the lazily loaded haul-away code (Q178).
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { DeclutterBrowseBones, DeclutterHomeSkeleton } from "./DeclutterSkeletons";

/** The haul-away server calls load with My listings' first haul-away read, never on another route's path (Q178). */
const haulLib = () => import("@/lib/declutter/haulAway");

// The delivery screens load on their own (Q178, 2026-10-17): imported statically
// from two Declutter screens, the shared Helpr task module rode in
// signed-in-shared and put /posts over its critical-path budget.
const DeliverView = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.DeliverView })));


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

/** Grey shimmer rows shaped like the listing cards (owner 2026-10-18, tweak 5). */
function ListingsSkeleton() {
  return (
    <ul className="space-y-3" role="status" aria-label="Loading your listings">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-2xl bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-1/4" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BrowseView({ userId }: { userId: string }) {
  // Any distance by default (owner, 2026-10-19); the member's own choice holds for the visit.
  const [maxMiles, setMaxMiles] = useState<number | null>(null);
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
  // ONE PAINT: the distance row, the origin line and the cards arrive
  // together. Painting the list's "Loading items…" line before the origin was
  // known let the distance row land above it later and push it down
  // (Q?declutter-settle: CLS 0.0322 at 375 on prod).
  if (listLoading) return <DeclutterBrowseBones />;
  return (
    <div className="space-y-4">
      {from ? (
        <>
          <SegmentedControl
            ariaLabel="How far away"
            layout="row"
            className="chip-row"
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
      {rows.length === 0 ? (
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

function MyListingsView({ userId, haulOn }: { userId: string; haulOn: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mine = useQuery({ queryKey: ["declutter", "mine", userId], queryFn: () => fetchMyItems(userId) });
  // Haul-away (docs/specs/declutter-haul-away.md): hidden behind its own switch,
  // read by DeclutterHome so the page lands once (Q?declutter-settle).
  const haul = useQuery({
    queryKey: ["declutter", "haul-away", userId],
    enabled: haulOn,
    queryFn: async () => {
      const lib = await haulLib();
      const rows = await lib.fetchHaulAwayState();
      // The items one trip can take, by the same rule as the server's link (isPostable).
      return { rows, trip: lib.oneTripGroup(rows) };
    },
  });
  const haulById = useMemo(() => new Map<string, HaulAwayRow>((haul.data?.rows ?? []).map((r) => [r.item_id, r])), [haul.data]);
  // An unpaid haul-away's job is deleted first (its checkout can then never
  // be opened again), then the item is put back or booked on a new job.
  // Only a 'job_open' job is deleted (never a cancelled one, whose photos and
  // record stay). A declined card's job ('job_stuck') can't be deleted by its
  // poster, so it is never tried: reported, and the seller is told it can't be
  // removed from here; a delete the policy refuses anyway is reported inside
  // deleteNeverPaidHaulJob (unwrapMutation) and told the same way.
  const releaseJob = async (row: HaulAwayRow) => {
    const lib = await haulLib();
    // Its words ride on userMessage (declutterErrorMessage shows them): the
    // haul-away copy loads with the haul-away code, never on /posts (Q178).
    const stuck = () => Object.assign(new Error("haul_away_job_stuck"), { userMessage: lib.HAUL_AWAY_CLIENT_ERROR_COPY.haul_away_job_stuck });
    if (row.job_hold === "job_stuck") {
      report(new Error("haul-away job is stuck: a declined card, and the person who posted it can't delete it"), {
        severity: "warning",
        tags: { source: "DeclutterHome.releaseHaulJob" },
        context: { job_id: row.job_id },
      });
      throw stuck();
    }
    const jobId = lib.haulJobToDelete(row);
    if (jobId && !(await lib.deleteNeverPaidHaulJob(jobId))) throw stuck();
  };
  const putBack = useMutation({
    mutationFn: async (row: HaulAwayRow) => {
      await releaseJob(row);
      return (await haulLib()).cancelHaulAway(row.item_id);
    },
    onSuccess: (status) => {
      toast.success(status === "live" ? "Back on sale." : "Haul-away cancelled. The item is off sale.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const finishBooking = useMutation({
    mutationFn: releaseJob,
    onSuccess: (_v, row) => navigate(haulAwayPostJobPath([row.item_id])),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
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
  if (mine.isLoading) return <ListingsSkeleton />;
  const list = (mine.data ?? []).filter((i) => i.status !== "withdrawn");
  if (list.length === 0) {
    return (
      <section className="space-y-2" aria-label="Your listings">
        <SectionHeading title="Your listings" />
        <DeclutterNotice title="You haven't listed anything yet.">Tap "Sell an item" to start.</DeclutterNotice>
      </section>
    );
  }
  return (
    <section className="space-y-3" aria-label="Your listings">
      <SectionHeading title="Your listings" />
      {haulOn && !haul.isError && <HaulAwayCard group={haul.data?.trip ?? []} />}
    {haulOn && haul.isError && (
      <ErrorState variant="inline" title="We couldn't check your haul-aways." body={declutterErrorMessage(haul.error)} onRetry={() => void haul.refetch()} />
    )}
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
            {haulOn && <HaulAwayItemLine row={haulById.get(item.id)} />}
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
              {haulOn && (
                <HaulAwayItemActions
                  row={haulById.get(item.id)}
                  onFinishBooking={(row) => finishBooking.mutate(row)}
                  onPutBack={(row) => putBack.mutate(row)}
                  pending={putBack.isPending || finishBooking.isPending}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Selling (owner, 2026-10-18): your listings, the offers on your items, sales
 * waiting for the buyer to pay, and paid sales (pickup, handover, payout).
 */
function SellingView({ userId, haulOn, movingOutOn }: { userId: string; haulOn: boolean; movingOutOn: boolean }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <MovingOutEntry on={movingOutOn} />
        <MyListingsView userId={userId} haulOn={haulOn} />
      </div>
      <OffersSection side="seller" />
      <SalesWaiting />
      <PaidOrders side="seller" />
    </div>
  );
}

/** Moving-out mode's way in (docs/specs/declutter-moving-out.md), only while its switch is on. */
function MovingOutEntry({ on }: { on: boolean }) {
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
  // The tab row waits for that answer (Q?declutter-settle): painted before it,
  // the Wanted tab arrived ~20 ms later and, at 375, wrapped the row onto a
  // third line that pushed the whole view 46px down. DeclutterPage starts the
  // read alongside the 'declutter' one, so the wait is usually nothing.
  const wanted = useFeatureStatus("declutter_wanted");
  // The haul-away and moving-out switches shape My listings the same way, so
  // they are read here and waited for with it (one paint, no late card).
  const haulAway = useFeatureStatus("declutter_haul_away");
  const movingOut = useFeatureStatus("declutter_moving_out");
  // The Buying / Selling badges (what needs the member) are read with the
  // switches and waited for with them: a count landing after the tab row
  // painted would widen its tab and could re-wrap the row (Q?declutter-settle).
  // The same reads fill the Buying and Selling tabs, so those open filled.
  const { todo, settled: todoSettled } = useDeclutterTodo();
  const tabsReady = useArrivalGate(true, wanted.settled && haulAway.settled && movingOut.settled && todoSettled);
  const wantedOn = wanted.on;
  const asked = params.get("view");
  const legacy = OLD_DECLUTTER_VIEWS.includes(asked as OldDeclutterView) ? (asked as OldDeclutterView) : null;
  const view: DeclutterTab = legacy
    ? oldDeclutterView(legacy, todo)
    : asked && DECLUTTER_TABS.includes(asked as DeclutterTab) && (asked !== "wanted" || wantedOn)
      ? (asked as DeclutterTab)
      : "browse";
  // An old link (?view=mine|offers|cart, still in sent notifications and
  // emails) is rewritten to its new tab once the badges' reads are in (they
  // decide which side an offers/cart link meant), keeping its other params.
  useEffect(() => {
    if (!legacy || !tabsReady) return;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("view", view);
      return next;
    }, { replace: true });
  }, [legacy, tabsReady, view, setParams]);
  if (!user) return null;
  if (!tabsReady) return <DeclutterHomeSkeleton />;
  return (
    <AppPage
      title="Declutter"
      titleActions={
        <SectionActionPill onClick={() => navigate("/declutter/sell")}>
          Sell an item
        </SectionActionPill>
      }
    >
      <p className="text-sm text-muted-foreground">Buy and sell used household items near you. Pick up, or have a Helpr deliver it.</p>
      <SegmentedControl
        ariaLabel="Declutter view"
        semantics="tab"
        value={view}
        layout="row"
        className="chip-row"
        onChange={(v) => setParams(v === "browse" ? {} : { view: v }, { replace: true })}
        options={[
          { value: "browse", label: "Browse" },
          {
            value: "buying",
            label: "Buying",
            count: todo?.buying,
            countTone: "attention",
            countLabel: todo?.buying ? `${todo.buying} need${todo.buying === 1 ? "s" : ""} you` : undefined,
          },
          {
            value: "selling",
            label: "Selling",
            count: todo?.selling,
            countTone: "attention",
            countLabel: todo?.selling ? `${todo.selling} need${todo.selling === 1 ? "s" : ""} you` : undefined,
          },
          ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []),
          { value: "deliver", label: "Deliver" },
        ]}
      />
      <StrikeCount userId={user.id} />
      {view === "browse" ? <BrowseView userId={user.id} />
        : view === "buying" ? <BuyingView />
          : view === "selling" ? <SellingView userId={user.id} haulOn={haulAway.on} movingOutOn={movingOut.on} />
            : view === "deliver" ? <Suspense fallback={<HelprSpinner />}><DeliverView /></Suspense>
              : <WantedView />}
    </AppPage>
  );
}
