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
 *
 * @mutate src/components/inbox/useInboxCounts.ts | return { messages, notifications, total: messages + notifications }; | return { messages, notifications, total: messages };
 * @mutate src/components/inbox/inboxTab.ts |   return params.get("tab") === "notifications" ? "notifications" : "messages"; |   return "messages";
 * @mutate src/App.tsx | <Route path="/notifications" element={<Navigate to="/messages?tab=notifications" replace />} /> | <Route path="/notifications" element={<Navigate to="/messages" replace />} />
 * @mutate src/components/inbox/InboxButton.tsx | onClick={() => navigate(inboxPath(lastInboxTab()))} | onClick={() => navigate(inboxPath("messages"))}
 * @mutate src/components/inbox/InboxTabs.tsx |             role="tab"\n | \n
 * @mutate src/components/inbox/withInbox.tsx |   if (tab === "notifications") { |   if (false) {
 * @mutate src/components/inbox/InboxTabs.tsx |     rememberInboxTab(next);\n | \n
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
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
// The tab bodies are the existing screens, drawn elsewhere: stubbed so this file checks the Inbox itself.
vi.mock("@/components/NotificationPanel", () => ({ default: ({ inline }: { inline?: boolean }) => <div data-testid="bell-list" data-inline={inline ? "" : undefined} /> }));
vi.mock("@/components/sections/AppTopBar", () => ({ AppTopBar: ({ title }: { title?: string }) => <header data-testid="app-top-bar">{title}</header> }));

import InboxButton from "@/components/inbox/InboxButton";
import { InboxTabs, useInboxTabsSlot } from "@/components/inbox/InboxTabs";
import { InboxPage } from "@/components/inbox/withInbox";
import InboxNotifications from "@/components/inbox/InboxNotifications";
import { inboxPath, inboxTabFrom, lastInboxTab, rememberInboxTab } from "@/components/inbox/inboxTab";
import { __resetNotificationStore, setNotificationUser, setUnreadTotal } from "@/components/notificationPanel/notificationStore";
import { enCore } from "@/lib/i18n/enCore";

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
    expect(screen.getByTestId("app-top-bar").textContent).toBe("Inbox");
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
