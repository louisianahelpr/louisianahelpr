import type { Conversation } from "./types";
import type { SectionKey } from "@/components/sections/sectionsConfig";

/**
 * MESSAGES IS ONE INBOX (owner, 2026-10-20, board 13; it replaced the 10-19
 * "section tabs, never mixed" rule): every thread in one list, filtered by
 * chips All / Unread · n / Jobs / Declutter / Shops / Homes.
 *
 * Which section a thread belongs to. Every member thread today is a Jobs
 * thread: `messages.job_id` is the only thread key, and no Declutter, Shops or
 * Homes screen opens a conversation yet. When one does, its threads get their
 * own key here and land in their own tab; until then those tabs show a
 * friendly empty state.
 *
 * A "Louisiana Helpr Team" thread is support, not a section's conversation, so
 * it shows on EVERY tab: real human support is one tap away whichever section
 * the member is in.
 */
export function threadSection(c: Conversation): SectionKey | "support" {
  return c.teamThread ? "support" : "jobs";
}

/** The threads one tab shows: its own section's, plus support. */
export function threadsForSection(list: readonly Conversation[], section: SectionKey): Conversation[] {
  return list.filter((c) => {
    const s = threadSection(c);
    return s === "support" || s === section;
  });
}

/**
 * The tabs, in the member's Customize order. A section the member hid stays
 * hidden here too, EXCEPT Jobs while it has a thread: hiding a section from
 * the nav must never make a conversation unreachable.
 */
export function messageSectionTabs(visibleInOrder: readonly SectionKey[], allInOrder: readonly SectionKey[], jobThreads: number): SectionKey[] {
  const keep = new Set(visibleInOrder);
  if (jobThreads > 0) keep.add("jobs");
  const tabs = allInOrder.filter((k) => keep.has(k));
  return tabs.length > 0 ? tabs : ["jobs"];
}

/** What an empty Declutter / Shops / Homes tab says. Never claims chats exist that cannot yet. */
export const SECTION_INBOX_EMPTY: Record<Exclude<SectionKey, "jobs">, { noun: string; body: string; browse: string }> = {
  declutter: { noun: "Declutter", body: "When you buy or sell an item, your chats with the other person will show up here.", browse: "Browse Declutter" },
  shops: { noun: "Shops", body: "Questions and order chats with local shops will show up here.", browse: "Browse Shops" },
  homes: { noun: "Homes", body: "Chats with landlords and renters will show up here.", browse: "Browse Homes" },
};

/**
 * The All / Unread empty inbox's line. It named only jobs; a member who has
 * Declutter is told their buying and selling chats land here too (owner
 * 2026-10-28 via the lead; walkthrough shot 45-messages-all-empty-jobs-only).
 */
export function mainInboxEmptyBody(declutterOn: boolean): string {
  return declutterOn
    ? "Apply to a job, accept a Helpr's offer, or buy or sell on Declutter. Your conversations show up here."
    : "Apply to a job or accept a Helpr's offer — conversations appear here once they start.";
}

/** The chips: All, Unread, then the sections (in Customize order). */
export type InboxFilter = "all" | "unread" | SectionKey;

/** `?section=` read against the chips; All when absent or unknown. */
export function coerceInboxFilter(raw: string | null, sections: readonly SectionKey[]): InboxFilter {
  if (raw === "unread") return "unread";
  if (raw && (sections as readonly string[]).includes(raw)) return raw as SectionKey;
  return "all";
}

/** The threads a chip shows. A section chip keeps support threads (help is one tap away anywhere). */
export function threadsForFilter(list: readonly Conversation[], filter: InboxFilter): Conversation[] {
  if (filter === "all") return [...list];
  if (filter === "unread") return list.filter((c) => c.unread > 0);
  return threadsForSection(list, filter);
}

/**
 * Board 13's caption: which side of the job you are on. Only what the thread
 * row knows for certain: your own job, or the job you were hired for. An
 * applicant or pre-hire chat gets no caption (never claims a hire).
 *
 * ONE STATUS PER ROW (F24, app audit 2026-10-28): the status chip on the name line says where the job is.
 * "You're working" is itself a status, so it goes once the job is over (completed or cancelled): a row read
 * "Completed" with "You're working · …" under it.
 */
const JOB_OVER_STATUSES: readonly string[] = ["completed", "cancelled"];
export function threadRoleCaption(c: Pick<Conversation, "teamThread" | "viewerIsPoster" | "viewerIsAssignedHelper" | "jobStatus">): string | null {
  if (c.teamThread) return null;
  if (c.viewerIsPoster) return "Your job";
  if (c.viewerIsAssignedHelper) return c.jobStatus && JOB_OVER_STATUSES.includes(c.jobStatus) ? null : "You're working";
  return null;
}
