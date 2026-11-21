import { useEffect, useState } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

/**
 * Desktop Messages is TWO PANES (board 38, owner 2026-10-20), but only where the
 * open chat keeps room to breathe: the owner's one condition is that the chat is
 * NEVER cut off (2026-09-11: the old 340px split squeezed it). Measured at 1100:
 * the chat pane was 442px, so the sidebar + page padding take 298px. 298 + the
 * 360px list + a 480px chat floor = 1138, so the split starts at 1140px. Below
 * that, every width keeps the phone's list -> full chat swap.
 */
export const TWO_PANE_MIN_WIDTH = 1140;
/** Sidebar + page padding beside the two panes, measured at 1100 (see above). */
export const TWO_PANE_CHROME_PX = 298;
export const CHAT_PANE_FLOOR_PX = 480;
export const MESSAGES_LIST_PANE_PX = 360;
/**
 * Owner-approved polish 2026-11-20: a wider list where there is room, so names truncate less. 420px from 1300px
 * (chat there: 1300 - 298 - 420 = 582, over the 480 floor); 360px from the split (1140) up to that.
 */
export const MESSAGES_LIST_PANE_WIDE_PX = 420;
export const MESSAGES_LIST_PANE_WIDE_FROM = 1300;
/** The list pane's width classes (the pane and its loading skeleton share them, so nothing shifts). */
export const MESSAGES_LIST_PANE_CLASS = "w-[360px] min-[1300px]:w-[420px]";
const QUERY = `(min-width: ${TWO_PANE_MIN_WIDTH}px)`;

function wide(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

export function useMessagesTwoPane(): boolean {
  const isWebDesktop = useIsWebDesktop();
  const [isWide, setIsWide] = useState(wide);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isWebDesktop && isWide;
}
