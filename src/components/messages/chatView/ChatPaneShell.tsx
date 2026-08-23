import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";

/**
 * Shell wrapper for the chat surface. Standalone (mobile/native) it owns
 * the AppShell fixed-viewport lock + centered column; embedded (desktop
 * two-pane) it's just a flex column that fills its parent pane.
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
 * AppShell's header slot so it stays pinned while the thread scrolls under
 * it, and — per AppShell's contract — it must own the top safe-area inset
 * itself, since the wrapper is a transparent positioning shell only.
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
      <div className="flex-1 min-h-0 flex flex-col px-4">
        {header}
        {children}
      </div>
    );
  }
  return (
    // Fixed-viewport lock comes from AppShell, the single shell primitive.
    // `scrollable={false}` because the chat body manages its own scroll
    // (chatContainerRef); the message input bleeds to the safe-area bottom
    // rather than reserving dock space.
    <AppShell
      header={header}
      scrollable={false}
      reserveBottomNav={false}
      className="bg-premium-page"
    >
      <div className="container mx-auto px-5 lg:px-8 xl:px-12 pt-0 flex-1 min-h-0 flex flex-col">
        <div className="w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex-1 min-h-0 flex flex-col">
          {children}
        </div>
      </div>
    </AppShell>
  );
}
