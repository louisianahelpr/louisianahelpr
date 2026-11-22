import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { shareNative } from "@/lib/nativeShare";
import { getCity } from "@/lib/locationUtils";
import { deviceOpensShareSheet, jobShareContent, type ShareableJob } from "@/lib/jobShareContent";
import type { RowAction } from "./JobPageActionRow";
import type { JobPageRow } from "./useJobPage";

/**
 * Jobs audit 11-21 (L23): the job page's top bar carried a share icon, the "..." menu and Help, and squeezed a long
 * title to three lines at 375. Where the page has a "..." menu, sharing is one more line in it (the Posted card's
 * "Share job", F265: jobShareContent through shareNative, which confirms a copy itself); the icon stays only where
 * there is no menu to hold it. JobPage provides the action; JobPageActionRow puts it in its menu and says so.
 * Guard: src/test/jobPageShareInMenu1121.test.tsx.
 */
type MenuShare = { action: RowAction; setInMenu: (inMenu: boolean) => void } | null;

const MenuShareCtx = createContext<MenuShare>(null);
export const MenuShareProvider = MenuShareCtx.Provider;

const shareable = (job: JobPageRow): ShareableJob => ({
  id: job.id, title: job.title, budget: job.budget, helper_fee_flat_cents: job.helper_fee_flat_cents,
  helper_fee_percent: job.helper_fee_percent, category: job.category, city: job.location ? getCity(job.location) : undefined,
});

/** The page's share action and whether a "..." menu holds it (then the top bar draws no share icon). */
export function useJobMenuShare(job: JobPageRow | undefined): { ctx: MenuShare; inMenu: boolean } {
  const [inMenu, setInMenu] = useState(false);
  const [opensSheet] = useState(deviceOpensShareSheet);
  const key = job ? JSON.stringify(shareable(job)) : "";
  const ctx = useMemo<MenuShare>(() => {
    if (!key) return null;
    const content = jobShareContent(JSON.parse(key) as ShareableJob);
    return { action: { key: "share", label: opensSheet ? "Share job" : "Copy job link", go: () => void shareNative(content) }, setInMenu };
  }, [key, opensSheet]);
  return { ctx, inMenu: !!ctx && inMenu };
}

/** The top bar's share icon (where no "..." menu holds the share). */
export function JobHeaderShare({ job }: { job: JobPageRow }) {
  return <ShareJobButton variant="icon" bare job={shareable(job)} />;
}

/** For JobPageActionRow (always mounted with the row): tells the page whether this row's "..." menu holds the share. */
export function MenuShareMark({ on }: { on: boolean }) {
  const share = useContext(MenuShareCtx);
  useLayoutEffect(() => {
    if (!share) return;
    share.setInMenu(on);
    return () => share.setInMenu(false);
  }, [share, on]);
  return null;
}

/** For JobPageActionRow's menu sheet: the share line, or null when the page offers no share. */
export function useMenuShareAction(): RowAction | null {
  return useContext(MenuShareCtx)?.action ?? null;
}
