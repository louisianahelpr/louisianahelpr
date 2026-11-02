import { useEffect } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { useFeatureStatus } from "@/hooks/useFeature";
import type { Tab } from "./types";

/**
 * Instant book is off for everyone (switch 'instant_book', owner 11-01) and its tab draws nothing then, so an old
 * link or notice to ?tab=instant_book landed on a blank screen (Q2647). Once the switch answers off, swap that
 * entry for Settings (replace, so Back never walks into the blank tab again). Lives outside Profile.tsx, which is
 * over the component size line (componentSizeRatchet).
 */
export function useInstantBookTabRedirect(tab: Tab, setSearchParams: SetURLSearchParams): void {
  const instantBookSwitch = useFeatureStatus("instant_book");
  const instantBookOff = instantBookSwitch.settled && !instantBookSwitch.on;
  useEffect(() => {
    if (tab !== "instant_book" || !instantBookOff) return;
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", "settings"); return next; }, { replace: true });
  }, [tab, instantBookOff, setSearchParams]);
}
