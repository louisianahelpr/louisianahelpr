import { ShieldCheck, UserCheck, FileText, Lock } from "lucide-react";

/**
 * Trust strip — horizontal row of badges + one-line copy.
 *
 * Kept to four claims we can substantiate today. BBB-accredited is
 * deliberately omitted until a real accreditation number is in hand.
 */
const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    title: "Up to $1M task insurance",
    blurb: "Per-task liability coverage on every booking",
  },
  {
    icon: UserCheck,
    title: "All helprs background-checked",
    blurb: "County + federal criminal, sex-offender registry",
  },
  {
    icon: FileText,
    title: "W-9 / 1099 handled for you",
    blurb: "We collect and store contractor tax forms",
  },
  {
    icon: Lock,
    title: "Stripe-secured payments",
    blurb: "Funds held in escrow until you confirm completion",
  },
];

export function TrustStrip() {
  return (
    <section
      aria-labelledby="trust-strip-heading"
      className="liquid-glass p-5 lg:p-6"
    >
      <h2 id="trust-strip-heading" className="sr-only">
        Trust and safety
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {TRUST_ITEMS.map((item) => (
          <div key={item.title} className="flex flex-col items-start gap-2">
            <div
              className="w-10 h-10 rounded-ds-md flex items-center justify-center"
              style={{
                background: "hsl(var(--bark) / 0.08)",
                color: "hsl(var(--bark))",
              }}
            >
              <item.icon className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <p
                className="text-ds-13 font-semibold leading-snug"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {item.title}
              </p>
              <p className="text-ds-11 text-muted-foreground leading-snug mt-0.5">
                {item.blurb}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default TrustStrip;
