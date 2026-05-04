import { Lock, Shield, Check } from "lucide-react";

/**
 * Trust strip — three facts that kill the core friction visitors carry into
 * a marketplace landing: "is it safe? do helpers get vetted? does it cost
 * me anything to post?" One horizontal line near the bottom of the page,
 * thin Burnt Sienna dot separators, Montserrat 500 micro-labels.
 */
const TrustStrip = () => {
  const facts = [
    { icon: Lock, label: "Escrow-protected payment" },
    { icon: Shield, label: "Verified helprs" },
    { icon: Check, label: "Free to post" },
  ];

  return (
    <section className="px-5 sm:px-8 lg:px-12 py-8 sm:py-10 lg:py-12">
      <div className="container mx-auto max-w-3xl">
        {/* Glass pane wraps the three trust facts so they read as a
            cohesive material, not floating text on parchment. */}
        <div className="liquid-glass flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 px-6 sm:px-8 py-5 sm:py-6">
          {facts.map((fact, i) => {
            const Icon = fact.icon;
            return (
              <div
                key={fact.label}
                className="flex items-center gap-3 observe-fade-up"
                style={{ transitionDelay: `${i * 100}ms` }}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className="w-4 h-4 shrink-0"
                    style={{ color: "hsl(var(--sage))" }}
                    strokeWidth={1.5}
                  />
                  <span
                    className="text-xs sm:text-sm font-sans font-medium tracking-tight"
                    style={{ color: "hsl(var(--olivewood))" }}
                  >
                    {fact.label}
                  </span>
                </div>
                {/* Sienna dot separator — only between facts, not after the last */}
                {i < facts.length - 1 && (
                  <span
                    className="hidden sm:block w-1 h-1 rounded-full"
                    style={{
                      backgroundColor: "hsl(var(--burnt-sienna) / 0.5)",
                    }}
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TrustStrip;
