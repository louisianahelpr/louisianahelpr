import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { loadModule, untilReload } from "@/lib/loadModule";
import { InboxTabs, InboxTabsSlot } from "./InboxTabs";
import { inboxTabFrom, rememberInboxTab } from "./inboxTab";

// The Notifications tab (and the bell's list code under it) loads only when that tab is opened.
const InboxNotifications = lazy(() => loadModule(() => import("./InboxNotifications")).then((m) => (m ? { default: m.default } : untilReload())));

/**
 * /messages IS THE INBOX (owner 11-15: "Merge messages and notifications into one, like Vinted does"). This wraps the
 * Messages page: `?tab=notifications` draws the Notifications tab, anything else draws Messages (the default) with the
 * tabs handed to its header through InboxTabsSlot, so every /messages link, /messages?chat= thread and push tap keeps
 * landing where it did. The tab shown is remembered for the top-bar icon. Guard: src/test/inboxOneIconTwoTabs.test.tsx.
 */
export function InboxPage({ Messages }: { Messages: ComponentType }) {
  const [params] = useSearchParams();
  const tab = inboxTabFrom(params);
  useEffect(() => rememberInboxTab(tab), [tab]);
  if (tab === "notifications") {
    return (
      <Suspense fallback={null}>
        <InboxNotifications />
      </Suspense>
    );
  }
  return (
    <InboxTabsSlot.Provider value={<InboxTabs tab="messages" />}>
      <Messages />
    </InboxTabsSlot.Provider>
  );
}

/** The Messages page as the route draws it: `export default withInbox(Messages)`. */
export function withInbox(Messages: ComponentType) {
  return function Inbox() {
    return <InboxPage Messages={Messages} />;
  };
}
