import { useEffect } from "react";
import NotificationPanel from "@/components/NotificationPanel";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { AppTopBar } from "@/components/sections/AppTopBar";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useLanguage } from "@/lib/i18n/language";
import { usePageTitle } from "@/hooks/usePageTitle";
import { removeShellOncePainted } from "@/components/landing/landingShell";
import { MESSAGES_SHELL_ID } from "@/components/landing/homeShell";
import { INBOX_PANEL_ID, InboxTabs } from "./InboxTabs";

/**
 * THE INBOX ON ITS NOTIFICATIONS TAB (owner 11-15). The same shell as the Messages tab (PageScaffold: the title card
 * on a phone, one panel on the desktop website), the shared top bar named "Inbox", the tabs, and the bell's own list
 * (NotificationPanel inline: the same store, loads, Unread / All, mark read and row taps; nothing rebuilt).
 * Guard: src/test/inboxOneIconTwoTabs.test.tsx.
 */
export default function InboxNotifications() {
  const isWebDesktop = useIsWebDesktop();
  const { t } = useLanguage();
  usePageTitle(`${t("inbox.title")} — Helpr`);
  // A cold /messages?tab=notifications: index.html drew the inbox loading frame first; take it away once painted.
  useEffect(() => removeShellOncePainted(MESSAGES_SHELL_ID), []);
  const tabs = <InboxTabs tab="notifications" />;
  return (
    <PageScaffold
      titleCard={isWebDesktop ? undefined : (
        <>
          <div className="shrink-0"><AppTopBar title={t("inbox.title")} desktopGap={false} /></div>
          {tabs}
        </>
      )}
      titleCardClassName={isWebDesktop ? undefined : "!py-1.5"}
    >
      {isWebDesktop && (
        <>
          <div className="shrink-0"><AppTopBar title={t("inbox.title")} desktopGap={false} /></div>
          {/* The same measure as the list under it (NotificationPanelView inline: max-w-2xl), never the full 1440 row. */}
          <div className="w-full max-w-2xl mx-auto">{tabs}</div>
        </>
      )}
      {/* Polish audit 11-27 #13: the panel runs to the bottom of the screen and the list is its one scroll; the room for
          the floating dock is the END of that scroll (NotificationPanelView inline), so the last row and the page note
          still clear the dock but no blank band sits under a short list box. */}
      <div
        role="tabpanel"
        id={INBOX_PANEL_ID}
        aria-labelledby="inbox-tab-notifications"
        data-testid="inbox-notifications"
        className="flex-1 min-h-0 flex flex-col"
      >
        <NotificationPanel inline />
      </div>
    </PageScaffold>
  );
}
