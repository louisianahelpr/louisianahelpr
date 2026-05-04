/**
 * Editorial pull quote — single italic testimonial centered on the parchment,
 * no card chrome, generous whitespace. Print-era flourish that breaks the
 * page rhythm with a human voice. Sits between HowItWorksSection and
 * PublicJobsPreview.
 */
const PullQuote = () => (
  <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-24 lg:py-32">
    <div className="container mx-auto max-w-3xl text-center observe-fade-up">
      {/* Decorative ornament — three faint dots in Burnt Sienna, a print-
          era flourish that signals "pull quote" without the literal "" marks. */}
      <div className="flex justify-center gap-1.5 mb-6">
        <span
          className="w-1 h-1 rounded-full"
          style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.5)" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.7)" }}
        />
        <span
          className="w-1 h-1 rounded-full"
          style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.5)" }}
        />
      </div>

      <blockquote className="editorial-quote">
        &ldquo;I&rsquo;m not usually one for new apps, but this was actually easy.
        It&rsquo;s rare to find something that feels{" "}
        <em
          style={{
            fontStyle: "normal",
            color: "hsl(var(--burnt-sienna))",
            fontWeight: 500,
          }}
        >
          this calm and straightforward
        </em>
        . I just typed in what I needed and the rest fell into place without any
        of the usual back-and-forth headache.&rdquo;
      </blockquote>

      {/* Attribution — Beth Ellen signature + small-caps location eyebrow */}
      <div className="mt-8 sm:mt-10 flex flex-col items-center gap-2">
        <span
          className="signature"
          style={{
            color: "hsl(var(--bark))",
            fontSize: "1.75rem",
            lineHeight: 1,
          }}
        >
          Camille R.
        </span>
        <span className="text-display-eyebrow" style={{ fontSize: "0.65rem" }}>
          Mid-City
        </span>
      </div>

      {/* Social proof — overlapping avatar circles + "+127 others" microtype.
          Initials only, no real photos, restraint-compatible. Each avatar
          uses a different brand-palette tint so the row reads as a
          designed unit rather than a generic stock image. */}
      <div className="mt-8 sm:mt-10 flex items-center justify-center gap-3">
        <div className="flex -space-x-2">
          {[
            { initials: "CR", bg: "hsl(var(--sage))" },
            { initials: "MB", bg: "hsl(var(--burnt-sienna))" },
            { initials: "TM", bg: "hsl(var(--olive))" },
            { initials: "JD", bg: "hsl(var(--bark))" },
          ].map((avatar) => (
            <div
              key={avatar.initials}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-sans font-semibold"
              style={{
                backgroundColor: avatar.bg,
                color: "hsl(var(--parchment))",
                border: "2px solid hsl(var(--parchment))",
              }}
              aria-hidden
            >
              {avatar.initials}
            </div>
          ))}
        </div>
        <span
          className="font-serif italic text-sm sm:text-base"
          style={{ color: "hsl(var(--stormy-sky))" }}
        >
          + 127 neighbors
        </span>
      </div>
    </div>
  </section>
);

export default PullQuote;
