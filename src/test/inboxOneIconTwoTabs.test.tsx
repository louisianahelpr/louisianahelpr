/**
 * ONE INBOX: ONE ICON, ONE BADGE, TWO TABS (owner 11-15: "Merge messages and notifications into one, like Vinted does").
 *
 *  - The top bar (phone AppTopBar, desktop DesktopTopNav) has ONE Inbox icon in place of the Messages button and the
 *    bell. Its badge is unread message threads + unread notifications, read from the two shared stores (the Q103
 *    messages store, which already holds the shop chats, S2-016; the bell's notification store): no read of its own.
 *  - /messages is the Inbox. Its tabs are "Messages N" and "Notifications N", a real tablist (role tablist / tab,
 *    aria-selected), each tab 44px. Messages is the default; ?tab=notifications opens Notifications, so links can
 *    target a tab; /notifications lands on that tab; /messages, /messages?chat= and every push link land as before.
 *  - The icon opens the tab the member last viewed.
 *  - Both tabs wear ONE header (owner 11-15, "Polish, then launch"): the visible title "Inbox", then the tabs. On the
 *    Messages tab the search row sits UNDER the tabs (never the top row above them), its section chips under it. The
 *    browser tab says "Inbox — Helpr" on both tabs, in Spanish too. The loading frame draws the same order.
 *  - The desktop rail's row is "Inbox" (src/test/desktopLeftSidebar.test.tsx presses it: last tab, combined badge).
 *
 * @mutate src/components/inbox/useInboxCounts.ts | return { messages, notifications, total: messages + notifications }; | return { messages, notifications, total: messages };
 * @mutate src/components/inbox/inboxTab.ts |   return params.get("tab") === "notifications" ? "notifications" : "messages"; |   return "messages";
 * @mutate src/App.tsx | <Route path="/notifications" element={<Navigate to="/messages?tab=notifications" replace />} /> | <Route path="/notifications" element={<Navigate to="/messages" replace />} />
 * @mutate src/components/inbox/InboxButton.tsx | onClick={() => navigate(inboxPath(lastInboxTab()))} | onClick={() => navigate(inboxPath("messages"))}
 * @mutate src/components/inbox/InboxTabs.tsx |             role="tab"\n | \n
 * @mutate src/components/inbox/withInbox.tsx |   if (tab === "notifications") { |   if (false) {
 * @mutate src/components/inbox/InboxTabs.tsx |     rememberInboxTab(next);\n | \n
 * @mutate src/components/messages/ConversationList.tsx |   const listTitle = inInbox ? t("inbox.title") : t("msg.title"); |   const listTitle = t("msg.title");
 * @mutate src/components/messages/ConversationList.tsx | search={isWebDesktop \|\| inInbox ? undefined : phoneSearchRow} /> | search={isWebDesktop ? undefined : phoneSearchRow} />
 * @mutate src/components/messages/ConversationList.tsx |       {inInbox && <div className="shrink-0 pt-2">{phoneSearchRow}</div>}\n | \n
 * @mutate src/pages/messages/useMessagesPageSetup.ts |   usePageTitle(`${t("inbox.title")} — Helpr`); |   usePageTitle("Messages — Helpr");
 * @mutate src/components/inbox/InboxNotifications.tsx |   usePageTitle(`${t("inbox.title")} — Helpr`); |   usePageTitle(`${t("inbox.notifications")} — Helpr`);
 * @mutate src/components/MessagesRouteSkeleton.tsx |             <header className={TITLE_TOP_ROW} aria-hidden> |             <header className="app-top-bar flex items-center gap-1 pt-2 pb-0.5" aria-hidden>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const unread = vi.hoisted(() => ({ messages: 0 }));
vi.mock("@/components/mobileNav/navUnreadStore", async (orig) => ({ ...(await orig<object>()), useSharedUnreadCount: () => unread.messages }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-inbox" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
// The real conversation list under the Inbox (its thread stores offline; no backend).
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/lib/pinnedConversations", async (io) => (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) => (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
// The tab bodies are the existing screens, drawn elsewhere: stubbed so this file checks the Inbox itself.
vi.mock("@/components/NotificationPanel", () => ({ default: ({ inline }: { inline?: boolean }) => <div data-testid="bell-list" data-inline={inline ? "" : undefined} /> }));
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title, search }: { title?: string; search?: import("react").ReactNode }) => (
    <header data-testid="app-top-bar"><span data-testid="app-top-bar-title">{title}</span>{search}</header>
  ),
}));

import InboxButton from "@/components/inbox/InboxButton";
import { InboxTabs, useInboxTabsSlot } from "@/components/inbox/InboxTabs";
import { InboxPage } from "@/components/inbox/withInbox";
import InboxNotifications from "@/components/inbox/InboxNotifications";
import { inboxPath, inboxTabFrom, lastInboxTab, rememberInboxTab } from "@/components/inbox/inboxTab";
import { __resetNotificationStore, setNotificationUser, setUnreadTotal } from "@/components/notificationPanel/notificationStore";
import { enCore } from "@/lib/i18n/enCore";
import { ConversationList } from "@/components/messages/ConversationList";
import { useMessagesPageSetup } from "@/pages/messages/useMessagesPageSetup";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
/** Messages' header, as ConversationList draws it: the Inbox tabs from the slot, then its own list. */
function StubMessages() {
  const tabs = useInboxTabsSlot();
  return <div data-testid="messages-page">{tabs}</div>;
}
const at = (url: string, el: JSX.Element) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="*" element={<>{el}<Where /></>} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  unread.messages = 0;
  __resetNotificationStore();
  localStorage.clear();
});
afterEach(cleanup);

describe("the Inbox icon: one control, one combined badge", () => {
  it("the badge is unread message threads + unread notifications, and its name holds the count", () => {
    unread.messages = 3;
    act(() => { setNotificationUser("u-inbox"); setUnreadTotal(4); });
    at("/home", <InboxButton />);
    const icon = screen.getByTestId("top-bar-inbox");
    expect(icon.querySelector('[data-top-bar-badge="inbox"]')?.textContent).toBe("7");
    expect(icon.getAttribute("aria-label")).toBe("Inbox, 7 unread");
    expect(icon.className).toMatch(/\bh-11\b/); // iconCompact: 44px
  });

  it("no badge at 0, and a notification store bound to another account counts nothing", () => {
    act(() => { setNotificationUser("someone-else"); setUnreadTotal(5); });
    at("/home", <InboxButton />);
    const icon = screen.getByTestId("top-bar-inbox");
    expect(icon.querySelector("[data-top-bar-badge]")).toBeNull();
    expect(icon.getAttribute("aria-label")).toBe("Inbox");
  });

  it("opens the tab the member last viewed (Messages when none)", () => {
    at("/home", <InboxButton />);
    fireEvent.click(screen.getByTestId("top-bar-inbox"));
    expect(screen.getByTestId("where").textContent).toBe("/messages");
    cleanup();
    rememberInboxTab("notifications");
    at("/home", <InboxButton />);
    fireEvent.click(screen.getByTestId("top-bar-inbox"));
    expect(screen.getByTestId("where").textContent).toBe("/messages?tab=notifications");
  });

  it("reads only the shared stores: no request, no store of its own (Q103 badge, shop-chat badge one read)", () => {
    for (const f of ["src/components/inbox/InboxButton.tsx", "src/components/inbox/useInboxCounts.ts", "src/components/inbox/InboxTabs.tsx"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/integrations\/supabase|useQuery|useNavUnreadCount\(/);
    }
    const counts = code("src/components/inbox/useInboxCounts.ts");
    expect(counts).toContain("useSharedUnreadCount(userId)");
    expect(counts).toContain("bellUnreadCount(notifState)");
    // Both bars draw it, and neither draws the bell or the phone's Messages button any more.
    expect(code("src/components/sections/AppTopBar.tsx")).toContain("<TopBarInbox />");
    expect(code("src/components/sections/AppTopBar.tsx")).not.toMatch(/NotificationBell|top-bar-messages|top-bar-bell/);
    expect(code("src/components/DesktopTopNav.tsx")).toContain("<InboxButton />");
    expect(code("src/components/DesktopTopNav.tsx")).not.toMatch(/NotificationBell/);
  });
});

describe("the Inbox page: two tabs, deep links by ?tab=", () => {
  it("the URL names the tab: only ?tab=notifications is Notifications; Messages is the bare path", () => {
    expect(inboxTabFrom("?tab=notifications")).toBe("notifications");
    expect(inboxTabFrom("")).toBe("messages");
    expect(inboxTabFrom("?chat=1&job=j1")).toBe("messages");
    expect(inboxTabFrom("?tab=bogus")).toBe("messages");
    expect(inboxPath("notifications")).toBe("/messages?tab=notifications");
    expect(inboxPath("messages")).toBe("/messages");
  });

  it("/messages draws Messages with the tabs in its header, Messages selected, each tab with its own count", () => {
    unread.messages = 2;
    act(() => { setNotificationUser("u-inbox"); setUnreadTotal(5); });
    at("/messages", <InboxPage Messages={StubMessages} />);
    const page = screen.getByTestId("messages-page");
    const list = screen.getByRole("tablist", { name: "Inbox sections" });
    expect(page.contains(list)).toBe(true);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Messages, 2 unread", "Notifications, 5 unread"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    for (const t of tabs) expect(t.className, "44px tab").toMatch(/\bmin-h-11\b/);
    expect(lastInboxTab()).toBe("messages");
  });

  it("?tab=notifications draws the bell's own list inline under the same tabs, Notifications selected", async () => {
    at("/messages?tab=notifications", <InboxPage Messages={StubMessages} />);
    const list = await screen.findByTestId("bell-list");
    expect(list.hasAttribute("data-inline")).toBe(true);
    expect(screen.queryByTestId("messages-page")).toBeNull();
    expect(screen.getByRole("tab", { name: "Notifications" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").contains(list)).toBe(true);
    expect(lastInboxTab()).toBe("notifications");
  });

  it("the Notifications screen mounts the tabs and the inline list under the shared top bar named Inbox", () => {
    at("/messages?tab=notifications", <InboxNotifications />);
    expect(screen.getByTestId("app-top-bar-title").textContent).toBe("Inbox");
    expect(screen.getByRole("tablist", { name: "Inbox sections" })).toBeTruthy();
    expect(screen.getByTestId("bell-list").hasAttribute("data-inline")).toBe(true);
  });

  it("choosing a tab writes ?tab= and remembers it; the arrow keys move between tabs", () => {
    at("/messages", <InboxTabs tab="messages" />);
    fireEvent.click(screen.getByRole("tab", { name: "Notifications" }));
    expect(screen.getByTestId("where").textContent).toBe("/messages?tab=notifications");
    expect(lastInboxTab()).toBe("notifications");
    cleanup();
    at("/messages?tab=notifications", <InboxTabs tab="notifications" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Notifications" }), { key: "ArrowLeft" });
    expect(screen.getByTestId("where").textContent).toBe("/messages");
    expect(lastInboxTab()).toBe("messages");
  });

  it("/notifications lands on the Notifications tab; /messages keeps its route", () => {
    const app = code("src/App.tsx");
    expect(app).toContain('<Route path="/notifications" element={<Navigate to="/messages?tab=notifications" replace />} />');
    expect(app).toMatch(/<Route path="\/messages" element=\{[^\n]*<Messages \/>/);
    expect(code("src/pages/messages/Messages.tsx")).toContain("export default withInbox(Messages);");
  });

  it("every new label has its Spanish", () => {
    const keys = Object.keys(enCore).filter((k) => k.startsWith("inbox."));
    expect(keys.length).toBeGreaterThan(4);
    const es = code("src/lib/i18n/es.ts");
    for (const k of keys) expect(es, k).toContain(`"${k}":`);
  });
});


/** The real Messages list, as the Inbox draws it on a phone (one thread, the section chips present). */
function RealMessages() {
  return (
    <ConversationList
      conversations={[{ otherUserId: "u2", otherUserName: "Perry P.", jobTitle: "Fix a faucet", jobId: "job-1", viewerIsPoster: true, lastMessage: "On my way", lastAt: new Date().toISOString(), unread: 1 }]}
      loading={false}
      loadError={false}
      retryInbox={vi.fn()}
      userId="u-inbox"
      loadConversations={vi.fn(async () => {})}
      openConvo={vi.fn()}
      setDeleteConvoConfirm={vi.fn()}
      onBatchArchive={vi.fn()}
      sectionTabs={<div>SECTION CHIPS</div>}
    />
  );
}
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("both tabs share one header (owner 11-15, Polish, then launch)", () => {
  afterEach(() => __resetLangForTests());

  it("the Messages tab is titled Inbox, its search row sits under the tabs (never in the top row), the chips under it", () => {
    at("/messages", <InboxPage Messages={RealMessages} />);
    const bar = screen.getByTestId("app-top-bar");
    expect(screen.getByTestId("app-top-bar-title").textContent).toBe("Inbox");
    const search = screen.getByTestId("messages-search-row");
    expect(bar.contains(search), "no search in the top row").toBe(false);
    const tabs = screen.getByRole("tablist", { name: "Inbox sections" });
    const chips = screen.getByTestId("messages-section-tabs");
    expect(before(bar, tabs) && before(tabs, search) && before(search, chips)).toBe(true);
  });

  it("outside the Inbox (no tabs) the list keeps its own Messages header with the search in the bar", () => {
    at("/admin", <RealMessages />);
    expect(screen.getByTestId("app-top-bar-title").textContent).toBe("Messages");
    expect(screen.getByTestId("app-top-bar").contains(screen.getByTestId("messages-search-row"))).toBe(true);
  });

  it("the browser tab says Inbox on both tabs, and Bandeja de entrada in Spanish", async () => {
    function MessagesTitle() {
      useMessagesPageSetup();
      return null;
    }
    at("/messages", <MessagesTitle />);
    expect(document.title).toBe("Inbox — Helpr");
    cleanup();
    document.title = "";
    at("/messages?tab=notifications", <InboxNotifications />);
    expect(document.title).toBe("Inbox — Helpr");
    cleanup();
    await act(async () => { setLang("es"); await ensureLangLoaded(); });
    at("/messages", <MessagesTitle />);
    expect(document.title).toBe("Bandeja de entrada — Helpr");
    cleanup();
    document.title = "";
    at("/messages?tab=notifications", <InboxNotifications />);
    expect(document.title).toBe("Bandeja de entrada — Helpr");
  });

  it("the loading frame draws the same order: the visible-title row, the tabs, the search, the chips", () => {
    const sk = code("src/components/MessagesRouteSkeleton.tsx");
    const phone = sk.slice(sk.indexOf("function PhoneHeaderBones"), sk.indexOf("function DesktopHeaderBones"));
    expect(phone).toContain("<header className={TITLE_TOP_ROW} aria-hidden>");
    expect(phone).not.toContain("COMPACT_TOP_ROW");
    const order = ["<header className={TITLE_TOP_ROW}", 'data-testid="messages-skeleton-inbox-tabs"', 'data-testid="messages-skeleton-search"', "<ChipBones />"].map((x) => phone.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
