import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enMessages";
import { navKey } from "@/lib/i18n/navLabels";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { useOpenToEveryoneAnswer } from "@/components/landing/useSectionsOpen";
import type { Conversation } from "@/components/messages/types";
import type { OrderTalkInbox } from "@/components/messages/DeclutterOrderTalkInbox";
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

// Q1947: Messages -> Shops lists the member's shop chats (ShopTalkInbox). Its own chunk: only a member with Shops on
// the Shops chip loads it, so the inbox every signed-in member opens does not carry the Shops chat sheet.
const ShopTalkRows = lazy(() => import("@/components/messages/ShopTalkInbox").then((m) => ({ default: m.ShopTalkRows })));
function ShopTalkLead({ empty }: { empty: ReactNode }) {
  return <Suspense fallback={null}><ShopTalkRows empty={empty} /></Suspense>;
}
// Q2209 (audit 11-05 A-H1): Messages -> Homes lists the member's Homes chats (HomeTalkInbox), in its own chunk the
// same way: only a member with Homes on the Homes chip loads it.
const HomeTalkRows = lazy(() => import("@/components/messages/HomeTalkInbox").then((m) => ({ default: m.HomeTalkRows })));
function HomeTalkLead({ empty }: { empty: ReactNode }) {
  return <Suspense fallback={null}><HomeTalkRows empty={empty} /></Suspense>;
}

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
  const shopsOn = useFeature("shops");
  const homesOn = useFeature("rentals");
  // F133 (owner UI audit 11-09: "Filter chips include Shops and Homes, which are Coming soon. Hide those chips until
  // the sections open"): a tester has Shops and Homes switched on before they open to everyone, so their chips stay
  // hidden until features_open_to_everyone says the section is open (unknown counts as not yet, so no chip flashes).
  const openToEveryone = useOpenToEveryoneAnswer(shopsOn || homesOn);
  const live = {
    jobs: true,
    declutter: useFeature("declutter"),
    shops: shopsOn && !!openToEveryone?.has("shops"),
    homes: homesOn && !!openToEveryone?.has("rentals"),
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
    { value: "all", label: t("msg.filterAll") },
    // The real unread-thread count, or no number at all (never "· 0").
    { value: "unread", label: unread > 0 ? t("msg.filterUnreadN", { n: unread }) : t("msg.filterUnread") },
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
    <div ref={rowRef} className="chip-row" data-more={more ? "" : undefined} role="group" aria-label={t("msg.filterAria")} data-testid="messages-filter-chips">
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
    const noun = navKey(def.path, def.label);
    empty = { icon: def.icon, title: t("msg.sectionEmpty", { noun: noun ? t(noun) : copy.noun }), body: t(`msg.empty.${section}.body`), action: { label: t(`msg.empty.${section}.browse`), to: def.path } };
    // D2-1: Declutter lists the member's order chats above its threads, in place of this empty state when it has any.
    // Q1947: Shops lists the member's shop chats the same way (shops_my_talks needs the switch, so only while it's on).
    if (section === "shops" && live.shops) empty.Lead = ShopTalkLead;
    // Q2209: Homes the same way (rentals_my_talks needs the rentals switch, so only while it's on).
    if (section === "homes" && live.homes) empty.Lead = HomeTalkLead;
  }
  // Q2663 (account audit 1102d row 23): Unread with nothing unread said "No messages yet", even beside a full
  // All tab. It says what is true and goes back to All.
  if (section === "unread" && shown.length === 0) {
    empty = { icon: MailCheck, title: t("msg.noUnread"), body: t("msg.noUnreadBody"), action: { label: t("msg.seeAll"), to: "/messages" } };
  }

  // F420 (audit 11-10): the order chats are inbox rows, mixed with the threads newest first, under All and under the
  // Declutter chip (ConversationListBody). Not under Unread (the server has no unread flag for them), Jobs, Shops or Homes.
  const orderTalkInbox: OrderTalkInbox | null =
    section === "all" || section === "declutter"
      ? { rows: orderTalks.data ?? [], pending: orderTalks.isPending, error: orderTalks.isError ? orderTalks.error : null, reload: () => void orderTalks.refetch() }
      : null;
  return {
    section, strip, conversations: shown, allConversations: shownAll, sectionEmpty: empty, orderTalks: orderTalkInbox,
    mainEmptyBody: mainInboxEmptyBody(live.declutter),
  };
}
