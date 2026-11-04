import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { FRESH_DECLUTTER_LIMIT, type FreshItem } from "./FreshDeclutterSection";

/**
 * The "Fresh on Declutter" strip's markup (FreshDeclutterSection.tsx has the read and the rules). Its own chunk,
 * fetched with the listings, so the landing's page chunk carries only the loader.
 */
function SeeEverything({ className }: { className: string }) {
  return (
    <Link to="/declutter" className={`group items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard ${className}`} style={{ color: "var(--lp-action-strong)" }}>
      See everything
      <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

export function FreshDeclutterFailed() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 pb-12 lg:pb-20" style={{ background: "var(--lp-surface)" }}>
      <div className="mx-auto w-full max-w-6xl flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-fresh-declutter-failed">
          We couldn’t load the newest Declutter listings just now.
        </p>
        <SeeEverything className="inline-flex" />
      </div>
    </section>
  );
}

/** The strip itself: at most 4 cards on a phone (two rows of two), all 6 from lg. */
export default function FreshDeclutterStrip({ items }: { items: FreshItem[] }) {
  return (
    <section
      data-testid="landing-fresh-declutter"
      aria-labelledby="landing-fresh-declutter-title"
      className="px-5 sm:px-8 lg:px-12 pb-12 lg:pb-20"
      style={{ background: "var(--lp-surface)" }}
    >
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="landing-fresh-declutter-title" className="font-display landing-serif leading-[1.05] text-ds-28" style={{ color: "var(--lp-ink)" }}>
            Fresh on Declutter
          </h2>
          <SeeEverything className="hidden sm:inline-flex" />
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-5" data-testid="landing-fresh-declutter-list">
          {items.slice(0, FRESH_DECLUTTER_LIMIT).map((it, i) => (
            <li key={it.id} className={i >= 4 ? "hidden sm:block" : undefined}>
              <Link
                to={`/declutter/item/${encodeURIComponent(it.id)}`}
                className="h-full rounded-2xl overflow-hidden flex flex-col"
                style={{ background: "var(--lp-ground)", color: "var(--lp-ink)" }}
              >
                <span className="block aspect-square w-full" style={{ background: "var(--lp-subtle)" }}>
                  {it.photo && (
                    <img
                      src={it.photo}
                      alt=""
                      width={240}
                      height={240}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (it.photoFull && img.src !== it.photoFull) img.src = it.photoFull;
                      }}
                    />
                  )}
                </span>
                <span className="flex flex-col gap-0.5 p-3 min-w-0">
                  <span className="text-ds-16 font-bold">{itemPriceLabel(it.current_price_cents)}</span>
                  <span className="text-ds-14 font-semibold line-clamp-2 break-words" title={it.title}>{it.title}</span>
                  {it.area_label && (
                    <span className="text-ds-13 truncate" title={it.area_label} style={{ color: "var(--lp-body)" }}>{it.area_label}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <SeeEverything className="sm:hidden self-center inline-flex" />
      </div>
    </section>
  );
}
