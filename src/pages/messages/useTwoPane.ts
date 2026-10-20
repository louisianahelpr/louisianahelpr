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
