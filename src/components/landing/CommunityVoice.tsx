import { Star } from "lucide-react";

/**
 * CommunityVoice — proof section: 3-testimonial rich-card rail. FAQ was
 * moved off the landing page as part of the "simple modern reset" pass.
 * Users looking for FAQ content can find it in the Help Center.
 */

type Testimonial = {
  quote: string;
  name: string;
  location: string;
  initials: string;
};

const testimonials: Testimonial[] = [
  {
    quote:
      "Made $340 last weekend helping with moves. Easy money — I set my own schedule and Helpr handles the rest.",
    name: "Darius J.",
    location: "Baton Rouge, LA",
    initials: "DJ",
  },
  {
    quote:
      "I typed in what I needed. Three Helprs applied within the hour, and I picked one. That was it.",
    name: "Camille R.",
    location: "New Orleans (Mid-City), LA",
    initials: "CR",
  },
  {
    quote:
      "I've been on this app since day one. Escrow means I never have to chase a payment — funds hit my account before I get home.",
    name: "Marcus T.",
    location: "Lafayette, LA",
    initials: "MT",
  },
];

const CommunityVoice = () => {
  return (
    <section className="px-5 sm:px-8 lg:px-12 pt-8 sm:pt-12 lg:pt-16 pb-16 sm:pb-24 lg:pb-32">
      <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
        {/* Proof-anchor — gives the testimonial + FAQ block a claimed identity
            ("this is our proof section") so the pull quote doesn't read as a
            floating lone-column moment against a big blank right rail. */}
        <div className="text-center mb-10 sm:mb-14 observe-fade-up">
          <span className="text-display-eyebrow">Loved by neighbors</span>
          <h2 className="text-display-xl mt-4 text-balance">
            Louisiana&rsquo;s trusted for a reason.
          </h2>
        </div>

        {/* 3-testimonial rich-card rail. On mobile stacks vertically; on md+
            it's a 3-col grid. Each card is a self-contained proof unit:
            avatar + 5-star rating + italic serif quote + attribution. */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 observe-fade-up"
          role="list"
        >
          {testimonials.map((t, i) => (
            <article
              key={t.name}
              role="listitem"
              className="p-6 sm:p-8 flex flex-col observe-fade-up border border-[hsl(var(--olivewood)/0.12)] rounded-2xl bg-white"
              style={{ transitionDelay: `${100 + i * 80}ms` }}
            >
              {/* Avatar + attribution header */}
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center font-sans font-semibold text-ds-15 shrink-0"
                  style={{
                    backgroundColor: "hsl(var(--burnt-sienna) / 0.15)",
                    color: "hsl(var(--burnt-sienna))",
                  }}
                  aria-hidden
                >
                  {t.initials}
                </div>
                <div className="min-w-0">
                  <div
                    className="font-display font-bold italic text-ds-15 sm:text-ds-17 leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {t.name}
                  </div>
                  <div
                    className="font-sans text-ds-11 sm:text-ds-13 mt-0.5 truncate"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    — {t.location}
                  </div>
                </div>
              </div>

              {/* 5-star rating row */}
              <div
                className="flex items-center gap-0.5 mt-4"
                aria-label="5 out of 5 stars"
              >
                {[0, 1, 2, 3, 4].map((s) => (
                  <Star
                    key={s}
                    className="w-4 h-4"
                    style={{ color: "hsl(var(--gold-warm))" }}
                    fill="currentColor"
                    strokeWidth={0}
                    aria-hidden
                  />
                ))}
              </div>

              {/* Quote — italic serif, generous line-height, flex-1 so cards
                  align at the bottom regardless of quote length. */}
              <blockquote
                className="mt-4 font-serif italic text-ds-15 sm:text-ds-17 leading-relaxed flex-1"
                style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
              >
                &ldquo;{t.quote}&rdquo;
              </blockquote>
            </article>
          ))}
        </div>

        {/* Stat strip — thin proof line under the cards. Uses the same
            eyebrow-treatment as the anchor above so it reads as a caption
            to the trio, not a competing headline. */}
        <div
          className="mt-8 sm:mt-10 text-center observe-fade-up"
          style={{ transitionDelay: "340ms" }}
        >
          <span
            className="font-serif italic text-ds-13 sm:text-ds-15"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span style={{ color: "hsl(var(--gold-warm))" }} aria-hidden>
              ★
            </span>{" "}
            4.9 average · 340+ jobs completed · Serving 12+ Louisiana cities
          </span>
        </div>

      </div>
    </section>
  );
};

export default CommunityVoice;
