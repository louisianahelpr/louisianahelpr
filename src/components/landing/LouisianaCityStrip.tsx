/**
 * LouisianaCityStrip — a slim, decorative marquee of Louisiana city names
 * that flows on the parchment beneath the hero. Same seamless
 * translate(0 → -50%) loop pattern as `CategoryBento`, but text-only,
 * smaller, and much slower (~120 s / lap) so it reads as ambient signage
 * rather than motion that competes with the hero.
 *
 * Not a control — there's no click affordance and no button semantics. The
 * whole surface is `aria-hidden` because the eyebrow above ("Serving all
 * of Louisiana") already carries the meaning; naming twelve cities to a
 * screen reader would be noise.
 *
 * Fleur-de-lis (⚜) separates each city name — a distinctly Louisiana
 * dot-leader that echoes the watermark in the hero above.
 */

const CITIES = [
  "New Orleans",
  "Baton Rouge",
  "Lafayette",
  "Shreveport",
  "Lake Charles",
  "Metairie",
  "Kenner",
  "Bossier City",
  "Monroe",
  "Alexandria",
  "Houma",
  "Slidell",
];

const LouisianaCityStrip = () => {
  // Duplicate the list so the CSS translate(0 → -50%) creates a seamless
  // loop — the second copy reaches the viewport at exactly the moment the
  // first copy exits.
  const loop = [...CITIES, ...CITIES];

  return (
    <section className="w-full py-6 sm:py-8" aria-hidden="true">
      <p className="text-display-eyebrow text-center mb-3 sm:mb-4">
        Serving all of Louisiana
      </p>
      <div className="city-strip-marquee-container overflow-hidden">
        <div className="city-strip-marquee flex items-center gap-6 sm:gap-8">
          {loop.map((city, i) => (
            <span
              key={`${city}-${i}`}
              className="font-serif italic text-ds-13 sm:text-ds-15 whitespace-nowrap shrink-0 flex items-center gap-6 sm:gap-8"
              style={{ color: "hsl(var(--olivewood) / 0.5)" }}
            >
              {city}
              <span
                aria-hidden="true"
                className="not-italic text-ds-13 sm:text-ds-15"
                style={{ color: "hsl(var(--burnt-sienna) / 0.55)" }}
              >
                ⚜
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LouisianaCityStrip;
