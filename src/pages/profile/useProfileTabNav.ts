import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hasInAppHistory } from "@/lib/inAppHistory";
import { TAB_TITLES, profileTabTitle, resolveTab, type Tab } from "./types";
import { useInstantBookTabRedirect } from "./useInstantBookTabRedirect";

/**
 * Profile's tab state: which of the in-page tabs shows, the `?tab=` URL sync
 * (both ways), the per-tab page title and the Back-out-of-a-tab rule. Moved
 * verbatim out of Profile.tsx (Q806 god-component split); behaviour unchanged.
 */
export function useProfileTabNav() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = resolveTab(searchParams.get("tab"));
  const [tab, setTab] = useState<Tab>(initialTab);

  /**
   * Back out of a tab — to the Profile landing when that is where you came
   * from, and otherwise to wherever you actually came from.
   *
   * (History: every tab once hardcoded `setTab("landing")`, ignoring a
   * notification deep link's real history.) A tab opened from Settings backs
   * out to Settings (returnTo).
   *
   * `cameFromLanding`: true once the landing rendered this visit ("up" ==
   * "back"). Deep-linked into a tab, go back a real history entry, else the
   * landing (BackButton's has-history test).
   */
  const returnTo = useRef<Tab | null>(null); // a tab opened from You › Settings (board 52) backs out to Settings
  const cameFromLanding = useRef(initialTab === "landing");
  useEffect(() => {
    if (tab === "landing") { cameFromLanding.current = true; returnTo.current = null; }
  }, [tab]);
  const openFromSettings = useCallback((key: string) => { returnTo.current = "settings"; setTab(key as Tab); }, []);
  const backFromTab = useCallback(() => {
    if (returnTo.current) { const parent = returnTo.current; returnTo.current = null; setTab(parent); return; }
    if (cameFromLanding.current) {
      setTab("landing");
      return;
    }
    if (hasInAppHistory()) navigate(-1);
    else setTab("landing");
  }, [navigate]);

  // One title per tab. Every one of the 18 tabs used to report the same
  // "My Profile — Helpr", so browser history, bookmarks and the tab bar could
  // not tell Security from Payment from Legal. `?tab=` is already the URL
  // source of truth (synced both ways below), so the title follows it.
  // TAB_TITLES has no `landing` key — the bare profile page keeps the plain
  // title rather than repeating itself.
  usePageTitle(
    tab === "landing" || !TAB_TITLES[tab]
      ? "You — Helpr"
      : `${profileTabTitle(tab, searchParams.toString())} — You — Helpr`,
  );

  // Sync tab to URL for bookmarkability; React Router owns history so browser
  // back/forward updates searchParams, which the effect below mirrors to state.
  //
  // Opening a tab PUSHES a history entry. It used to replace, so entering a
  // tab added nothing to history and Back skipped the Profile landing
  // entirely: /home -> Profile -> Account Security -> Back landed on
  // /home, with history.length never incrementing. On iOS the swipe-back
  // gesture did the same, which is the one users reach for constantly.
  //
  // Returning to the landing still REPLACES, so Back doesn't walk you through
  // every tab you happened to visit — one Back from a tab lands on the
  // landing, a second leaves Profile.
  useEffect(() => {
    const current = resolveTab(searchParams.get("tab"));
    if (current === tab) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "landing") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: tab === "landing" },
    );
  }, [tab]);

  useInstantBookTabRedirect(tab, setSearchParams); // Q2647: an old ?tab=instant_book link opens Settings

  // Mirror URL → state when back/forward (or a deep link) changes the tab param.
  useEffect(() => {
    const urlTab = resolveTab(searchParams.get("tab"));
    setTab((prev) => (prev === urlTab ? prev : urlTab));
  }, [searchParams]);

  return { tab, setTab, openFromSettings, backFromTab };
}
