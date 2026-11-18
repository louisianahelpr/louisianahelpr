/**
 * "For sale near you" on a new member's Home (owner 11-14: Home leads with real things near them, not an empty
 * "Nothing booked yet"). Real live Declutter listings with a photo, not the member's own, nearest first from the
 * position Home already knows (getCachedUserLocation, no device prompt), never from someone either side of a block, in a row that scrolls sideways; a tile opens
 * the item. Nothing near (or a failed read): the strip is not drawn and Home's big actions stand alone.
 *
 * Loaded on its own (HomeDashboard -> NewMemberHome lazy()), never with Home's first screen. Its tile is a small one
 * of its own (photo, price, title, area), not Declutter's ItemCard: the card's category icons, reached from a new
 * chunk, regrouped the shared icon chunks and every route's first load grew past its budget (/admin, /profile,
 * /declutter/item; scripts/perf/critical-path-budget.json, measured 2026-11-14). Every listing has a photo (posting
 * requires one), so the strip shows only listings whose photo is known.
 * Guard: src/test/newMemberHome1114.test.tsx.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { readItems } from "@/lib/declutter/myReads";
import { fetchPhotos, photoCardUrl, type DeclutterItem } from "@/lib/declutter/api";
import { formatPrice, nearestFirst } from "@/lib/declutter/distance";
import { getCachedUserLocation } from "@/hooks/useUserLocation";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { PRICE_PAID } from "@/components/ui/designScale";
import "@/lib/i18n/enHome";
import "@/lib/i18n/enNewMember";
import { useLanguage } from "@/lib/i18n/language";

/** Read this many of the newest listings, then show the nearest few. */
const READ = 40;
const FOR_SALE_SHOWN = 8;

/** The first photo of each item, by item id. */
function coverPhotos(photos: { item_id: string; storage_path: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of photos) if (!out.has(p.item_id)) out.set(p.item_id, p.storage_path);
  return out;
}

function ForSaleTile({ item, photoPath }: { item: DeclutterItem; photoPath: string }) {
  const { t } = useLanguage();
  // A photo that fails to load drops out; the tile's own tint stays under the price and title.
  const [failed, setFailed] = useState(false);
  return (
    <Link to={`/declutter/item/${item.id}`} data-for-sale-tile="" className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-photo-empty">
        {!failed && (
          <img loading="lazy" decoding="async" src={photoCardUrl(photoPath)} alt={item.title} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        )}
      </span>
      <span className={`mt-1.5 block text-ds-15 ${PRICE_PAID}`}>{item.current_price_cents === 0 ? t("home.ns.free") : formatPrice(item.current_price_cents)}</span>
      <span className="block truncate text-ds-13 text-foreground" title={item.title}>{item.title}</span>
      {item.area_label && <span className="block truncate text-ds-12 text-muted-foreground" title={item.area_label}>{item.area_label}</span>}
    </Link>
  );
}

/** `max`: how many tiles to draw (Home's quiet-day "Near you" shows 4; the read and its cache are the same). */
export default function ForSaleNearYou({ userId, max = FOR_SALE_SHOWN }: { userId: string | undefined; max?: number }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const loc = getCachedUserLocation();
  const near = useQuery({
    queryKey: ["home", "for-sale-near-you", userId, loc?.lat ?? null, loc?.lng ?? null],
    enabled: !!userId,
    queryFn: async () => {
      const rows = (await readItems((cols) =>
        supabase
          .from("declutter_items")
          .select(cols)
          .eq("status", "live")
          .neq("seller_id", userId!)
          .order("live_at", { ascending: false })
          .limit(READ),
      )) as DeclutterItem[] | null;
      // Never a listing from someone either side of a block (review finding 4). The read fails closed: getBlockedUserIds
      // throws on an error, the query fails, and the strip is not drawn.
      const blocked = await getBlockedUserIds(userId!);
      const open = (rows ?? []).filter((r) => !blocked.has(r.seller_id));
      const ordered = nearestFirst(open, loc ? { lat: loc.lat, lng: loc.lng } : null, null);
      const cover = coverPhotos(await fetchPhotos(ordered.map((s) => s.item.id)));
      const shown = ordered.filter((s) => cover.has(s.item.id)).slice(0, FOR_SALE_SHOWN);
      return { shown, cover };
    },
  });
  const shown = (near.data?.shown ?? []).slice(0, max);
  if (shown.length === 0) return null;
  return (
    <section aria-label={t("home.ns.forSale")} data-home-for-sale="" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.ns.forSale")}</h2>
        <Button type="button" variant="link" size="sm" onClick={() => navigate("/declutter")} className="px-1 -my-2 text-ds-13 font-bold text-primary">{t("home.ns.seeAll")}</Button>
      </div>
      <ul className="flex gap-3 overflow-x-auto snap-x pb-1 [scrollbar-width:none]">
        {shown.map(({ item }) => (
          <li key={item.id} className="w-[148px] shrink-0 snap-start lg:w-[176px]">
            <ForSaleTile item={item} photoPath={near.data!.cover.get(item.id)!} />
          </li>
        ))}
      </ul>
    </section>
  );
}
