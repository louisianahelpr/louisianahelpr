/**
 * Shops: shared words and small pieces for the three screens
 * (docs/specs/local-shops-prep.md; migration 20261017061155_shops_profiles).
 * Plain words only: no codes reach the member.
 */
import { BadgeCheck, FileCheck2, IdCard, Landmark, ShieldCheck, Star, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import AppPage from "@/components/AppPage";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { featureSwitchSettled } from "@/lib/featureSwitchQuery";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { fetchShopCategories, type ShopBadges, type ShopCategory } from "@/lib/shops/api";
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The fixed category list (L54), from the server's shop_categories table. */
export function useShopCategories() {
  return useQuery({
    queryKey: ["shops", "categories"],
    queryFn: fetchShopCategories,
    staleTime: 60 * 60 * 1000,
  });
}

export function categoryLabel(categories: ShopCategory[] | undefined, slug: string): string {
  return categories?.find((c) => c.slug === slug)?.label ?? "Other";
}

/** Category groups in the owner's order. */
export function categoryGroups(categories: ShopCategory[] | undefined): { slug: string; label: string; items: ShopCategory[] }[] {
  const out: { slug: string; label: string; items: ShopCategory[] }[] = [];
  for (const c of categories ?? []) {
    let g = out.find((x) => x.slug === c.group_slug);
    if (!g) {
      g = { slug: c.group_slug, label: c.group_label, items: [] };
      out.push(g);
    }
    g.items.push(c);
  }
  return out;
}

const BADGES: { key: keyof ShopBadges; label: string; icon: typeof IdCard }[] = [
  { key: "id_checked", label: "ID checked", icon: IdCard },
  { key: "licensed", label: "Licensed", icon: BadgeCheck },
  { key: "insured", label: "Insured", icon: ShieldCheck },
  { key: "permit", label: "Permit on file", icon: FileCheck2 },
  { key: "registered", label: "Registered business", icon: Landmark },
];

/** The badges a shop has earned (L47, L55, L56); each was checked by someone other than the owner. */
export function ShopBadgeList({ badges, compact = false }: { badges: ShopBadges | null | undefined; compact?: boolean }) {
  const earned = BADGES.filter((b) => badges?.[b.key]);
  if (earned.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Badges">
      {earned.map(({ key, label, icon: Icon }) => (
        <li
          key={key}
          className={`inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 text-foreground ${compact ? "px-2 py-0.5 text-ds-11" : "px-2.5 py-1 text-ds-11"}`}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** The owner's one star rating (G11), or "No reviews yet". */
export function ShopRating({ rating, count }: { rating: number | null; count: number }) {
  if (!count) return <span className="text-ds-11 text-muted-foreground">No reviews yet</span>;
  // Shops H9: the shop's rating shows only at 3 or more reviews (the server returns no average below that).
  if (rating == null) return <span className="text-ds-11 text-muted-foreground">Not rated yet ({count} {count === 1 ? "review" : "reviews"})</span>;
  return (
    <span className="inline-flex items-center gap-1 text-ds-11">
      <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden />
      <span className="font-semibold" aria-hidden>{Number(rating).toFixed(1)}</span>
      <span className="text-muted-foreground" aria-hidden>({count})</span>
      <span className="sr-only">{`Rated ${Number(rating).toFixed(1)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}</span>
    </span>
  );
}

/**
 * A plain-English block in place of a control the member cannot use yet.
 * Spec v2 palette (audit 2026-10-21): no amber box. Both tones are the one
 * card surface; "warn" keeps role="alert" and marks its title with the
 * --alert ink, the one colour the spec gives problems.
 */
export function ShopsNotice({ title, children, tone = "info" }: { title: string; children?: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className="rounded-[20px] border border-border bg-card p-4 text-ds-13 text-foreground"
    >
      <p className="font-semibold" style={tone === "warn" ? { color: "hsl(var(--alert-ink))" } : undefined}>{title}</p>
      {children && <div className="mt-1 text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * Renders Shops only when the hidden 'shops' switch is on for this member.
 * While the server's answer loads it renders the page's real AppPage header
 * (same title and back link) with a screen-reader status and no bones (the
 * Rentals/Quotes loading-frame pattern). A settled "off" is "Opens soon" in
 * the shared Browse empty state (Q2005: an old or shared link never lands on
 * a bare 404). Never the protection: every RPC refuses too.
 */
export function ShopsGate({ children, title, backTo, skeleton }: { children: ReactNode; title: string; backTo?: string; skeleton?: ReactNode }) {
  const enabled = useFeature("shops");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const settled = isReady && (!user || featureSwitchSettled(qc, "shops", user.id));
  if (settled) return <ShopsOpensSoon title={title} backTo={backTo} sectionRoot={!!skeleton} />;
  // A section's own root (/shops) passes its section frame: a sub-screen's AppPage draws a back arrow there.
  if (skeleton) return <>{skeleton}</>;
  return (
    <AppPage title={title} backTo={backTo}>
      <p className="sr-only" role="status">Loading</p>
    </AppPage>
  );
}

/** The words a member sees while Shops has not opened to them (Q2005). */
export const SHOPS_OPENS_SOON_BODY = "Local shops open here soon. Until then, hire help in Jobs or buy and sell in Declutter.";

/**
 * Q2005: Shops is still switched off for this member. The section's own root (/shops) keeps its section frame; a
 * sub-screen keeps its AppPage title and back link. Both show the one shared Browse empty state, in its one spot.
 */
function ShopsOpensSoon({ title, backTo, sectionRoot }: { title: string; backTo?: string; sectionRoot: boolean }) {
  const empty = (
    <BrowseEmptyState
      icon={Store}
      title="Coming soon" /* the menu's word, F139 (owner's UI audit 11-09) */
      body={SHOPS_OPENS_SOON_BODY}
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/home">Go to Dashboard</Link>
        </Button>
      }
    />
  );
  if (sectionRoot) {
    return (
      <SectionScreen section="shops" title="Shops" globalSearch={false} search={null} showAdd={false}>
        {empty}
      </SectionScreen>
    );
  }
  return (
    <AppPage title={title} backTo={backTo}>
      {empty}
    </AppPage>
  );
}

/**
 * One group of order cards under a Shops tab (owner, 2026-10-19): the
 * section-dashboard header (uppercase title + count) over the existing cards.
 */
export function OrderGroup({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="px-1 text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
        <span className="ml-1.5 text-foreground/70">{count}</span>
      </h2>
      {count === 0 ? <p className="px-1 text-ds-13 text-muted-foreground">{empty}</p> : <ul className="space-y-3">{children}</ul>}
    </section>
  );
}

/** The one title a shop link that leads nowhere wears (shops audit 11-10 F3). */
export const SHOP_UNAVAILABLE_TITLE = "This shop isn't taking orders right now.";

/**
 * A shop link that leads nowhere (paused, closed, no live item, never existed): the one
 * empty-state layout, not a warning box (spec v2 rebuild, audit 2026-10-21). Shops audit 11-10 F3 (lead): the
 * server's own "This shop isn't available." under a title that said the same is left out, and the way on is
 * "Browse shops" (a buyer or a signed-out visitor has no dashboard).
 */
export function ShopUnavailable({ body, title }: { body?: string; title?: string }) {
  const sameAsTitle = !body || body === SHOPS_ERROR_COPY.shop_not_found;
  return (
    <div className="flex" role="alert">
      <EmptyState
        variant="inline"
        icon={Store}
        title={title ?? SHOP_UNAVAILABLE_TITLE}
        body={sameAsTitle ? "Check back later, or find another local shop." : body}
        action={
          <Button asChild variant="primary" size="lg" className="rounded-full px-8">
            <Link to="/shops">Browse shops</Link>
          </Button>
        }
      />
    </div>
  );
}
