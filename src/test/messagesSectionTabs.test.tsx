/**
 * MESSAGES: ONE INBOX WITH FILTER CHIPS (board 13, owner 2026-10-20; it
 * replaced the 10-19 "section tabs, never mixed" rule). Layers checked:
 *   1. the rule (messageSections.ts): All shows every thread, Unread the
 *      unread ones, a section chip its own section's threads plus support
 *      ("Louisiana Helpr Team"); the section chips follow the member's
 *      Customize order and hidden sections, but Jobs stays while it has a
 *      thread; `?section=` falls back to All; the row caption names only a
 *      side the thread knows for certain;
 *   2. the hook (useMessageSections): the chips read All / Unread · n /
 *      sections, the URL picks the chip, a Declutter/Shops/Homes chip with no
 *      threads gets its friendly empty state ("coming soon" while its switch
 *      is off);
 *   3. the screen (ConversationList): the strip renders under the title, the
 *      section empty state replaces "No messages yet" and the Active / All
 *      filter (job states) leaves that tab; Messages.tsx passes the hook's
 *      threads, not the raw inbox.
 *
 * @mutate src/components/messages/messageSections.ts |     return s === "support" \|\| s === section; |     return true;
 * @mutate src/components/messages/messageSections.ts |   if (jobThreads > 0) keep.add("jobs"); |   void 0;
 * @mutate src/pages/messages/useMessageSections.tsx |     (k) => live[k] \|\| conversations.some((c) => threadSection(c) === k) \|\| (k === "declutter" && hasOrderTalks), |     (k) => k !== undefined,
 * @mutate src/components/messages/messageSections.ts |   if (filter === "all") return [...list]; |   if (filter === "all") return list.filter((c) => !!c.teamThread);
 * @mutate src/components/messages/messageSections.ts |   if (filter === "unread") return list.filter((c) => c.unread > 0); |   if (filter === "unread") return [...list];
 * @mutate src/components/messages/messageSections.ts |   return "all";\n} |   return "jobs";\n}
 * @mutate src/components/messages/messageSections.ts |   if (c.viewerIsAssignedHelper) return c.jobStatus |   if (!c.viewerIsPoster) return c.jobStatus
 * F24 (audit 2026-10-28): one status per row; a finished job's thread drops "You're working".
 * @mutate src/components/messages/messageSections.ts | c.jobStatus && JOB_OVER_STATUSES.includes(c.jobStatus) ? null : "You're working"; | false ? null : "You're working";
 * @mutate src/pages/messages/useMessageSections.tsx |     { value: "unread", label: unread > 0 ? `Unread · ${unread}` : "Unread" }, |     { value: "unread", label: `Unread · ${unread}` },
 * @mutate src/pages/messages/Messages.tsx |       conversations={inbox.conversations} |       conversations={conversations}
 * @mutate src/components/messages/ConversationList.tsx |       {phoneSearchRow}\n      {sectionTabs && ( |       {phoneSearchRow}\n      {false && (
 * @mutate src/pages/messages/useMessageSections.tsx |     mainEmptyBody: mainInboxEmptyBody(live.declutter), |     mainEmptyBody: mainInboxEmptyBody(false),
 * @mutate src/components/messages/ConversationList.tsx |                 body={mainEmptyBody} |                 body={mainInboxEmptyBody(false)}
 * @mutate src/pages/messages/useMessageSections.tsx | data-more={more ? "" : undefined} | data-more=""
 * @mutate src/index.css | .chip-row[data-more] { | .chip-row, .chip-row[data-more] {
 * @mutate src/index.css | html.web-desktop .chip-row {\n  flex-wrap: wrap !important; | html.web-desktop .chip-row {\n  flex-wrap: nowrap !important;
 * @mutate src/pages/messages/useMessageSections.tsx |   const chipTabs = tabs.length > 1 ? tabs : []; |   const chipTabs = tabs;
 * @mutate src/lib/inboxDefault.ts |   all: "Any status", |   all: "All",
 * D2-1 (audit 1028 part 2): the Declutter tab lists the member's order chats, and keeps its chip with Declutter off.
 * @mutate src/pages/messages/useMessageSections.tsx |     if (section === "declutter") empty.Lead = DeclutterOrderTalkRows; |     void DeclutterOrderTalkRows;
 * @mutate src/pages/messages/useMessageSections.tsx |   const hasOrderTalks = (orderTalks.data?.length ?? 0) > 0; |   const hasOrderTalks = false;
 * @mutate src/components/messages/SectionInboxEmpty.tsx |   return empty.Lead ? <empty.Lead empty={box} /> : box; |   return box;
 * @mutate src/components/messages/ConversationList.tsx | <div className="space-y-2">{sectionEmpty?.Lead && !searchQuery.trim() && !selectMode && <sectionEmpty.Lead empty={null} />} | <div className="space-y-2">{null}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sofa } from "lucide-react";
import type { Conversation } from "@/components/messages/types";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// D2-1: the member's Declutter order chats (the list itself: declutterOrderTalkInbox.test.tsx). None unless a test sets some.
const orderTalks: { rows: unknown[] } = { rows: [] };
vi.mock("@/lib/declutter/orderTalk", () => ({ MY_ORDER_TALKS_KEY: ["declutter", "my-order-talks"], fetchMyOrderTalks: async () => orderTalks.rows }));
vi.mock("@/components/messages/DeclutterOrderTalkInbox", () => ({
  DeclutterOrderTalkRows: ({ empty }: { empty: ReactNode }) => <><p>ORDER CHATS</p>{empty}</>,
}));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
// The member's switches and Customize choice are inputs here, not what is under test.
const featureOn: Record<string, boolean> = { declutter: false, shops: true, rentals: true };
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => featureOn[k] ?? false }));
const prefs = { order: ["jobs", "declutter", "shops", "homes"] as SectionKey[], hidden: [] as SectionKey[] };
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS: S } = await import("@/components/sections/sectionsConfig");
  return {
    useSectionPrefs: () => ({
      prefs,
      visible: prefs.order.filter((k) => !prefs.hidden.includes(k)).map((k) => S.find((s) => s.key === k)!),
      setHidden: vi.fn(),
      move: vi.fn(),
    }),
  };
});

import { coerceInboxFilter, messageSectionTabs, threadRoleCaption, threadsForFilter, threadsForSection } from "@/components/messages/messageSections";
import { useMessageSections } from "@/pages/messages/useMessageSections";
import { INBOX_TAB_LABEL } from "@/lib/inboxDefault";
import { ConversationList } from "@/components/messages/ConversationList";
import { ConversationRow } from "@/components/messages/ConversationRow";
import { DeclutterOrderTalkRows } from "@/components/messages/DeclutterOrderTalkInbox";
// The phone header is the shared AppTopBar since Q2231; its bell and avatar
// need the app's providers, and this file tests the list, not the bar.
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title }: { title?: string }) => <header data-testid="app-top-bar"><h1>{title}</h1></header>,
}));


afterEach(() => {
  cleanup();
  prefs.order = ["jobs", "declutter", "shops", "homes"];
  prefs.hidden = [];
});

const convo = (over: Partial<Conversation>): Conversation =>
  ({
    otherUserId: "u2",
    otherUserName: "Pat",
    jobTitle: "Mow the lawn",
    jobId: "job-1",
    jobStatus: "accepted",
    lastMessage: "hi",
    lastAt: "2026-10-19T00:00:00Z",
    unread: 0,
    ...over,
  }) as Conversation;
const JOB = convo({ jobId: "job-1", unread: 2 });
const TEAM = convo({ jobId: "team:me", otherUserName: "Louisiana Helpr Team", teamThread: { userId: "me", viewerIsStaff: false } });
const KEYS = SECTIONS.map((s) => s.key);

describe("the rule: one inbox, filtered by chips", () => {
  it("All = every thread; Unread = unread threads; a section chip = its own threads plus support", () => {
    expect(KEYS.length).toBeGreaterThan(3);
    expect(threadsForFilter([JOB, TEAM], "all")).toEqual([JOB, TEAM]);
    expect(threadsForFilter([JOB, TEAM], "unread")).toEqual([JOB]);
    for (const k of KEYS) {
      const shown = threadsForSection([JOB, TEAM], k);
      expect(shown, k).toContain(TEAM);
      expect(shown.includes(JOB), k).toBe(k === "jobs");
      expect(threadsForFilter([JOB, TEAM], k)).toEqual(shown);
    }
  });

  it("section chips follow Customize order and hidden sections; Jobs stays while it has a thread; ?section= falls back to All", () => {
    expect(messageSectionTabs(["shops", "jobs"], ["shops", "jobs", "declutter", "homes"], 0)).toEqual(["shops", "jobs"]);
    expect(messageSectionTabs(["shops"], ["jobs", "declutter", "shops", "homes"], 0)).toEqual(["shops"]);
    expect(messageSectionTabs(["shops"], ["jobs", "declutter", "shops", "homes"], 3)).toEqual(["jobs", "shops"]);
    expect(coerceInboxFilter(null, ["shops", "jobs"])).toBe("all");
    expect(coerceInboxFilter("nope", ["shops", "jobs"])).toBe("all");
    expect(coerceInboxFilter("unread", ["shops", "jobs"])).toBe("unread");
    expect(coerceInboxFilter("shops", ["shops", "jobs"])).toBe("shops");
  });

  it("the row caption names only a side the thread knows: your job, or the job you were hired for", () => {
    expect(threadRoleCaption({ viewerIsPoster: true })).toBe("Your job");
    expect(threadRoleCaption({ viewerIsAssignedHelper: true })).toBe("You're working");
    expect(threadRoleCaption({})).toBeNull();
    expect(threadRoleCaption({ teamThread: { userId: "me", viewerIsStaff: false } })).toBeNull();
  });

  it("F24: one status per row: a finished job's thread never says You're working beside its status chip", () => {
    const live = ["accepted", "in_progress", "revision_requested", "disputed"];
    // Inventory floor: the live states still carry the caption.
    expect(live.length).toBeGreaterThan(3);
    for (const s of live) expect(threadRoleCaption({ viewerIsAssignedHelper: true, jobStatus: s }), s).toBe("You're working");
    for (const s of ["completed", "cancelled"]) expect(threadRoleCaption({ viewerIsAssignedHelper: true, jobStatus: s }), s).toBeNull();
    // The poster's caption is a side, not a status: it stays.
    expect(threadRoleCaption({ viewerIsPoster: true, jobStatus: "completed" })).toBe("Your job");
  });

  it("F24: the rendered row of a completed job the viewer worked shows Completed and no You're working", () => {
    render(<ConversationRow convo={convo({ jobStatus: "completed", viewerIsAssignedHelper: true })} currentUserId="me" openConvo={() => {}} />);
    expect(screen.getByTestId("row-status-chip").textContent).toBe("Completed");
    const caption = document.querySelector("[data-thread-caption]")?.textContent ?? "";
    expect(caption).toContain("Mow the lawn");
    expect(caption, "two statuses on one row").not.toContain("You're working");
  });
});

const wrap = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter></QueryClientProvider>;
  };

describe("the hook", () => {
  it("All (default): every thread, chips All / Unread · n / the OPEN sections, no section empty state", () => {
    const { result } = renderHook(() => useMessageSections([JOB, TEAM], [JOB, TEAM]), { wrapper: wrap("/messages") });
    expect(result.current.section).toBe("all");
    expect(result.current.conversations).toEqual([JOB, TEAM]);
    expect(result.current.sectionEmpty).toBeNull();
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    const chips = screen.getAllByRole("button").map((b) => b.textContent);
    // Declutter is switched off here and has no threads: no chip (owner 2026-10-21).
    expect(chips).toEqual(["All", "Unread · 1", "Jobs", "Shops", "Homes"]);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  // A3-L8 (app audit 2026-10-29): with Jobs the only section, a lone "Jobs"
  // chip showed what All shows; and the filter menu repeated "All".
  it("a lone section chip is not drawn, and the menu never says All beside the All chip", () => {
    featureOn.shops = false;
    featureOn.rentals = false;
    try {
      const { result } = renderHook(() => useMessageSections([JOB, TEAM], [JOB, TEAM]), { wrapper: wrap("/messages?section=jobs") });
      expect(result.current.section).toBe("all");
      render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Unread · 1"]);
    } finally {
      featureOn.shops = true;
      featureOn.rentals = true;
    }
    expect(Object.values(INBOX_TAB_LABEL).length).toBeGreaterThan(1);
    expect(Object.values(INBOX_TAB_LABEL)).not.toContain("All");
  });

  it("with nothing unread the chip reads just 'Unread' (never '· 0')", () => {
    const { result } = renderHook(() => useMessageSections([TEAM], [TEAM]), { wrapper: wrap("/messages") });
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
  });

  it("an open section with no threads says so and offers Browse; a switched-off one has no chip at all", () => {
    const shops = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=shops") });
    expect(shops.result.current.conversations).toEqual([]);
    expect(shops.result.current.sectionEmpty).toMatchObject({ title: "No Shops messages yet", action: { label: "Browse Shops", to: "/shops" } });
    // A switched-off section has no chip, so its link falls back to All (owner 2026-10-21).
    const declutter = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=declutter") });
    expect(declutter.result.current.section).toBe("all");
    expect(declutter.result.current.sectionEmpty).toBeNull();
  });

  // Owner 2026-10-28 via the lead: the All empty state talked only about jobs
  // (~/.lh-shots/declutter-walk-1028/45-messages-all-empty-jobs-only.png).
  it("the empty All inbox names Declutter while Declutter is on for the member, and only then", () => {
    featureOn.declutter = true;
    const on = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
    expect(on.result.current.mainEmptyBody).toMatch(/Declutter/);
    expect(on.result.current.mainEmptyBody).toMatch(/job/);
    featureOn.declutter = false;
    const off = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
    expect(off.result.current.mainEmptyBody).not.toMatch(/Declutter/);
  });

  it("a hidden section has no chip, and its URL falls back to All", () => {
    prefs.hidden = ["homes"];
    const { result } = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=homes") });
    expect(result.current.section).toBe("all");
  });
});

// #3 (Declutter walk 2026-10-28, shot 46; measured ~/.lh-shots/b3-1028/s3: 502px of chips in a 327px list pane at
// 1440): the fade on the row's right edge was ALWAYS on, so the last chip that fit ("Declutter") read as cut off and
// Shops / Homes sat out of sight in a row a mouse can't swipe. The fade marks only a row that really continues past
// its right edge, and on the desktop website the chips wrap instead of scrolling.
describe("the chip row fits", () => {
  const box = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
  const isRow = (el: Element) => el.getAttribute("data-testid") === "messages-filter-chips";
  const restore: Array<() => void> = [];
  for (const k of ["scrollWidth", "clientWidth", "scrollLeft"] as const) {
    const real = Object.getOwnPropertyDescriptor(Element.prototype, k)!;
    restore.push(() => Object.defineProperty(Element.prototype, k, real));
  }
  const fake = () => {
    for (const k of ["scrollWidth", "clientWidth", "scrollLeft"] as const) {
      const real = Object.getOwnPropertyDescriptor(Element.prototype, k)!;
      Object.defineProperty(Element.prototype, k, {
        configurable: true,
        get(this: Element) { return isRow(this) ? box[k] : real.get!.call(this); },
        set(this: Element, v: number) { if (isRow(this)) box[k] = v; else real.set?.call(this, v); },
      });
    }
  };
  afterEach(() => restore.forEach((r) => r()));
  function Strip() {
    return useMessageSections([JOB, TEAM], [JOB, TEAM]).strip;
  }

  it("the fade shows only while chips continue past the right edge", () => {
    fake();
    Object.assign(box, { scrollWidth: 502, clientWidth: 335, scrollLeft: 0 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Strip /></MemoryRouter></QueryClientProvider>);
    const row = screen.getByTestId("messages-filter-chips");
    expect(row).toHaveAttribute("data-more");
    box.scrollLeft = 167; // swiped to the end: the last chip is in full view, unfaded
    fireEvent.scroll(row);
    expect(row).not.toHaveAttribute("data-more");
    cleanup();
    Object.assign(box, { scrollWidth: 327, clientWidth: 327, scrollLeft: 0 }); // every chip fits
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Strip /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByTestId("messages-filter-chips")).not.toHaveAttribute("data-more");
  });

  it("index.css: the fade rule needs data-more, and the desktop website wraps the chips", () => {
    const css = blankCssComments(readFileSync(join(process.cwd(), "src/index.css"), "utf8"));
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const chipRules = rules.filter((r) => r.sel.split(",").some((s) => /\.chip-row(?![\w-])/.test(s)));
    expect(chipRules.length).toBeGreaterThan(3);
    const faded = chipRules.filter((r) => /mask-image/.test(r.body));
    expect(faded.length).toBeGreaterThan(0);
    for (const r of faded) for (const s of r.sel.split(",")) expect(s.trim(), r.sel).toMatch(/\.chip-row\[data-more\]/);
    const desk = chipRules.filter((r) => r.sel.split(",").some((s) => /html\.web-desktop\s+\.chip-row\s*$/.test(s.trim())));
    expect(desk.some((r) => /flex-wrap:\s*wrap\s*!important/.test(r.body))).toBe(true);
  });
});

describe("the screen", () => {
  const renderList = (sectionEmpty: Parameters<typeof ConversationList>[0]["sectionEmpty"], mainEmptyBody?: string) =>
    render(
      <MemoryRouter>
        <ConversationList
          conversations={[]}
          loading={false}
          loadError={false}
          retryInbox={vi.fn()}
          userId="user-1"
          loadConversations={vi.fn(async () => {})}
          openConvo={vi.fn()}
          setDeleteConvoConfirm={vi.fn()}
          onBatchArchive={vi.fn()}
          sectionTabs={<div>SECTION STRIP</div>}
          sectionEmpty={sectionEmpty}
          mainEmptyBody={mainEmptyBody}
        />
      </MemoryRouter>,
    );

  it("a section tab with no threads: the strip, its own empty state, no Active / All filter", () => {
    renderList({ icon: Sofa, title: "No Declutter messages yet", body: "b", action: { label: "Browse Declutter", to: "/declutter" } });
    expect(screen.getByText("SECTION STRIP")).toBeInTheDocument();
    expect(screen.getByText("No Declutter messages yet")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();
    expect(screen.queryByRole("button", { name: /conversation filters|filter conversations/i })).toBeNull();
    expect(screen.queryByRole("menuitemradio", { name: /^(Active|All)/ })).toBeNull();
    expect(document.getElementById("inbox-filter-tabs")).toBeNull();
  });

  it("the Jobs tab keeps the Jobs empty state, whose action goes to Jobs > Browse", () => {
    renderList(null);
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
    // Phone (Q2231): Active / All are reachable from the search row's more menu.
    expect(screen.getByRole("button", { name: "Inbox views and options" })).toBeTruthy();
  });

  it("the empty All inbox shows the line it is handed", () => {
    renderList(null, "Apply to a job, accept a Helpr's offer, or buy or sell on Declutter. Your conversations show up here.");
    expect(screen.getByText(/buy or sell on Declutter/)).toBeInTheDocument();
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/messages/Messages.tsx"), "utf8"));
    expect(src).toMatch(/mainEmptyBody=\{inbox\.mainEmptyBody\}/);
  });

  it("Messages.tsx hands the list the tab's threads, never the raw inbox", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/messages/Messages.tsx"), "utf8"));
    expect(src).toMatch(/conversations=\{inbox\.conversations\}/);
    expect(src).toMatch(/allConversations=\{inbox\.allConversations\}/);
    expect(src).toMatch(/sectionTabs=\{inbox\.strip\}/);
  });

  // D2-1 (audit 1028 part 2): the Declutter tab lists the member's order chats.
  const DECLUTTER_EMPTY = { icon: Sofa, title: "No Declutter messages yet", body: "b", Lead: DeclutterOrderTalkRows };
  it("D2-1: a Declutter tab with no threads hands its empty state to the order-chat list", () => {
    renderList(DECLUTTER_EMPTY);
    expect(screen.getByText("ORDER CHATS")).toBeInTheDocument();
    expect(screen.getByText("No Declutter messages yet")).toBeInTheDocument();
  });

  it("D2-1: with threads, the order chats sit above them", () => {
    render(
      <MemoryRouter>
        <ConversationList conversations={[TEAM]} loading={false} loadError={false} retryInbox={vi.fn()} userId="me"
          loadConversations={vi.fn(async () => {})} openConvo={vi.fn()} setDeleteConvoConfirm={vi.fn()} onBatchArchive={vi.fn()}
          sectionEmpty={DECLUTTER_EMPTY} />
      </MemoryRouter>,
    );
    const lead = screen.getByText("ORDER CHATS");
    // The thread rows are virtualized (drawn into the box after the list); the order chats are that container's first child.
    const box = lead.parentElement!;
    expect(box.firstElementChild, "the order chats come first").toBe(lead);
    expect(box.childElementCount, "and the threads follow in the same list").toBeGreaterThan(1);
  });
});

describe("D2-1: the Declutter chip and its order chats", () => {
  afterEach(() => { orderTalks.rows = []; });

  it("with Declutter switched off, a member with an order chat keeps the Declutter chip (row 62), and its tab carries the list", async () => {
    orderTalks.rows = [{ order_id: "o1" }];
    const { result } = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=declutter") });
    await waitFor(() => expect(result.current.section).toBe("declutter"));
    expect(result.current.sectionEmpty?.Lead).toBe(DeclutterOrderTalkRows);
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    expect(screen.getByRole("button", { name: "Declutter" })).toBeInTheDocument();
  });

  it("with no order chat and Declutter off there is still no chip; Shops never gets the list", async () => {
    const off = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=declutter") });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current.section).toBe("all");
    const shops = renderHook(() => useMessageSections([JOB], [JOB]), { wrapper: wrap("/messages?section=shops") });
    expect(shops.result.current.sectionEmpty?.Lead).toBeUndefined();
  });
});
