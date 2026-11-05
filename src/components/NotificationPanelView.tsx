/**
 * The bell's panel, drawn (Q806, 2026-11-05: moved verbatim out of NotificationPanel.tsx, which keeps the shared
 * store read, the loads, the realtime feed, push and the handlers in useNotificationPanelModel). Every value it reads
 * comes in as the model; it holds no state of its own.
 */
import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { prefetchOnIntent } from "@/components/notificationPanel/notificationFeed";
import { AlertTriangle, BellRing, CheckCheck, Loader2 } from "lucide-react";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { Popover, PopoverTrigger, PopoverContent, PopoverPortal, PopoverAnchor, PopoverDismissLayer } from "@/components/ui/popover";
import { AnchoredPanelHeader, AnchoredPanelSegmented, screenPanelContentClass, screenPanelContentProps } from "@/components/ui/anchoredPanel";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import type { Notification, Filter } from "@/components/notificationPanel/types";
import { timeAgo, foldByJob } from "@/components/notificationPanel/notificationPanelHelpers";
import { NotificationLeading } from "@/components/notificationPanel/NotificationLeading";
import { JobFoldToggle } from "@/components/notificationPanel/JobFoldToggle";
import { DaySection } from "@/components/notificationPanel/DaySection";
import { NotificationTrigger } from "@/components/notificationPanel/NotificationTrigger";
import { NotificationMessage } from "@/components/notificationPanel/NotificationMessage";
import type { NotificationPanelModel } from "./NotificationPanel";

/**
 * Needles for "this job was cancelled by whoever posted it" in a STORED
 * notification body. These are not copy this file prints — the bodies are
 * written by Postgres (`poster_cancel_job`, `notify_on_job_update`). Since
 * 20260925143327 they say "cancelled by the person who posted it"; rows stored
 * before it say "cancelled by the poster" and always will, so both match.
 */
const CANCELLED_BY_POSTER_NEEDLES = [
  "cancelled by the poster",
  "cancelled by the person who posted",
] as const;

export function NotificationPanelView({
  anchorRef,
  band,
  canTrigger,
  collapseExit,
  containerRef,
  destinationOf,
  enablePush,
  exitTransition,
  faces,
  filter,
  framer,
  groupedNotifications,
  handleClick,
  hasMoreThanPage,
  isActionable,
  isPulling,
  listShowable,
  loadError,
  loadNotifications,
  markAllRead,
  markAsRead,
  navigate,
  notifications,
  open,
  openFolds,
  pullDistance,
  reducedMotion,
  refreshing,
  setFilter,
  setOpen,
  setOpenFolds,
  showPushRow,
  titleId,
  triggerClassName,
  triggerRef,
  unreadCount,
  unreadTotal,
  visibleNotifications,
}: NotificationPanelModel) {
  return (
    /* `modal` is load-bearing, not decoration — and it is KEPT even though the
       scrim is gone. It is what locks the page (so the FEED can't scroll under
       an open panel — the panel's own list is the only thing that moves),
       traps focus inside the panel, and returns focus to the bell on close.
       None of those were the scrim's doing. Dismissal is still tap-outside /
       Escape via Radix's DismissableLayer, plus the explicit X in the header
       for touch. */
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <NotificationTrigger ref={triggerRef} unreadCount={unreadCount} className={triggerClassName} {...prefetchOnIntent} />
      </PopoverTrigger>
      {/* On phone/native, positioned against a measured SCREEN BAND, not
          against the bell: a zero-height rect spanning the viewport at the
          bottom edge of the header the bell sits in. On desktop web
          (2026-09-11 fix) the rect IS the bell's own — a normal anchored
          dropdown, not a band — see `measureScreenPanelBand`'s desktop
          branch. Either way the trigger still opens it; this virtual anchor
          is what decides where it lands. See `useScreenPanelBand`. */}
      <PopoverAnchor virtualRef={anchorRef} />
      {/* NO SCRIM — the page behind is neither dimmed nor blurred (owner,
          2026-08-31: "Same for this. No blur"). What is still mounted is a
          layer that PAINTS NOTHING and exists only to receive the tap that
          dismisses the panel: without it, Radix's deferred outside-dismiss
          lets the very same click land on the job card underneath and open it.
          See `PopoverDismissLayer` in `ui/popover.tsx`. Its own portal, placed
          before the Content's, the way `SheetPortal` stacks `SheetOverlay`
          under `SheetContent`. */}
      <PopoverPortal>
        <PopoverDismissLayer />
      </PopoverPortal>
      <PopoverContent
        {...screenPanelContentProps(band, { roundTopCorners: true, contentMaxWidth: 512 /* the column's max-w-lg */ })}
        aria-labelledby={titleId}
        className={screenPanelContentClass(band)}
        // Park focus on the PANEL, not on its first focusable child. Radix's
        // default would land on "Mark all as read", so opening the panel and
        // pressing Enter — or a screen reader's first move — would silently
        // clear every unread notification. Focusing the container instead
        // announces the panel, starts Tab inside it, and arms nothing. Same
        // fix, same reason, as DialogContent's onOpenAutoFocus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        {/* No caret. The panel spans the screen, so there is no edge for a
            notch to point back at the bell from (owner: "it should be anchored
            to screen").

            The wrapper below is the flex column that holds header + list +
            footer. Its children are left at the outer indent level on purpose:
            re-indenting the whole panel would bury the real change in a
            200-line whitespace diff.

            `mx-auto max-w-lg` is a CONTENT measure, not a side margin: on
            phone/native the SURFACE still runs edge to edge (that is the
            whole point of a screen-anchored band), but the rows inside it
            stop at the app's shared popup measure. Without it the Unread/All
            segmented control stretched to 1440px on the desktop website — one
            pill the width of the window, which is not a control anyone reads
            as a control. Below 512px, which is every phone the owner
            reviewed this on, the measure is wider than the screen and
            changes nothing.

            On desktop web (2026-09-11 fix) this measure is now what decides
            the whole panel's width too, not just the rows' — see
            `screenPanelContentProps`'s desktop branch in `anchoredPanel.tsx`:
            `PopoverContent` carries no forced width there, so it shrinks to
            fit this `max-w-lg` wrapper instead of the 1048px content-column
            band it used to stretch to (Q931: fixed 28rem there, edge holds). */}
        <div data-record-id="notifications-panel" className="flex-1 min-h-0 flex flex-col overflow-hidden w-full max-w-lg mx-auto [.web-desktop_&]:w-[28rem]">
        <AnchoredPanelHeader
          titleId={titleId}
          title="Notifications"
          onClose={() => setOpen(false)}
          actions={
            unreadCount > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={markAllRead} data-testid="mark-all-read"
                className="shrink-0 px-2 tracking-normal focus-visible:ring-[hsl(var(--bark))]" style={{ color: "hsl(var(--bark))" }}>
                Mark all read
              </Button>
            ) : undefined
          }
        >
          {/* ONE control, two segments — not a bare word beside a filled
              circle. The count rides the Unread segment so it says exactly
              what the bell badge said a moment ago; All carries no count
              because the fetch caps at 50 rows, and a capped number here
              would be a figure the panel can't stand behind. */}
          <AnchoredPanelSegmented<Filter>
            label="Filter notifications"
            value={filter ?? "all"}
            onChange={setFilter}
            options={[
              { key: "unread", label: "Unread", count: unreadCount },
              { key: "all", label: "All" },
            ]}
          />
        </AnchoredPanelHeader>

        <PullToRefreshWrapper
          ref={containerRef}
          pullDistance={pullDistance}
          refreshing={refreshing}
          isPulling={isPulling}
          canTrigger={canTrigger}
          className="flex-1 min-h-0 no-scrollbar overscroll-contain"
        >
          {loadError && (!listShowable || notifications.length === 0) ? (
            /* A failed initial load takes precedence over the "All caught up"
               empty state — the user must be able to tell "nothing happened"
               from "we couldn't ask".

               Deliberately NOT `<ErrorState>`: that primitive is a full
               frosted card (a ~100px glyph, an eyebrow, a headline and a
               wrapped body) sized for a whole page, and inside a ~450px
               dropdown it overflowed the scroll area — pushing "Try again",
               the one thing this state exists to offer, below the fold.
               Same scale defect the empty state above had. This mirrors that
               empty state's compact shape instead, so the recovery action is
               always visible without scrolling. */
            <div className="px-6 py-7 flex flex-col items-center text-center gap-2">
              <ReportErrorScreen source="NotificationPanel" title="Couldn't load notifications." />
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--burnt-sienna) / 0.10)",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                }}
              >
                <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
              </div>
              <p
                className="font-display font-bold leading-tight text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              >
                Couldn't load notifications.
              </p>
              <p
                className="font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Our end had a hiccup — not yours.
              </p>
              <Button
                type="button"
                variant="primary" size="sm"
                onClick={() => void loadNotifications()}
                className="mt-1"
              >
                Try again
              </Button>
            </div>
          ) : !listShowable ? (
            /* NOT ANSWERED YET. Before the first successful load an empty list
               means "we haven't heard back", and the empty state below is a
               claim about the account. Same compact shape as the two states
               either side of it, so the swap to either doesn't jump. A load
               that never answers ends in the error card above
               (LOAD_TIMEOUT_MS). */
            <div
              role="status"
              /* `aria-busy` is the MACHINE-READABLE half of "Loading
                 notifications…". Without it this state announces its text but
                 claims to be settled, and everything that waits on a screen
                 being done — assistive tech, and every harness in this repo,
                 all of which key on that attribute — reads a panel that
                 has not answered yet as a panel with nothing in it. Measured
                 on press-every-control run 35692554813: two shards walked the
                 /home bell with zero rows in it and passed, while a third
                 enumerated 50 rows and then could not find one of them. */
              aria-busy="true"
              className="px-6 py-7 flex flex-col items-center text-center gap-2"
            >
              <Loader2
                className="w-5 h-5 animate-spin motion-reduce:animate-none"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                aria-hidden="true"
              />
              <p
                className="font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Loading notifications…
              </p>
            </div>
          ) : visibleNotifications.length === 0 ? (
            /* COMPACT empty state (owner, 2026-08-30: the old one — an 80px
               circled glyph, an eyebrow, a display headline and two lines of
               italic copy, vertically centred in a `min-h-full` box — was the
               biggest thing on screen for the case where there is nothing to
               show). A panel with nothing in it should take the space of
               nothing: one small glyph, one line, one optional way out. */
            <div className="px-6 py-7 flex flex-col items-center text-center gap-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--bark) / 0.08)",
                  border: "0.5px solid hsl(var(--olivewood) / 0.14)",
                }}
              >
                <CheckCheck className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} />
              </div>
              <p
                className="font-display font-bold leading-tight text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              >
                {filter === "unread" && notifications.length > 0
                  ? "Nothing unread."
                  : "Nothing new yet."}
              </p>
              <p
                className="font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {filter === "unread" && notifications.length > 0
                  ? "Switch to All to see everything."
                  : "Applications, messages and payouts land here."}
              </p>
            </div>
          ) : (
            <div>
              {(() => {
              const sections = groupedNotifications.map((group) => (
                <DaySection key={group.key} framer={framer} exit={collapseExit} transition={exitTransition}>
                  <div
                    className="sticky top-0 z-10 px-4 py-1.5 flex items-center justify-between font-sans uppercase tracking-[0.18em] text-ds-10"
                    style={{
                      color: "hsl(var(--muted-foreground))",
                      background:
                        "linear-gradient(to bottom, hsl(var(--surface-band) / 0.92), hsl(var(--surface-band) / 0.78))",
                      backdropFilter: "blur(8px) saturate(140%)",
                      WebkitBackdropFilter: "blur(8px) saturate(140%)",
                      borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <span>{group.label}</span>
                    <span
                      className="tabular-nums font-sans text-ds-11 font-normal"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {group.items.length}
                    </span>
                  </div>
                  {/* AnimatePresence with initial={false} — only NEW
                      notifications animate in (realtime arrivals slide
                      down + fade). The first render of the sheet stays
                      static so the panel doesn't feel slow to open.
                      Before framer has loaded (see useFramerMotion) the
                      same rows render as plain divs, unwrapped. */}
                  {(() => {
                    const renderRow = (n: Notification, more: Notification[] = []) => {
                      /* A row only DRESSES as a control when a tap on it does
                         something (see `isActionable`). When it doesn't, every
                         part of the promise comes off together — the role, the
                         tab stop, the pointer cursor, the press feedback and
                         the handlers — because leaving any one of them behind
                         still tells the user "press me". The row keeps its
                         padding and min-height so the list rhythm is
                         unchanged; only the affordance goes. */
                      const actionable = isActionable(n);
                      const rowProps = {
                        "data-record-id": n.id, role: actionable ? "button" : undefined, // id: press-every-control's row identity
                        tabIndex: actionable ? 0 : undefined,
                        onClick: actionable ? () => handleClick(n) : undefined,
                        onKeyDown: actionable
                          ? (e: ReactKeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleClick(n);
                              }
                            }
                          : undefined,
                        // `min-h-[44px]`: the row is the primary tap target in
                        // this panel and must clear the HIG floor even when a
                        // notification is a single short line.
                        className: `w-full text-left px-4 py-3 min-h-[44px] transition-colors${
                          actionable ? " active:opacity-80 cursor-pointer" : ""
                        }`,
                        style: {
                          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
                        },
                      };
                      const body = (
                        <div className="flex gap-3">
                          <NotificationLeading n={n} face={n.actor_id ? faces.get(n.actor_id) : undefined} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p
                                className="min-w-0 flex-1 font-sans font-bold leading-tight truncate text-ds-15"
                                style={{
                                  color: !n.read ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.8)",
                                  letterSpacing: "-0.012em",
                                }}
                              >
                                {n.title}
                              </p>
                              {/* Colour alone cannot carry "unread" — labelled
                                  the same way ConversationRow's dot is. */}
                              {!n.read && (
                                <span
                                  role="status"
                                  aria-label="Unread"
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: "hsl(var(--bark))" }}
                                />
                              )}
                            </div>
                            <NotificationMessage text={n.message} />
                            {/* Inline quick-action pills — only for actionable
                                types so chat/review/payment rows stay clean. */}
                            {(() => {
                              const actions: { label: string; href: string }[] = [];
                              if (n.type === "expired") {
                                actions.push({ label: "Repost", href: "/post-job" });
                              } else if (
                                n.type === "warning" &&
                                // MATCHES STORED TEXT, not copy this file owns.
                                // Postgres writes these bodies; rows from before
                                // 20260925143327 say "cancelled by the poster",
                                // later ones "cancelled by the person who posted
                                // it", and both keep the pill.
                                CANCELLED_BY_POSTER_NEEDLES.some((needle) =>
                                  n.message.toLowerCase().includes(needle),
                                )
                              ) {
                                // The Helpr's copy of a poster cancellation
                                // (poster_cancel_job + notify_on_job_update both
                                // emit it). The recipient does not own the job,
                                // so "Repost" is a poster-only action offered to
                                // the wrong person — send them to the job instead.
                                const to = destinationOf(n);
                                if (to) actions.push({ label: "View", href: to });
                              } else if (
                                (n.type === "warning" || n.title === "Your Helpr cancelled") &&
                                (n.title.toLowerCase().includes("cancelled") ||
                                  n.message.toLowerCase().includes("auto-cancel"))
                              ) {
                                actions.push({ label: "Repost", href: "/post-job" });
                              } else if (
                                n.type === "job_update" &&
                                n.message.toLowerCase().includes("cancelled") &&
                                destinationOf(n)
                              ) {
                                actions.push({ label: "View", href: destinationOf(n)! });
                              }
                              if (actions.length === 0) return null;
                              return (
                                <div className="flex gap-1.5 mt-1.5">
                                  {actions.map((a) => (
                                    <button
                                      key={a.label}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void markAsRead(n.id);
                                        setOpen(false);
                                        navigate(a.href);
                                      }}
                                      className="h-9 px-3 text-ds-11 font-sans font-semibold rounded-full border transition-all active:scale-[0.94]"
                                      style={{
                                        borderColor: "hsl(var(--bark) / 0.35)",
                                        color: "hsl(var(--bark))",
                                        background: "hsl(var(--parchment) / 0.6)",
                                      }}
                                    >
                                      {a.label}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                            <p
                              className="font-sans mt-1 text-ds-11"
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                            >
                              {timeAgo(n.created_at)}
                            </p>
                            <JobFoldToggle more={more} open={openFolds.has(n.id)} onToggle={() => setOpenFolds((was) => { const next = new Set(was); if (!next.delete(n.id)) next.add(n.id); return next; })} />
                          </div>
                        </div>
                      );
                      return framer ? (
                        <framer.motion.div
                          key={n.id}
                          {...rowProps}
                          layout={!reducedMotion}
                          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                          exit={collapseExit}
                          transition={exitTransition}
                        >
                          {body}
                        </framer.motion.div>
                      ) : (
                        <div key={n.id} {...rowProps}>
                          {body}
                        </div>
                      );
                    };
                    const rows = foldByJob(group.items).flatMap(({ n, more }) => [renderRow(n, more), ...(openFolds.has(n.id) ? more.map((m) => renderRow(m)) : [])]);
                    return framer ? (
                      <framer.AnimatePresence initial={false}>{rows}</framer.AnimatePresence>
                    ) : (
                      rows
                    );
                  })()}
                </DaySection>
              ));
              return framer ? (
                <framer.AnimatePresence initial={false}>{sections}</framer.AnimatePresence>
              ) : (
                sections
              );
              })()}
            </div>
          )}
        </PullToRefreshWrapper>

        {/* The list is a page; the badge is a fact. When they differ, say so.
            The alternative — quietly shrinking the badge to match what was
            fetched — is what produced a bell reading 47 over a database
            holding 76. "Mark all read" still only claims the rows on screen,
            which is why this line names the shown count first. */}
        {hasMoreThanPage && (
          <p
            className="shrink-0 px-4 py-2 text-ds-11 font-sans text-center border-t border-[hsl(var(--olivewood)/0.12)]"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Showing {notifications.length} · {unreadTotal} unread in total
          </p>
        )}

        {/* Push opt-in lives in a footer row, outside the scroll area, rather
            than as a big button inside the empty state — it is relevant
            whether or not the list is empty, and it is the one thing here
            that changes what lands in this panel in future. */}
        {showPushRow && (
          <button
            type="button"
            onClick={enablePush}
            className="shrink-0 w-full h-11 inline-flex items-center justify-center gap-1.5 text-ds-12 font-sans font-semibold border-t border-[hsl(var(--olivewood)/0.12)] ctl-tint"
            style={{
              color: "hsl(var(--bark))",
              marginBottom: "var(--safe-area-bottom, 0px)",
            }}
          >
            <BellRing className="w-4 h-4" /> Turn on push notifications
          </button>
        )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
