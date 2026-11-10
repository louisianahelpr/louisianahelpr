import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useFreshItems, type FreshItem } from "./FreshDeclutterSection";

/**
 * The photo band right under the hero (Direction A, "Porch and Parish", owner 11-10; D004: the page had ONE photo, a
 * 72px thumb). Three tiles of real local work and stock:
 *   1. a finished job: the owner's own photo of job 7c6deb77 "Mow two lawns" in Iberia, completed with a 5-star review
 *      and a $20 tip (checked on prod 2026-10-23; owner: "you can use this on the job picture"). A dated record, not a
 *      live count: replace it with the next real one;
 *   2. a porch-pickup item: the cover photo of a live Declutter listing from the same popular read the grid below
 *      makes (useFreshItems, one shared request), porch pickup first; the listing's town, never the seller's name;
 *   3. the neighbors: member photos and first names need each member's OK (owner 11-10) and there is no consent record
 *      yet, so this tile is words, not a face, until consents exist.
 * Nothing here joins the first paint: tile 1 is a small lazy local image and tile 2 waits for the page to load (the
 * read's own rule); every tile has a fixed box, so nothing moves when a photo lands.
 */
/**
 * The finished-job photo. It is 320x427 today, a little soft in a 1440 tile; the owner will send a bigger one (11-10).
 * The swap is ONE file: replace public/landing/new-iberia-yard.jpg under the same name (800px wide or more is plenty).
 * The tile's box is fixed by CSS (TILE, object-cover), so a photo of another size or shape moves nothing.
 */
export const FINISHED_JOB_PHOTO = "/landing/new-iberia-yard.jpg";
const TILE = "relative h-[140px] sm:h-[200px] lg:h-[260px] overflow-hidden rounded-xl";

/**
 * The item for tile 2: a porch-pickup item with a photo, else any item with a photo, taken from the END of the popular
 * list, so it is not the same item as the first card in the grid right under the band.
 */
export function porchTileItem(items: FreshItem[]): FreshItem | null {
  const withPhoto = items.filter((i) => i.photo).reverse();
  return withPhoto.find((i) => i.porch_ok) ?? withPhoto[0] ?? null;
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <span
      className="absolute inset-x-0 bottom-0 px-2.5 sm:px-3 pb-2 pt-6 text-ds-13 font-semibold leading-snug text-white"
      style={{ background: "linear-gradient(to top, rgba(28, 26, 23, 0.72), rgba(28, 26, 23, 0))" }}
    >
      {children}
    </span>
  );
}

export function LandingPhotoBand() {
  const ref = useRef<HTMLElement>(null);
  const items = useFreshItems(ref);
  const item = items.kind === "ok" ? porchTileItem(items.items) : null;
  return (
    <section ref={ref} aria-label="Real jobs and things for sale near you" data-testid="landing-photo-band" className="px-5 sm:px-8 lg:px-12 pb-2" style={{ background: "var(--lp-surface)" }}>
      <ul className="mx-auto w-full max-w-6xl grid grid-cols-3 gap-2 lg:gap-3 pt-5 lg:pt-8">
        <li className={TILE} data-tile="finished-job">
          <img src={FINISHED_JOB_PHOTO} alt="Two freshly mowed yards in New Iberia" loading="lazy" decoding="async" width={320} height={427} className="h-full w-full object-cover" />
          <Caption>
            Yard work<span className="hidden sm:inline">, New Iberia</span>
            <span className="block font-normal">
              <span role="img" aria-label="5 stars">★★★★★</span>
              <span className="hidden sm:inline"> and a $20 tip</span>
            </span>
          </Caption>
        </li>
        <li className={`${TILE} bg-photo-empty`} data-tile="porch-item">
          {item && (
            <Link to={`/declutter/item/${encodeURIComponent(item.id)}`} className="block h-full w-full">
              <img src={item.photo!} alt="" loading="lazy" decoding="async" width={640} height={800} className="h-full w-full object-cover" />
              <Caption>
                {item.porch_ok ? "Porch pickup" : "For sale"}
                {item.area_label && <span className="hidden sm:block font-normal">{item.area_label}</span>}
              </Caption>
            </Link>
          )}
        </li>
        <li className={`${TILE} flex items-end p-3 lg:p-5`} data-tile="neighbors" style={{ background: "var(--lp-band)" }}>
          <span className="landing-serif-text text-ds-15 sm:text-ds-20 lg:text-ds-28 leading-tight break-words min-w-0" style={{ color: "var(--lp-band-ink)" }}>
            Neighbors helping neighbors
          </span>
        </li>
      </ul>
    </section>
  );
}
