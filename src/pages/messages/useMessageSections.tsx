import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SECTIONS, sectionByKey } from "@/components/sections/sectionsConfig";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useFeature } from "@/hooks/useFeature";
import type { Conversation } from "@/components/messages/types";
import {
  coerceMessageSection,
  messageSectionTabs,
  SECTION_INBOX_EMPTY,
  threadSection,
  threadsForSection,
} from "@/components/messages/messageSections";

/**
 * Messages' section tabs (owner, 2026-10-19: "one screen with section tabs
 * (Jobs, Declutter, Shops, Homes), never mixed"). The tab lives in `?section=`
 * so a link can open a section's inbox; Jobs when absent. The tabs follow the
 * member's Customize order and hidden sections (see messageSectionTabs for the
 * one exception). Returns the strip, the tab's own threads, and the empty state
 * a tab with no threads yet shows.
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
  const tabs = messageSectionTabs(visible.map((s) => s.key), prefs.order, jobThreads);
  const section = coerceMessageSection(params.get("section"), tabs);

  const setSection = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "jobs") p.delete("section");
          else p.set("section", next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const shown = useMemo(() => threadsForSection(conversations, section), [conversations, section]);
  const shownAll = useMemo(
    () => (allConversations ? threadsForSection(allConversations, section) : allConversations),
    [allConversations, section],
  );

  const unreadIn = (key: string) => conversations.filter((c) => c.unread > 0 && threadSection(c) === key).length;

  const strip =
    tabs.length > 1 ? (
      <SegmentedControl
        ariaLabel="Message sections"
        semantics="tab"
        options={tabs.map((k) => ({
          value: k,
          label: sectionByKey(k).label,
          count: unreadIn(k),
          countTone: "attention" as const,
        }))}
        value={section}
        onChange={setSection}
        className="w-full"
        optionClassName="px-1.5 text-ds-12 min-[360px]:text-ds-13 min-[400px]:text-ds-14 whitespace-nowrap"
      />
    ) : undefined;

  let empty: { icon: typeof SECTIONS[number]["icon"]; title: string; body: string; action?: { label: string; to: string } } | null = null;
  if (section !== "jobs") {
    const def = sectionByKey(section);
    const copy = SECTION_INBOX_EMPTY[section];
    empty = live[section]
      ? { icon: def.icon, title: `No ${copy.noun} messages yet`, body: copy.body, action: { label: copy.browse, to: def.path } }
      : { icon: def.icon, title: `${copy.noun} is coming soon`, body: `Your ${copy.noun} chats will show up here once it opens.` };
  }

  return { section, strip, conversations: shown, allConversations: shownAll, sectionEmpty: empty };
}
