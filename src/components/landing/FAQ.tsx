/**
 * FAQ — addresses the four questions a Louisiana neighbor actually has
 * before posting a job: trust, recourse, cost, response time.
 *
 * Uses native <details>/<summary> for collapse/expand (zero JS, accessible
 * by default). Styled via .faq-item / .faq-answer in index.css. Sits above
 * the closing CTA and footer.
 */

const faqs = [
  {
    q: "How do I know my helper is trustworthy?",
    a: "Every helper goes through identity verification and a brief background check before they can apply. You also see ratings, reviews, and how many jobs they've completed for other Louisiana neighbors before you choose.",
  },
  {
    q: "What if the job isn't done right?",
    a: "Payment is held in escrow until you confirm the work. If something's off, message your helper directly through the app or open a dispute and our team helps settle it — no awkward Venmo standoffs.",
  },
  {
    q: "How much does Helpr cost?",
    a: "Posting a job is free. We take a small platform fee from the helper's payout — the price you agree on at posting is the price you pay. No surprise charges, no monthly subscription.",
  },
  {
    q: "How fast will someone respond?",
    a: "Most jobs get applications within the first hour. Helprs in your parish get a notification the moment your job is live, and you can review applicants the same day.",
  },
];

const FAQ = () => (
  <section className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-24">
    <div className="container mx-auto max-w-3xl">
      <div className="text-center mb-10 sm:mb-12 observe-fade-up">
        <span className="text-display-eyebrow">Common questions</span>
        <h2 className="text-display-xl mt-3 text-balance">
          Honest answers, no fine print.
        </h2>
      </div>

      {/* Glass container for the FAQ list — single pane that refracts the
          mesh behind it, holds all four collapsible items. */}
      <ul className="liquid-glass faq-list px-6 sm:px-8 py-3">
        {faqs.map((faq, i) => (
          <li key={faq.q} className="observe-fade-up" style={{ transitionDelay: `${i * 80}ms` }}>
            <details className="faq-item">
              <summary>
                <span
                  className="font-display font-semibold text-lg sm:text-xl tracking-tight"
                  style={{ color: "hsl(var(--olivewood))" }}
                >
                  {faq.q}
                </span>
              </summary>
              <div className="faq-answer">
                <p
                  className="font-sans text-sm sm:text-base leading-relaxed max-w-2xl"
                  style={{ color: "hsl(var(--olivewood))", opacity: 0.85 }}
                >
                  {faq.a}
                </p>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  </section>
);

export default FAQ;
