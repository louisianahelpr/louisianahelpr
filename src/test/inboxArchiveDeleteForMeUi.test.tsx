/**
 * Inbox polish (owner-approved 2026-11-20, part D): the Archived chip and view,
 * the desktop row's ⋯ menu (Archive / Delete for me), the Delete-for-me
 * confirm, the resting right pane, the thread's intro line (top-anchored), and
 * the richer chat header (who they are + a link to the job).
 *
 * @mutate src/pages/messages/useMessageSections.tsx |     { value: "archived", label: t("msg.filterArchived") }, |
 * @mutate src/components/messages/messageSections.ts |   if (raw === "archived") return "archived"; |
 * @mutate src/components/messages/useConversationListState.ts |   const inboxTab = archivedView ? "recentlyDeleted" : coerceInboxView(inboxFilter); |   const inboxTab = coerceInboxView(inboxFilter);
 * @mutate src/components/messages/ConversationRowMenu.tsx |         <DropdownMenuItem onClick={() => onDeleteForMe(convo)} | <DropdownMenuItem onClick={() => onArchive(convo)}
 * @mutate src/pages/messages/useDeleteForMe.tsx |     const ok = await deleteConversationForMe(userId, convo.jobId, convo.otherUserId); |     const ok = false;
 * @mutate src/components/messages/ChatView.tsx |           {!hasMoreMessages && !chatLoading && !chatLoadError && messages.length > 0 && ( |           {false && (
 * @mutate src/components/messages/ChatHeader.tsx |   const subtitle = role ? `${role} · ${activeConvo.jobTitle}` : activeConvo.jobTitle; |   const subtitle = activeConvo.jobTitle;
 * @mutate src/components/messages/ChatHeader.tsx |           <Link to={`/jobs/${encodeURIComponent(activeConvo.jobId)}`} |           <Link to="/"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Conversation } from "@/components/messages/types";

const layout = vi.hoisted(() => ({ desktop: false }));
const deleteForMe = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => layout.desktop }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) => ({
  ...(await (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io)),
  deleteConversationForMe: deleteForMe,
}));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title, search }: { title?: string; search?: ReactNode }) => <header><h1>{title}</h1>{search}</header>,
}));
vi.mock("@/components/VirtualList", () => ({
  VirtualList: <T,>({ items, getKey, renderItem }: { items: T[]; getKey: (item: T, i: number) => string; renderItem: (item: T, i: number) => ReactNode }) => (
    <div>{items.map((it, i) => <div key={getKey(it, i)}>{renderItem(it, i)}</div>)}</div>
  ),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
// ChatHeader's deal-card reads (React Query) and safety button: not under test here.
vi.mock("@/components/messages/chatView/DealCard", () => ({
  DealCard: () => null, useDealCardShown: () => false, useDealSafetyJob: () => null, usePersonFacts: () => "",
}));
vi.mock("@/components/SosShareButton", () => ({ SafetyShieldButton: () => null }));

import { ConversationList } from "@/components/messages/ConversationList";
import { coerceInboxFilter, threadsForFilter } from "@/components/messages/messageSections";
import { useDeleteForMe } from "@/pages/messages/useDeleteForMe";
import { MessagesTwoPane } from "@/pages/messages/MessagesTwoPane";
import { ChatIntroLine } from "@/components/messages/chatView/ChatIntroLine";
import { ChatHeader } from "@/components/messages/ChatHeader";
import { safeStorage } from "@/lib/safeStorage";

afterEach(() => {
  cleanup();
  layout.desktop = false;
});

const convo = (over: Partial<Conversation> = {}): Conversation => ({
  otherUserId: "22222222-2222-2222-2222-222222222222",
  otherUserName: "Perry P.",
  jobTitle: "Fix a leaking kitchen faucet",
  jobId: "33333333-3333-3333-3333-333333333333",
  jobStatus: "open",
  viewerIsPoster: true,
  lastMessage: "See you at 3",
  lastAt: "2026-11-01T12:00:00.000Z",
  unread: 0,
  ...over,
});

/** Radix's DropdownMenu opens on a keyboard Enter in jsdom. */
function openMenu(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function list(props: Partial<Parameters<typeof ConversationList>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ConversationList
        conversations={[]}
        loading={false}
        loadError={false}
        retryInbox={vi.fn()}
        userId="11111111-1111-1111-1111-111111111111"
        loadConversations={vi.fn(async () => {})}
        openConvo={vi.fn()}
        setDeleteConvoConfirm={vi.fn()}
        onBatchArchive={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("the Archived chip", () => {
  it("is a real filter value: ?section=archived reads as Archived and lists nothing from the live inbox", () => {
    expect(coerceInboxFilter("archived", ["jobs"])).toBe("archived");
    expect(threadsForFilter([convo()], "archived")).toEqual([]);
  });

  it("on, the list shows the archive with Restore; the back arrow turns it off", () => {
    const uid = "11111111-1111-1111-1111-111111111111";
    const c = convo({ jobId: "66666666-6666-6666-6666-666666666666" });
    // The mirror shape loadArchives writes (conversationKey -> archived_at): archived after its last message.
    safeStorage.setItem(`helpr_archived_conversations_${uid}`, JSON.stringify({ [`${c.jobId}_${c.otherUserId}`]: "2026-11-02T00:00:00.000Z" }));
    // The view header (back arrow + name) is the one-pane desktop's; a phone has the chip row for the way back.
    layout.desktop = true;
    const onArchivedViewChange = vi.fn();
    list({ allConversations: [c], archivedView: true, onArchivedViewChange });
    expect(screen.getByRole("heading", { name: "Archived" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restore conversation with Perry P\./ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to all messages" }));
    expect(onArchivedViewChange).toHaveBeenCalledWith(false);
  });

  it("the menus' Archived entry turns the chip on instead of a local view", () => {
    const onArchivedViewChange = vi.fn();
    list({ conversations: [convo()], allConversations: [convo()], onArchivedViewChange });
    openMenu(screen.getByRole("button", { name: "Inbox views and options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archived" }));
    expect(onArchivedViewChange).toHaveBeenCalledWith(true);
  });
});

describe("the desktop row's ⋯ menu", () => {
  it("offers Archive and Delete for me, each opening its own confirm", () => {
    layout.desktop = true;
    const c = convo();
    const setDeleteConvoConfirm = vi.fn();
    const onDeleteForMe = vi.fn();
    list({ conversations: [c], allConversations: [c], setDeleteConvoConfirm, onDeleteForMe });
    const trigger = screen.getByRole("button", { name: "Options for the conversation with Perry P." });
    openMenu(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete for me" }));
    expect(onDeleteForMe).toHaveBeenCalledWith(c);
    openMenu(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(setDeleteConvoConfirm).toHaveBeenCalledWith(c);
  });

  it("is not on a phone (the row swipes there) nor in the Archived view (Restore is)", () => {
    const c = convo();
    list({ conversations: [c], allConversations: [c] });
    expect(screen.queryByTestId("conversation-row-menu")).toBeNull();
  });
});

describe("the Delete-for-me confirm", () => {
  function Harness({ c, closeThread }: { c: Conversation; closeThread: () => void }) {
    const { requestDeleteForMe, deleteForMeDialog } = useDeleteForMe({ userId: "11111111-1111-1111-1111-111111111111", activeConvo: c, closeThread });
    return (
      <>
        <button type="button" onClick={() => requestDeleteForMe(c)}>ask</button>
        {deleteForMeDialog}
      </>
    );
  }

  it("says what stays and only writes on the confirm; the open thread closes first", async () => {
    const c = convo();
    const closeThread = vi.fn();
    render(<Harness c={c} closeThread={closeThread} />);
    fireEvent.click(screen.getByText("ask"));
    expect(await screen.findByText("Delete this conversation for you?")).toBeInTheDocument();
    expect(screen.getByText(/Perry P\. still has it, and we keep a record for safety/)).toBeInTheDocument();
    expect(deleteForMe).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete for me" })); });
    await waitFor(() => expect(deleteForMe).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", c.jobId, c.otherUserId));
    expect(closeThread).toHaveBeenCalled();
  });
});

describe("the resting right pane", () => {
  it("is the shared empty state: Pick a conversation", () => {
    render(<MemoryRouter><MessagesTwoPane list={<div />} chat={null} hasConversations /></MemoryRouter>);
    const pane = screen.getByTestId("messages-chat-resting");
    expect(pane.textContent).toContain("Pick a conversation");
    expect(pane.textContent).toContain("It opens here, next to your inbox.");
  });
});

describe("the thread's intro line", () => {
  it("names the person and the start date", () => {
    render(<ChatIntroLine name="Perry P." firstAt="2024-03-05T15:00:00.000Z" />);
    expect(screen.getByText(/^Conversation with Perry P\. · started Mar 5, 2024$/)).toBeInTheDocument();
  });
});

describe("the chat header", () => {
  const draw = (c: Conversation) =>
    render(
      <MemoryRouter>
        <ChatHeader activeConvo={c} isOtherOnline={false} onBack={vi.fn()} onOpenMuteSheet={vi.fn()} onToggleMute={vi.fn()} onReportUser={vi.fn()} onBlockUser={vi.fn()} onViewProfile={vi.fn()} />
      </MemoryRouter>,
    );

  it("says who they are and links to the job", () => {
    draw(convo());
    expect(screen.getByText("Helpr · Fix a leaking kitchen faucet")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open the job: Fix a leaking kitchen faucet" });
    expect(link.getAttribute("href")).toBe("/jobs/33333333-3333-3333-3333-333333333333");
  });

  it("from the other side, they posted the job", () => {
    draw(convo({ viewerIsPoster: false }));
    expect(screen.getByText("Posted this job · Fix a leaking kitchen faucet")).toBeInTheDocument();
  });
});
