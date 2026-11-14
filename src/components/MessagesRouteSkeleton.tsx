import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPACT_TOP_ROW } from "@/components/sections/browseHeaderSpacing";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { ScreenHeaderRow, COMPACT_HEADER_ROW_MIN_HEIGHT } from "@/components/ui/ScreenHeaderRow";
import { PageTitleBar, useHeaderInDesktopBar } from "@/components/header/PageTitleBar";
import { MessageThreadSkeleton } from "@/components/ui/skeletons/MessageThreadSkeleton";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { MESSAGES_LIST_PANE_PX, useMessagesTwoPane } from "@/pages/messages/useTwoPane";

/**
 * The /messages route fallback (Q2705 B, lead 11-05 8:30 PM): what a cold open paints while the Messages chunk
 * downloads. It used to be the generic RouteSuspenseFallback, so the screen went blank -> inbox frame -> rows.
 *
 * It is the inbox's OWN loading frame (ConversationList with `loading`), in each of its three layouts:
 *   - phone and native: PageScaffold's title card holding the AppTopBar's compact row (owner 11-14: the h-11 search
 *     pill with the bell and the photo inline, "Messages" a hidden h1) and the filter chips (36px, pt-1 pb-1.5); six
 *     MessageThreadSkeleton rows (ConversationListBody's own loading branch);
 *   - the desktop website below the two-pane width: ONE panel whose first row is the compact ScreenHeaderRow
 *     (34px, 28px icons) under a hairline, then the chips, then the rows;
 *   - the two-pane desktop (useMessagesTwoPane, >= 1140px): MessagesTwoPane's 360px list pane wearing the phone
 *     header, the chat pane empty.
 * Every height is the real component's: the row bones ARE MessageThreadSkeleton, the row frame is ScreenHeaderRow
 * itself, the top bar goes through PageTitleBar (on the desktop website the real "Messages" title lands in the global
 * bar exactly as AppTopBar puts it). Import-light on purpose: no Supabase, no NotificationPanel (bones stand in for
 * the bell and the photo). Guard: src/test/messagesRouteSkeletonMatchesInbox.test.tsx.
 */

/** ConversationList's MESSAGES_HEADER_PADDING (the title card's vertical padding); the guard holds them equal. */
export const MESSAGES_SKELETON_HEADER_PADDING = "!py-1.5 lg:!py-2";

/** The six rows ConversationListBody draws while the inbox loads (a floor that fills a 375 panel), in its own
 *  `flex-1 min-h-0 px-3 py-3` scroller box. */
function RowBones() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden px-3 py-3" data-testid="messages-skeleton-rows">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <MessageThreadSkeleton key={i} />
      ))}
    </div>
  );
}

/** The filter chips (useMessageSections' strip: All, Unread, then a section or two), 36px each. */
function ChipBones() {
  return (
    <div className="shrink-0 pt-1 pb-1.5" data-testid="messages-skeleton-chips" aria-hidden>
      <div className="flex gap-2 overflow-hidden">
        {["w-12", "w-[4.75rem]", "w-14"].map((w, i) => (
          <Skeleton key={i} className={`h-9 ${w} shrink-0 rounded-full`} />
        ))}
      </div>
    </div>
  );
}

/** One 44px control box with its glyph-sized bone, as the help / bell / photo buttons are. */
function ControlBone({ round }: { round?: boolean }) {
  return (
    <span className="h-11 w-11 shrink-0 flex items-center justify-center">
      <Skeleton className={round ? "h-9 w-9 rounded-full" : "h-6 w-6 rounded-full"} />
    </span>
  );
}

/** The phone header (also the two-pane list pane's): AppTopBar's row, the search row, the chips. */
function PhoneHeaderBones() {
  return (
    <>
      <div className="shrink-0">
        <PageTitleBar
          title="Messages"
          desktopGap={false}
          phone={
            // The compact top (owner 11-14): ONE row, the search with the bell and the photo inline on its right.
            <header className={COMPACT_TOP_ROW} aria-hidden>
              <span className="sr-only">Messages</span>
              <div className="min-w-0 flex-1" data-testid="messages-skeleton-search">
                <Skeleton className="h-11 w-full rounded-full" />
              </div>
              <div className="flex items-center shrink-0">
                {/* Messages, the bell (owner 11-14), then the photo. */}
                <ControlBone />
                <ControlBone />
                <ControlBone round />
              </div>
            </header>
          }
        />
      </div>
      <ChipBones />
    </>
  );
}

/** The desktop website's in-panel header below the two-pane width: ScreenHeaderRow, compact, three 28px icons. */
function DesktopHeaderBones() {
  return (
    <div className="shrink-0 px-5 py-1" style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}>
      <ScreenHeaderRow
        title="Messages"
        titleSrOnly
        className="shrink-0 max-[359px]:gap-2 [&>div:first-child]:!py-0"
        style={{ minHeight: COMPACT_HEADER_ROW_MIN_HEIGHT }}
        actions={
          <>
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-7 w-7 flex items-center justify-center" aria-hidden>
                <Skeleton className="h-3.5 w-3.5 rounded" />
              </span>
            ))}
          </>
        }
      />
      <ChipBones />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  // The screen's one <h1> while pending wherever the real one is not in the desktop bar.
  const titleInBar = useHeaderInDesktopBar();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-testid="messages-route-skeleton">
      {!titleInBar && <h1 className="sr-only">Messages</h1>}
      <span className="sr-only">Loading messages…</span>
      {children}
    </div>
  );
}

const MessagesRouteSkeleton = () => {
  const isWebDesktop = useIsWebDesktop();
  const twoPane = useMessagesTwoPane();
  if (twoPane) {
    return (
      <Frame>
        <PageScaffold flushRight>
          <div className="flex-1 min-h-0 flex">
            <div className="shrink-0 min-h-0 flex flex-col border-r border-border" style={{ width: MESSAGES_LIST_PANE_PX }}>
              <div className="flex-1 min-h-0 flex flex-col px-4 pt-2">
                <div className="relative flex-1 min-h-0 flex flex-col">
                  <PhoneHeaderBones />
                  <RowBones />
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0" />
          </div>
        </PageScaffold>
      </Frame>
    );
  }
  return (
    <Frame>
      <PageScaffold
        titleCard={isWebDesktop ? undefined : <PhoneHeaderBones />}
        titleCardClassName={isWebDesktop ? undefined : MESSAGES_SKELETON_HEADER_PADDING}
      >
        {isWebDesktop && <DesktopHeaderBones />}
        <RowBones />
      </PageScaffold>
    </Frame>
  );
};

export default MessagesRouteSkeleton;
