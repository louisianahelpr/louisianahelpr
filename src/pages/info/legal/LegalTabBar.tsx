import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type TabKey, VALID_TABS, TAB_LABELS, TAB_ICONS } from "./legalSections";

// ONE size, always. Below `sm` the three tabs share the full width as an
// even 3-column grid stacked above the search input; from `sm` up they
// collapse to their natural inline width and sit at the right of the row.
// The class string depends only on the viewport — never on which tab is
// selected and never on whether search is focused — so a tab switch cannot
// resize or reposition anything. (It used to be a two-way `searchOpen`
// conditional, which is exactly how three 292px columns turned into a
// compact trio the moment you touched the search icon.)
// Moved out of Legal.tsx unchanged (Q806).
export function LegalTabBar({ tab, hideIconsOnPhone }: { tab: TabKey; hideIconsOnPhone: boolean }) {
  return (
    <TabsList
      data-print-hide
      className="flex items-center gap-1 sm:gap-2 rounded-2xl p-1 h-auto bg-transparent border-0 w-full"
    >
      {VALID_TABS.map((t) => {
        const isActive = t === tab;
        const Icon = TAB_ICONS[t];
        return (
          <TabsTrigger
            key={t}
            value={t}
            className="relative h-9 inline-flex flex-1 min-w-0 items-center justify-center gap-1 sm:gap-1.5 rounded-full text-ds-11 sm:text-ds-13 font-sans font-semibold leading-none transition-colors duration-200 px-1"
            style={{ color: isActive ? "hsl(var(--parchment))" : "hsl(var(--olivewood))" }}
          >
            {/* The selected tab's lifted pill, drawn in place (owner, Q1719,
                2026-10-13: a plain highlight that loads nothing extra). It used
                to slide between tabs through framer-motion's shared layout,
                which put ~39 KB gzip of framer on every legal page and on
                guest `/` (routePrefetch warms /terms from the footer).
                Gradient + inset highlight + soft drop shadow give it depth.
                Guard: scripts/check-deferred-vendors.mjs (Legal root). */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full btn-grad-primary"
                style={{
                  // Reference the shared primary-CTA surface (`.btn-grad-primary`,
                  // the same radial-gloss treatment the "Join free"/bark CTAs
                  // use) so the selected tab reads as a primary button and can
                  // never drift from the canonical gradient. Border + ELEV_FILLED
                  // depth layered on top.
                  border: "1px solid hsl(var(--bark-border))",
                  boxShadow:
                    "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
                    "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
                    "0 2px 6px hsl(var(--ink-deep) / 0.12), " +
                    "0 4px 12px -2px hsl(var(--ink-deep) / 0.08)",
                }}
              />
            )}
            <Icon className={`relative w-3.5 h-3.5 shrink-0 ${hideIconsOnPhone ? "hidden sm:block" : ""}`} strokeWidth={2.25} />
            <span className="relative">{TAB_LABELS[t]}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
