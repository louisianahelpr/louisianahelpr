import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, openingSoonLine } from "@/components/mobileNav/useSectionTabs";
import { useHomeSummary } from "@/pages/home/homeDashboard/useHomeSummary";
import type { SectionKey } from "@/components/sections/sectionsConfig";
import { GlassTileButton } from "@/components/ui/GlassTileButton";
import { PreviewPill } from "@/components/sections/PreviewPill";

type CountKey = "posted" | "working" | "selling" | "shopOrders" | "buying";

/**
 * F088 (owner UI audit 11-09): a count alone ("Selling · 255") said nothing at a glance. Each count carries its status
 * word ("255 live", "1 booked"). Still only when real and non-zero (board 18).
 */
const COUNT_WORD: Record<CountKey, string> = {
  posted: "live",
  working: "booked",
  selling: "live",
  shopOrders: "open",
  buying: "in progress",
};

/**
 * Board 18 "YOUR ACTIVITY": both sides of every section, two tiles each, in the
 * member's Customize order (hidden sections hidden). A count only when it is
 * real and non-zero ("Posted · 2"). A section not open to this viewer has NO
 * tiles (owner, 2026-10-21: six dead "Opening soon" tiles were clutter); one
 * quiet line names them all instead ("Declutter, Shops and Homes are opening
 * soon"), spec v2 §1.8.
 */
export const ACTIVITY_TILES: Record<SectionKey, readonly { label: string; to: string; count?: CountKey }[]> = {
  jobs: [
    { label: "Posted", to: "/jobs?tab=posted", count: "posted" },
    { label: "Working", to: "/jobs?tab=working", count: "working" },
  ],
  declutter: [
    { label: "Buying", to: "/declutter?tab=buying", count: "buying" },
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

  const isOn = (s: (typeof visible)[number]) => s.feature === null || !!live.find((t) => t.path === s.path)?.on;
  // F087 (owner UI audit 11-09): a section open to this viewer only as a tester preview (Shops, Homes: not yet open to
  // everyone, sectionIsPreview) read as live. Its tiles carry the Coming soon badge inside, slightly dimmed (owner
  // 11-09, the F002/F013 badge rule). A member never sees one: their live sections are open to everyone.
  const isPreview = (s: (typeof visible)[number]) => !!live.find((t) => t.path === s.path)?.preview;
  // In the iPhone app a section not yet open to everyone is not listed at all (owner 10-31, hideUnopenedInApp via the
  // tab's `listed` answer), so its preview tiles and their Coming soon badge never reach the app.
  const isListedHere = (s: (typeof visible)[number]) => live.find((t) => t.path === s.path)?.listed !== false;
  const open = visible.filter((s) => isOn(s) && isListedHere(s));
  const soon = openingSoonLine(visible.filter((s) => !isOn(s)).map((s) => s.label));

  return (
    <section aria-label="Your activity" className="flex flex-col gap-2" data-testid="you-activity">
      <h2 className="px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your activity</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {open.flatMap((s) =>
          ACTIVITY_TILES[s.key].map((t) => {
            const n = t.count ? summary.counts[t.count] ?? 0 : 0;
            const word = t.count ? COUNT_WORD[t.count] : "";
            const preview = isPreview(s);
            return (
              <GlassTileButton
                key={`${s.key}-${t.label}`}
                data-activity-tile={`${s.key}:${t.label}`}
                data-preview={preview ? "true" : undefined}
                onClick={() => navigate(t.to)}
                title={`${s.label} ${t.label}${n > 0 ? ` · ${n} ${word}` : ""}`}
                className="px-4 py-3"
                style={preview ? { opacity: 0.75 } : undefined}
              >
                {/* No aria-label: the tile's words ("Jobs Posted 2") are its name, so the visible text is in it (axe
                    label-content-name-mismatch, WCAG 2.5.3; ui-sweep #3491). The space keeps the two lines two words;
                    whitespace between flex items draws nothing. */}
                <span className="text-ds-12 text-muted-foreground">{s.label}</span>{" "}
                {/* F449 (audit 11-10): at 375 "Buying · 1 in progress" was cut to "Buying · 1 in ..." by truncate; it wraps. */}
                <span className="text-ds-15 font-bold text-foreground break-words">
                  {t.label}
                  {n > 0 && <><span aria-hidden="true"> ·</span> {n} {word}</>}
                </span>
                {preview && <>{" "}<PreviewPill className="self-start mt-1" /></>}
              </GlassTileButton>
            );
          }),
        )}
      </div>
      {soon && <p data-testid="you-activity-soon" className="px-1 text-ds-13 text-muted-foreground">{soon}</p>}
    </section>
  );
}
