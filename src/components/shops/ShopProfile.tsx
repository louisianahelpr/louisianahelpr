/**
 * The shop page's look (SH2/SH12, owner 2026-10-19: "Shops looks very basic
 * and generic"): a cover hero with the logo, name, category, area, rating
 * (hidden when there is none), badges, then clean cards for about, items,
 * hours (open now / closed) and parishes. Presentational only: the signed-in
 * ShopView and the signed-out PublicShopView both render these, so the two
 * never drift apart.
 */
import type { ReactNode } from "react";
import { Clock, House, MapPin, ShoppingBag, Store } from "lucide-react";
import { shopPhotoUrl, type ShopBadges, type ShopHour, type ShopPhotoKind } from "@/lib/shops/api";
import { formatItemPrice, HOME_KITCHEN_CARD_LINE, HOME_KITCHEN_NOTICE, itemPhotoUrl, readinessLabel, SHOP_ITEM_TYPE_LABEL, type ShopItem } from "@/lib/shops/items";
import { publicPhotoUrl } from "@/lib/shops/publicShop";
import { ShopBadgeList, ShopRating, WEEKDAYS } from "./shopsUi";

/** A member's read carries storage paths; the public read carries ids only (publicPhotoUrl). */
type Photo = { id: string; kind: ShopPhotoKind; storage_path?: string };
type ItemPhoto = { id: string; storage_path?: string };

function shopSrc(p: Photo, width: number): string {
  return p.storage_path ? shopPhotoUrl(p.storage_path) : publicPhotoUrl(p.id, "shop", width);
}
function itemSrc(p: ItemPhoto): string {
  return p.storage_path ? itemPhotoUrl(p.storage_path) : publicPhotoUrl(p.id, "item", 320);
}

function fmtTime(t: string): string {
  const [hh, mm] = t.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

function hoursText(h: { opens: string; closes: string }): string {
  return `${fmtTime(h.opens)} to ${fmtTime(h.closes)}`;
}

/** Weekday (0 = Sunday) and HH:MM in Louisiana, whatever the device's zone. */
function louisianaNow(now: Date): { weekday: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hhmm: `${get("hour")}:${get("minute")}` };
}

/** "Open now · until 5 PM", "Closed · opens Tuesday 9 AM", or null when the shop set no hours. */
function openStatus(hours: ShopHour[], now: Date = new Date()): { open: boolean; label: string } | null {
  if (hours.length === 0) return null;
  const { weekday, hhmm } = louisianaNow(now);
  const current = hours.find((h) => h.weekday === weekday && h.opens <= hhmm && hhmm < h.closes);
  if (current) return { open: true, label: `Open now · until ${fmtTime(current.closes)}` };
  for (let d = 0; d < 7; d++) {
    const day = (weekday + d) % 7;
    const next = hours
      .filter((h) => h.weekday === day && (d > 0 || h.opens > hhmm))
      .sort((a, b) => a.opens.localeCompare(b.opens))[0];
    if (next) {
      const when = d === 0 ? "today" : d === 1 ? "tomorrow" : WEEKDAYS[day];
      return { open: false, label: `Closed · opens ${when} ${fmtTime(next.opens)}` };
    }
  }
  return { open: false, label: "Closed" };
}

function OpenNowPill({ hours }: { hours: ShopHour[] }) {
  const s = openStatus(hours);
  if (!s) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        s.open ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-muted text-muted-foreground"
      }`}
      data-testid="shop-open-status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.open ? "bg-emerald-600 dark:bg-emerald-300" : "bg-muted-foreground"}`} aria-hidden />
      {s.label}
    </span>
  );
}

/** One titled card. Titles are upright Montserrat (the app's sans), never the display face. */
export function ShopCard({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby={id}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={id} className="font-sans text-base font-bold not-italic text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ShopHero(props: {
  name: string;
  categoryLabel: string;
  areaLabel: string;
  storefront: boolean;
  photos: Photo[];
  /** Members only: the public page omits the owner's person rating (it would fingerprint the owner). */
  rating?: number | null;
  reviewCount?: number;
  badges: ShopBadges | null | undefined;
  hours: ShopHour[];
  actions?: ReactNode;
  /** A small round control over the cover's top-right corner (the public page's Share, Airbnb-style). */
  coverAction?: ReactNode;
}) {
  const cover = props.photos.find((p) => p.kind === "cover");
  const logo = props.photos.find((p) => p.kind === "logo");
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative h-40 w-full bg-gradient-to-br from-primary/25 via-muted to-accent/25">
        {cover ? <img src={shopSrc(cover, 1200)} alt="" className="h-full w-full object-cover" /> : null}
        {props.coverAction ? <div className="absolute right-3 top-3">{props.coverAction}</div> : null}
      </div>
      <div className="relative px-4 pb-4">
        <div className="-mt-10 mb-2 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-card bg-muted shadow-md">
          {logo ? (
            <img src={shopSrc(logo, 160)} alt={`${props.name} logo`} className="h-full w-full object-cover" />
          ) : (
            <Store className="h-8 w-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <p className="font-sans text-xl font-bold not-italic leading-tight text-foreground [overflow-wrap:anywhere]" data-testid="shop-hero-name">
          {props.name}
        </p>
        <p className="mt-0.5 text-sm font-medium text-primary">{props.categoryLabel}</p>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{props.areaLabel}{props.storefront ? " · Storefront" : ""}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OpenNowPill hours={props.hours} />
          {(props.reviewCount ?? 0) > 0 && props.rating != null ? <ShopRating rating={props.rating} count={props.reviewCount ?? 0} /> : null}
        </div>
        <div className="mt-3">
          <ShopBadgeList badges={props.badges} />
        </div>
        {props.actions ? <div className="mt-4 flex flex-wrap gap-2">{props.actions}</div> : null}
      </div>
    </div>
  );
}

export function ShopHoursCard({ hours }: { hours: ShopHour[] }) {
  if (hours.length === 0) return null;
  const today = louisianaNow(new Date()).weekday;
  return (
    <ShopCard id="shop-hours" title="Hours" action={<Clock className="h-4 w-4 text-muted-foreground" aria-hidden />}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {WEEKDAYS.map((day, i) => {
          const slots = hours.filter((h) => h.weekday === i);
          const isToday = i === today;
          return (
            <div key={day} className="contents">
              <dt className={isToday ? "font-semibold text-foreground" : "text-muted-foreground"}>{day}</dt>
              <dd className={`text-right ${isToday ? "font-semibold" : ""}`}>{slots.length ? slots.map(hoursText).join(", ") : "Closed"}</dd>
            </div>
          );
        })}
      </dl>
    </ShopCard>
  );
}

export function ShopItemsGrid({ items }: { items: (Omit<ShopItem, "photos"> & { photos: ItemPhoto[] })[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No items listed yet.</p>;
  const anyHomeKitchen = items.some((i) => i.home_kitchen);
  return (
    <>
      {anyHomeKitchen && (
        // L7 (R.S. 40:4.9 D(1)): the full statement once, above the grid.
        <p className="mb-3 flex gap-1.5 text-ds-12 leading-snug text-muted-foreground" data-testid="home-kitchen-statement">
          <House className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Items marked home kitchen: {HOME_KITCHEN_NOTICE.charAt(0).toLowerCase() + HOME_KITCHEN_NOTICE.slice(1)}</span>
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3">
        {items.map((item) => {
          const cover = item.photos[0];
          return (
            <li key={item.id} className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="flex aspect-square w-full items-center justify-center bg-muted">
                {cover ? (
                  <img src={itemSrc(cover)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <ShoppingBag className="h-8 w-8 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="space-y-0.5 p-2.5">
                <p className="line-clamp-2 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{item.title}</p>
                <p className="text-sm font-bold text-foreground">{formatItemPrice(item.price_cents)}</p>
                <p className="text-ds-11 text-muted-foreground">{SHOP_ITEM_TYPE_LABEL[item.subtype] ?? "Item"} · {readinessLabel(item)}</p>
                {item.home_kitchen && (
                  // L7 on EVERY home-food card, as one compact line; the full words for screen readers.
                  <p className="flex items-center gap-0.5 text-ds-10 tracking-normal text-muted-foreground" data-testid="home-kitchen-notice">
                    <House className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate" aria-hidden>{HOME_KITCHEN_CARD_LINE}</span>
                    <span className="sr-only">{HOME_KITCHEN_NOTICE}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function ShopGallery({ photos }: { photos: Photo[] }) {
  const gallery = photos.filter((p) => p.kind === "gallery");
  if (gallery.length === 0) return null;
  return (
    <ShopCard id="shop-photos" title="Photos">
      <ul className="grid grid-cols-3 gap-2">
        {gallery.map((p) => (
          <li key={p.id} className="aspect-square overflow-hidden rounded-xl bg-muted">
            <img src={shopSrc(p, 320)} alt="" loading="lazy" className="h-full w-full object-cover" />
          </li>
        ))}
      </ul>
    </ShopCard>
  );
}
