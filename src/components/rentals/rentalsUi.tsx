import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import NotFound from "@/pages/info/NotFound";

/**
 * Every Rentals page renders the 404 unless the hidden 'rentals' switch is on
 * for the member (the DeclutterGate pattern). While the server's answer is
 * loading it renders the screen's own `skeleton` (RentalsSkeletons.tsx: the
 * page's real AppPage shell and title), never a
 * blank page and never a flash of the 404 for a tester. The server refuses
 * regardless (require_feature in every rentals_* RPC); this only keeps the
 * screens hidden.
 */
export function RentalsGate({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const enabled = useFeature("rentals");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const state = qc.getQueryState(["feature-enabled", "rentals", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  return settled ? <NotFound /> : <>{skeleton}</>;
}

/**
 * One group on a Homes screen: a quiet uppercase header (the Shops/Jobs
 * section-dashboard header) OUTSIDE the card, then one flat card holding the
 * content. `bare` drops the card for a group whose items are cards themselves
 * (a property, a home you rent): owner bar 2026-10-19, never a card inside a
 * card.
 */
export function RentalsCard({ title, children, action, bare = false }: { title: string; children: ReactNode; action?: ReactNode; bare?: boolean }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex min-h-9 items-center justify-between gap-3 px-1">
        <h2 className="text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">{title}</h2>
        {action}
      </div>
      {bare ? <div className="space-y-3">{children}</div> : <div className={`${RENTALS_ITEM_CARD} space-y-3`}>{children}</div>}
    </section>
  );
}

/** The one card surface for a thing on a Homes screen (flat: hairline, no shadow, no box inside it). */
export const RENTALS_ITEM_CARD = "rounded-2xl border border-border bg-card p-4";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Class for a native select element, matching the Input field (same height, radius, border, glass fill and focus ring). */
export const fieldSelectClass =
  "h-12 w-full rounded-2xl border border-[hsl(var(--ink-deep)/0.15)] glass-field px-4 text-ds-15 focus-visible:outline-none focus-visible:border-[hsl(var(--olivewood)/0.6)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood)/0.25)] disabled:cursor-not-allowed disabled:opacity-50";
