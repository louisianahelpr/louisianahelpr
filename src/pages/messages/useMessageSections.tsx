import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import type { Conversation } from "@/components/messages/types";
import { DeclutterOrderTalkRows } from "@/components/messages/DeclutterOrderTalkInbox";
import type { SectionEmpty } from "@/components/messages/SectionInboxEmpty";
import { fetchMyOrderTalks, MY_ORDER_TALKS_KEY } from "@/lib/declutter/orderTalk";
import {
  coerceInboxFilter,
  messageSectionTabs,
  SECTION_INBOX_EMPTY,
  mainInboxEmptyBody,
  threadSection,
  threadsForFilter,
  type InboxFilter,
} from "@/components/messages/messageSections";

/**
 * Messages = ONE inbox (board 13, owner 2026-10-20; it replaced the 10-19
 * "never mixed" tabs): chips All / Unread · n / Jobs / Declutter / Shops /
 * Homes over one list. The chip lives in `?section=` (all when absent,
 * `unread`, or a section key) so a link can open a section's threads. Section
 * chips follow the member's Customize order and hidden sections (see
 * messageSectionTabs for the one exception). Returns the chip row, the
 * chip's threads, and the empty state a section with no threads yet shows.
 */
export function useMessageSections(conversations: Conversation[], allConversations: Conversation[] | undefined) {
  const [params, setParams] = useSearchParams();
  const { prefs, visible } = useSectionPrefs();
  const live = {
    jobs: true,
    declutter: useFeature("declutter"),
    shops: useFeature("shops"),
    homes: useFeature("rentals"),
  } as const;

  const jobThreads = useMemo(() => conversations.filter((c) => threadSection(c) === "jobs").length, [conversations]);
  // D2-1: Declutter's order chats (DeclutterOrderTalkInbox, same query key, so one request). A paid sale carries on
  // with the switch off (row 62), so a member who has one keeps the Declutter chip that lists it.
  const orderTalks = useQuery({ queryKey: MY_ORDER_TALKS_KEY, queryFn: fetchMyOrderTalks, staleTime: 30_000 });
  const hasOrderTalks = (orderTalks.data?.length ?? 0) > 0;
  // Owner 2026-10-21: no chip for a section that isn't open yet (Declutter / Shops / Homes while their switch is
  // off), unless the member already has threads there, so no thread is ever unreachable by its chip.
  const tabs = messageSectionTabs(visible.map((s) => s.key), prefs.order, jobThreads).filter(
    (k) => live[k] || conversations.some((c) => threadSection(c) === k) || (k === "declutter" && hasOrderTalks),
  );
  // A3-L8 (app audit 2026-10-29): a lone section chip ("Jobs" while it is the
  // only section) shows exactly what All shows, so it is not drawn; a
  // `?section=` link to it reads as All.
  const chipTabs = tabs.length > 1 ? tabs : [];
  const section = coerceInboxFilter(params.get("section"), chipTabs);

  const setSection = useCallback(
    (next: InboxFilter) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "all") p.delete("section");
          else p.set("section", next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const shown = useMemo(() => threadsForFilter(conversations, section), [conversations, section]);
  const shownAll = useMemo(
    () => (allConversations ? threadsForFilter(allConversations, section) : allConversations),
    [allConversations, section],
  );

  const unread = conversations.filter((c) => c.unread > 0).length;
  const chips: { value: InboxFilter; label: string }[] = [
    { value: "all", label: "All" },
    // The real unread-thread count, or no number at all (never "· 0").
    { value: "unread", label: unread > 0 ? `Unread · ${unread}` : "Unread" },
    ...chipTabs.map((k) => ({ value: k, label: sectionByKey(k).label })),
  ];
  // #3 (Declutter walk 2026-10-28, shot 46): the row's right edge was faded ALWAYS, so at 1440 the last chip that
  // fit ("Declutter") read as cut off, and the rest (Shops, Homes) sat out of sight in a row a mouse can't swipe
  // (measured: 502px of chips in a 327px list pane). On the desktop website the chips wrap onto a second line
  // (index.css), and anywhere the fade marks only a row that really continues past its right edge.
  const rowRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const chipCount = chips.length;
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => setMore(row.scrollWidth - row.clientWidth - row.scrollLeft > 2);
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      ro?.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, [chipCount]);
  const strip = (
    <div ref={rowRef} className="chip-row" data-more={more ? "" : undefined} role="group" aria-label="Filter messages" data-testid="messages-filter-chips">
      {chips.map((c) => (
        <button
          key={c.value}
          type="button"
          data-inbox-chip={c.value}
          aria-pressed={section === c.value}
          onClick={() => setSection(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  let empty: SectionEmpty | null = null;
  if (section !== "all" && section !== "unread" && section !== "jobs") {
    const def = sectionByKey(section);
    const copy = SECTION_INBOX_EMPTY[section];
    // A closed section only has a chip while it holds threads, so its chip never shows an empty list.
    empty = { icon: def.icon, title: `No ${copy.noun} messages yet`, body: copy.body, action: { label: copy.browse, to: def.path } };
    // D2-1: Declutter lists the member's order chats above its threads, in place of this empty state when it has any.
    if (section === "declutter") empty.Lead = DeclutterOrderTalkRows;
  }

  return {
    section, strip, conversations: shown, allConversations: shownAll, sectionEmpty: empty,
    mainEmptyBody: mainInboxEmptyBody(live.declutter),
  };
}
