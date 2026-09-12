import type { ReactNode } from "react";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { useIsWebDesktop } from "@/components/DesktopSidebarNav";

/**
 * Shell wrapper for the chat surface. Standalone it renders through
 * PageScaffold — AppShell's fixed-viewport lock plus the bordered panel every
 * other authed page wears; embedded (desktop two-pane) it's just a flex column
 * that fills its parent pane.
 *
 * An open thread has NO app nav bar. It used to render `<DashboardHeader />`
 * — the "Helpr · LA" bar with the shield and bell — directly above the chat
 * header, so a conversation carried two stacked bars before a single message.
 * iOS doesn't do that: entering a conversation replaces the app chrome with
 * the conversation's own header, and the way back out is the back button
 * rather than the global nav. The bottom nav was already suppressed here
 * (`reserveBottomNav={false}`); this makes the top consistent with it.
 *
 * `header` is therefore the CHAT header, handed in by ChatView. It goes to
 * the shell's header slot (PageScaffold forwards it to AppShell) so it stays
 * pinned while the thread scrolls under it, and — per AppShell's contract —
 * it must own the top safe-area inset itself, since the wrapper is a
 * transparent positioning shell only.
 */
export function ChatPaneShell({
  embedded,
  header,
  children,
}: {
  embedded: boolean;
  header?: ReactNode;
  children: ReactNode;
}) {
  // WHERE THE CHAT HEADER GOES DEPENDS ON WHETHER THE PAGE ALREADY HAS A TOP
  // BAR, and that is a CSS fact, not a preference. On `html.web-desktop
  // .app-shell`, index.css promotes `.app-shell-header` to
  // `position: fixed; top: 0; left: 0; right: 0` so it spans the whole
  // viewport above the sidebar rail — correct for a page whose own header IS
  // the top bar, and wrong here, because the desktop website also renders
  // DesktopTopNav in exactly that band. Handing the chat header to AppShell's
  // slot on desktop therefore parked it underneath the app's nav: the thread
  // rendered with no back button and no name (owner: "where is the rest of
  // the message info? back button? name? wtf"). That regressed the moment the
  // desktop two-pane split was removed, because until then this branch never
  // ran on desktop.
  //
  // So on desktop the header renders INLINE, as the first child of the column,
  // beneath the nav that already exists. On phone/native — where there is no
  // DesktopTopNav and the chat legitimately replaces the app chrome — it stays
  // in AppShell's slot, pinned while the thread scrolls under it.
  const isWebDesktop = useIsWebDesktop();
  const headerInSlot = isWebDesktop ? undefined : header;

  if (embedded) {
    // Desktop two-pane: the chat header belongs inside the pane, above the
    // thread. No safe-area concerns — it isn't against the status bar.
    return (
      // `px-4` is load-bearing, not decoration. The phone branch below gets its
      // horizontal gutter from AppShell's container; this branch had NONE, so
      // the composer's controls ran flush to the pane's edge and the send
      // button — the last thing in the row — was sliced by the pane's own
      // overflow clip (owner: "doesn't fit very well"). The header and thread
      // take the same gutter so the whole column shares one edge.
      //
      // `--chat-gutter` MIRRORS that padding. The composer dock cancels it with
      // a negative inline margin and re-applies it as its own padding, so the
      // frosted bar reaches the pane's edges while its controls keep the same
      // gutter as the bubbles above them. See CHAT_GUTTER_BLEED in ChatComposer.
      <div className="flex-1 min-h-0 flex flex-col px-4 [--chat-gutter:1rem]">
        {header}
        {children}
      </div>
    );
  }

  return (
    // THE THREAD WEARS THE SAME PANEL AS ITS NEIGHBOURS. This branch used to
    // render AppShell directly with a bare centered column, so the open
    // conversation was the ONE authed screen painted straight onto the page
    // canvas — no card, no border, and a composer whose white band simply
    // stopped in mid-air. Measured at 1440: `.page-panel` count 1 on
    // /my-jobs, /my-posts and the Messages INBOX (which is itself a
    // PageScaffold), 0 here.
    //
    // PageScaffold is that panel, and it is a thin wrapper over AppShell —
    // same 100dvh lock, same `scrollable={false}`, same `reserveBottomNav`
    // treatment, same `bg-premium-page` — so nothing about the fixed-viewport
    // behaviour changes. No title card: the conversation's own header is the
    // page title, and a second one stating the same thing is the stacked-bar
    // problem this file already removed.
    //
    // `header` still goes to the shell's header slot on phone/native (pinned,
    // owning the safe-area inset) and renders inline on desktop, for the
    // reason spelled out above.
    <PageScaffold header={headerInSlot}>
      {/* `--chat-gutter` must track the `px-*` on this same element, exactly
          as it did on the old page container: the composer dock cancels it
          with a negative inline margin and re-applies it as its own padding,
          so the frosted bar reaches the panel's edges while its controls stay
          aligned with the bubbles above them. See CHAT_GUTTER_BLEED in
          ChatComposer.

          `px-3` is not a fresh number — it is the inbox's own inner gutter
          (ConversationList's list body, same panel, same page), so the two
          Messages screens inset their content from the card by the same
          amount. The page container's old 1.25/2/3rem ramp was a PAGE gutter
          and was 20px too generous to re-use inside a card: at 375 it pushed
          the composer's controls to x=40 and clipped the "Type a message…"
          placeholder mid-word. */}
      <div className="flex-1 min-h-0 flex flex-col px-3 [--chat-gutter:0.75rem]">
        {isWebDesktop ? header : null}
        {children}
      </div>
    </PageScaffold>
  );
}
