/**
 * Shops: shared words and small pieces for the three screens
 * (docs/specs/local-shops-prep.md; migration 20261015123029_shops_profiles).
 * Plain words only: no codes reach the member.
 */
import { BadgeCheck, FileCheck2, IdCard, Landmark, ShieldCheck, Star } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import AppPage from "@/components/AppPage";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import NotFound from "@/pages/info/NotFound";
import { fetchShopCategories, type ShopBadges, type ShopCategory } from "@/lib/shops/api";

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
          className={`inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 text-foreground ${compact ? "px-2 py-0.5 text-ds-11" : "px-2.5 py-1 text-xs"}`}
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
  if (!count || rating == null) return <span className="text-xs text-muted-foreground">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden />
      <span className="font-semibold" aria-hidden>{Number(rating).toFixed(1)}</span>
      <span className="text-muted-foreground" aria-hidden>({count})</span>
      <span className="sr-only">{`Rated ${Number(rating).toFixed(1)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}</span>
    </span>
  );
}

/** A plain-English block in place of a control the member cannot use yet. */
export function ShopsNotice({ title, children, tone = "info" }: { title: string; children?: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`rounded-2xl border p-4 text-sm ${tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" : "border-border bg-card text-foreground"}`}
    >
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * Renders Shops only when the hidden 'shops' switch is on for this member.
 * While the server's answer loads it renders the page's real AppPage header
 * (same title and back link) with a screen-reader status and no bones (the
 * Rentals/Quotes loading-frame pattern); a settled "off" is the 404, exactly
 * as if the route did not exist. Never the protection: every RPC refuses too.
 */
export function ShopsGate({ children, title, backTo }: { children: ReactNode; title: string; backTo?: string }) {
  const enabled = useFeature("shops");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const state = qc.getQueryState(["feature-enabled", "shops", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  if (settled) return <NotFound />;
  return (
    <AppPage title={title} backTo={backTo}>
      <p className="sr-only" role="status">Loading</p>
    </AppPage>
  );
}
