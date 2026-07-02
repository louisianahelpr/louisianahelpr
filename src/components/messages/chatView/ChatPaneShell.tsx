import type { ReactNode } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";

/**
 * Shell wrapper for the chat surface. Standalone (mobile/native) it owns
 * the AppShell fixed-viewport lock + centered column; embedded (desktop
 * two-pane) it's just a flex column that fills its parent pane.
 */
export function ChatPaneShell({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  if (embedded) {
    return <div className="flex-1 min-h-0 flex flex-col">{children}</div>;
  }
  return (
    // Fixed-viewport lock + safe-area-top header inset come from AppShell,
    // the single shell primitive. `scrollable={false}` because the chat
    // body manages its own scroll (chatContainerRef); the message input
    // bleeds to the safe-area bottom rather than reserving dock space.
    <AppShell
      header={<DashboardHeader />}
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
