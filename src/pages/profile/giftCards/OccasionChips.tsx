/** The gift card form's Occasion chips (moved out of GiftCard.tsx, Q806; markup unchanged). */
import { GIFT_OCCASIONS } from "./giftCardDesigns";

export function OccasionChips({ occasionId, setOccasionId }: { occasionId: string; setOccasionId: (id: string) => void }) {
  return (
    <>
          {/* Occasion — picking one swaps the card design and the note
              placeholder, so the choice does real work rather than just
              tagging the gift.

              WRAPS at every width. It used to be a masked scroll-rail
              below `sm`, un-scrollbarred, with the fade its only "there's
              more" hint — on a 320/375 phone that clipped a chip mid-word
              at the right edge and hid up to three of the six occasions
              behind a gesture nothing announced. The desktop half of this
              component already argued the case ("a hidden one is hidden
              product") and wrapped from `sm` up; the argument holds on a
              phone too, and six short labels cost two or three rows. The
              rail, the mask and the negative gutter go together. */}
          <div>
            <p
              id="gift-occasion-label"
              className="font-sans text-ds-12 mb-2"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Occasion
            </p>
            <div role="group" aria-labelledby="gift-occasion-label" className="flex flex-wrap gap-2">
              {GIFT_OCCASIONS.map((o) => {
                const active = o.id === occasionId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setOccasionId(o.id)}
                    // SELECTED = GLOSSY. `btn-grad-primary` is the app's one
                    // primary surface; this chip painted a flat 15%-bark
                    // tint, the same rule break the review tags and the
                    // withdraw-reason rows already had fixed. The active
                    // `style` sets COLOR ONLY — a `background` shorthand
                    // here would wipe the class's background-image.
                    // px-3 is the app's chip padding (ReviewForm's quick
                    // tags, the filter pills). It also buys a row back at
                    // 320: with px-4 only "Congratulations" and
                    // "Just because" fit alone, giving five rows.
                    className={`min-h-11 px-3 rounded-ds-pill text-ds-12 font-sans font-semibold transition-all duration-150 ease-ds-spring active:scale-[0.97] ${
                      active
                        ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                        : ""
                    }`}
                    style={
                      active
                        ? { color: "hsl(var(--parchment))" }
                        : {
                            background: "var(--surface-premium)",
                            border: "1px solid hsl(var(--bark) / 0.18)",
                            color: "hsl(var(--bark))",
                          }
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
    </>
  );
}
