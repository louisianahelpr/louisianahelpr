import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { useHomeSummary } from "@/pages/home/homeDashboard/useHomeSummary";
import type { SectionKey } from "@/components/sections/sectionsConfig";

type CountKey = "posted" | "working" | "selling" | "shopOrders";

/**
 * Board 18 "YOUR ACTIVITY": both sides of every section, two tiles each, in the
 * member's Customize order (hidden sections hidden). A count only when it is
 * real and non-zero ("Posted · 2"); a section not open to this viewer shows
 * "Opening soon" and never routes in (spec v2 §1.8).
 */
export const ACTIVITY_TILES: Record<SectionKey, readonly { label: string; to: string; count?: CountKey }[]> = {
  jobs: [
    { label: "Posted", to: "/jobs?tab=posted", count: "posted" },
    { label: "Working", to: "/jobs?tab=working", count: "working" },
  ],
  declutter: [
    { label: "Buying", to: "/declutter?tab=buying" },
    { label: "Selling", to: "/declutter?tab=selling", count: "selling" },
  ],
  shops: [
    { label: "Orders", to: "/shops?tab=orders", count: "shopOrders" },
    { label: "My shop", to: "/shops?tab=shop" },
  ],
  homes: [
    { label: "Renting", to: "/rentals?tab=rent" },
    { label: "Owning", to: "/rentals?tab=own" },
  ],
};

export function YourActivity() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const summary = useHomeSummary(user);
  const { visible } = useSectionPrefs();
  const live = useSectionTabs();

  return (
    <section aria-label="Your activity" className="flex flex-col gap-2" data-testid="you-activity">
      <h2 className="px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your activity</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {visible.flatMap((s) => {
          const on = s.feature === null || live.find((t) => t.path === s.path)?.on;
          return ACTIVITY_TILES[s.key].map((t) => {
            const n = t.count ? summary.counts[t.count] : 0;
            return (
              <button
                key={`${s.key}-${t.label}`}
                type="button"
                data-activity-tile={`${s.key}:${t.label}`}
                aria-disabled={on ? undefined : true}
                aria-label={on ? `${s.label} ${t.label}${n > 0 ? `, ${n}` : ""}` : `${s.label} ${t.label}, opening soon`}
                onClick={() => (on ? navigate(t.to) : sayComingSoon(s.label))}
                className="btn-press liquid-glass text-left px-4 py-3 flex flex-col min-w-0"
              >
                <span className="text-ds-12 text-muted-foreground">{s.label}</span>
                <span className="text-ds-15 font-bold text-foreground truncate">
                  {t.label}
                  {on && n > 0 ? ` · ${n}` : ""}
                </span>
                {!on && <span className="text-ds-12 text-muted-foreground">Opening soon</span>}
              </button>
            );
          });
        })}
      </div>
    </section>
  );
}
