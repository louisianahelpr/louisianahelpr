import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { SECTIONS, sectionByKey } from "@/components/sections/sectionsConfig";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useFeature } from "@/hooks/useFeature";
import type { Conversation } from "@/components/messages/types";
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
  // Owner 2026-10-21: no chip for a section that isn't open yet (Declutter / Shops / Homes while their switch is
  // off), unless the member already has threads there, so no thread is ever unreachable by its chip.
  const tabs = messageSectionTabs(visible.map((s) => s.key), prefs.order, jobThreads).filter(
    (k) => live[k] || conversations.some((c) => threadSection(c) === k),
  );
  const section = coerceInboxFilter(params.get("section"), tabs);

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
    ...tabs.map((k) => ({ value: k, label: sectionByKey(k).label })),
  ];
  const strip = (
    <div className="chip-row" role="group" aria-label="Filter messages" data-testid="messages-filter-chips">
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

  let empty: { icon: typeof SECTIONS[number]["icon"]; title: string; body: string; action?: { label: string; to: string } } | null = null;
  if (section !== "all" && section !== "unread" && section !== "jobs") {
    const def = sectionByKey(section);
    const copy = SECTION_INBOX_EMPTY[section];
    // A closed section only has a chip while it holds threads, so its chip never shows an empty list.
    empty = { icon: def.icon, title: `No ${copy.noun} messages yet`, body: copy.body, action: { label: copy.browse, to: def.path } };
  }

  return {
    section, strip, conversations: shown, allConversations: shownAll, sectionEmpty: empty,
    mainEmptyBody: mainInboxEmptyBody(live.declutter),
  };
}
