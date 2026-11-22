import { Link } from "react-router-dom";
import { ArrowRight, Gift } from "lucide-react";
import { useGuestSpanish } from "./useGuestSpanish";

/**
 * The landing's way to the Holiday gift guides (owner 2026-11-16: "add this to our landing pages on louisiana helpr so
 * people can see our gift guides"). One light card under the section cards, well below the first screen: text and an
 * icon only (no image, no data read), so the first screen is untouched. English drawn here, Spanish through
 * useGuestSpanish like the rest of the landing; enLanding.ts mirrors the English (landingInSpanish.test.tsx).
 * Guard: src/test/giftGuidesPage.test.tsx.
 */
export const GIFT_GUIDES_PATH = "/gift-guides";

export function GiftGuidesBand() {
  const es = useGuestSpanish();
  const w = (key: string, english: string) => es?.[key] ?? english;
  return (
    <section aria-labelledby="gift-guides-heading" className="px-5 sm:px-8 lg:px-12 pb-12 sm:pb-14 lg:pb-16" style={{ background: "var(--lp-ground)" }}>
      <div className="mx-auto w-full max-w-6xl">
        <div className="landing-card relative flex flex-col gap-3 p-6 lg:p-8 sm:flex-row sm:items-center sm:justify-between sm:gap-6" style={{ color: "var(--lp-ink)" }} data-testid="landing-gift-guides">
          <div className="flex items-start gap-4 min-w-0">
            <Gift className="w-6 h-6 shrink-0 mt-1" aria-hidden style={{ color: "var(--lp-action-strong)" }} />
            <div className="min-w-0 space-y-1">
              <h2 id="gift-guides-heading" className="font-display landing-serif text-ds-24 sm:text-ds-28">
                {w("landing.giftGuides.title", "Holiday gift guides")}
              </h2>
              <p className="text-ds-15 leading-relaxed" style={{ color: "var(--lp-body)" }}>
                {w("landing.giftGuides.body", "Gift ideas for her, for him and for the kids.")}
              </p>
            </div>
          </div>
          <Link
            to={GIFT_GUIDES_PATH}
            className="self-start sm:self-center shrink-0 inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold after:absolute after:inset-0 after:rounded-[inherit]"
            style={{ color: "var(--lp-action-strong)" }}
            data-testid="landing-gift-guides-link"
          >
            {w("landing.giftGuides.cta", "See the gift guides")}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
