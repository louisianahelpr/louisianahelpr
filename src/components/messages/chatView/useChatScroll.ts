import { useCallback, useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import type { Conversation, Message } from "../types";
import { resolveFirstUnreadTargetId } from "./chatViewHelpers";

/**
 * Owns the chat thread's scroll behavior — the scroll-position observer
 * (jump-to-newest + first-unread offscreen tracking), the reset on
 * conversation change, the keyboard-open re-anchor, the pull-to-refresh
 * wiring, and the merged thread ref. Extracted verbatim from ChatView.
 */
export function useChatScroll({
  activeConvo,
  messages,
  userId,
  keyboardInset,
  onRefreshThread,
  chatContainerRef,
}: {
  activeConvo: Conversation;
  messages: Message[];
  userId: string | null;
  keyboardInset: number;
  onRefreshThread: () => Promise<void>;
  chatContainerRef: Ref<HTMLDivElement>;
}) {
  // Tracks whether the user is scrolled far enough from the bottom that
  // we should show a "jump to newest" affordance. `true` = show button.
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // Stable ref to the scroll container for the jump handler and the
  // scroll-position observer.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Live "is the user parked near the newest message" flag, updated by the
  // scroll observer below. Read by the keyboard-open effect so we only
  // re-anchor to the bottom when the user wasn't scrolled up reading
  // history. A ref (not state) so the effect closure always sees the
  // latest value without re-subscribing.
  const nearBottomRef = useRef(true);

  // First unread inbound message — captured ONCE when the conversation
  // opens, BEFORE the openConvo flow optimistically marks rows read.
  // The conversation row's `unread` count tells us how many trailing
  // inbound messages were unread; the first of those is the jump target.
  // Used by the "Jump to new messages" chip when the user is scrolled
  // above the first unread.
  const initialFirstUnreadIdRef = useRef<string | null>(null);
  const initialUnreadCountRef = useRef(0);
  // Snapshot whenever the open conversation changes — the unread count
  // on `activeConvo` is the pre-open count from the inbox refresh.
  useEffect(() => {
    initialFirstUnreadIdRef.current = null;
    initialUnreadCountRef.current = activeConvo.unread ?? 0;
  }, [activeConvo.jobId, activeConvo.otherUserId, activeConvo.unread]);
  // Resolve the first-unread id once messages for this thread arrive. We
  // look at the LAST N inbound (where N == unread count) and take the
  // earliest as the jump target — these are the unread messages the user
  // hasn't seen yet. Subsequent renders skip the lookup until the
  // conversation changes again.
  if (
    initialFirstUnreadIdRef.current === null &&
    initialUnreadCountRef.current > 0 &&
    messages.length > 0 &&
    userId
  ) {
    initialFirstUnreadIdRef.current = resolveFirstUnreadTargetId(
      messages,
      userId,
      initialUnreadCountRef.current,
    );
  }
  // Tracks whether the first-unread message is currently scrolled off
  // screen (above the viewport). Drives the "Jump to new messages" chip.
  const [firstUnreadOffscreen, setFirstUnreadOffscreen] = useState(false);

  // Pull-to-refresh for the chat thread — reuses the same hook +
  // wrapper every other scrollable surface uses. The hook owns its own
  // `containerRef`; the page also needs a handle on the scroll node
  // (for scroll-position preservation when loading older messages), so
  // a merged callback ref points both at the single thread element.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } =
    usePullToRefresh({ onRefresh: onRefreshThread });

  const setThreadRef = useCallback(
    (node: HTMLDivElement | null) => {
      // The hook ref is typed read-only; it is a plain useRef under the
      // hood, so assigning through a mutable cast is safe here.
      (containerRef as { current: HTMLDivElement | null }).current = node;
      if (typeof chatContainerRef === "function") {
        chatContainerRef(node);
      } else if (chatContainerRef) {
        (chatContainerRef as { current: HTMLDivElement | null }).current = node;
      }
      // Keep our own stable reference for the jump-to-bottom handler.
      scrollContainerRef.current = node;
    },
    [containerRef, chatContainerRef],
  );

  // Track scroll position to show/hide the jump-to-newest button.
  // 120px from the bottom is the threshold — any further up and the
  // button appears so the user can get back without scrolling manually.
  // Also tracks whether the first-unread anchor (if any) is above the
  // current viewport, which drives the "Jump to new messages" chip.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToBottom(distFromBottom > 120);
      nearBottomRef.current = distFromBottom <= 120;
      const firstUnreadId = initialFirstUnreadIdRef.current;
      if (firstUnreadId) {
        const node = el.querySelector<HTMLDivElement>(
          `[data-msg-id="${firstUnreadId}"]`,
        );
        if (node) {
          const containerRect = el.getBoundingClientRect();
          const nodeRect = node.getBoundingClientRect();
          // "Above the viewport" = its bottom is above the container's top.
          setFirstUnreadOffscreen(nodeRect.bottom < containerRect.top);
        } else {
          setFirstUnreadOffscreen(false);
        }
      } else {
        setFirstUnreadOffscreen(false);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Initial pass once mounted so the chip can appear without requiring
    // a scroll event first (e.g. when the conversation opens scrolled at
    // the top by an external anchor).
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  /* LAND ON THE FIRST UNREAD MESSAGE, not the bottom (owner, 2026-09-16:
     "messages should open to the unread messages").

     Opening a thread always scrolled to the newest message — `openConvo`
     (useMessagesData.ts) ends in a double-rAF `scrollToBottom()`. With ten
     unread messages that puts you at the END of what you have not read and
     asks you to scroll UP to find where you left off. The first-unread anchor
     already existed here for the "Jump to new messages" chip; this uses it for
     the landing too.

     Deliberately narrow:
     - Only when the thread HAD unread messages on open. With none, nothing
       runs and the existing bottom landing is untouched — that is still the
       right place for a thread you are caught up on.
     - ONCE per conversation, guarded on `jobId|otherUserId`. A realtime
       inbound message re-renders this hook, and without the guard it would
       yank the reader back up to an anchor they have already passed.
     - `behavior: "auto"` — the thread must already BE at the right place when
       it paints, not animate there from the bottom.

     It leans on one property of `openConvo`: it batches `setActiveConvo` with
     `setMessages([])`, so ChatView always MOUNTS with an empty thread and the
     first page lands a render later. That ordering is what lets the unread
     snapshot effect above run before this effect has anything to anchor to —
     on a mount that already had messages, the snapshot would still read 0 and
     this would burn its one shot doing nothing. Pinned by
     useChatScroll.unreadLanding.test.tsx, which renders in that same order.

     It re-applies for a few frames because it has to beat `openConvo`'s
     double-rAF `scrollToBottom()`, which is scheduled before this effect
     runs and would otherwise land last and win. Same shape as the
     keyboard re-anchor below, and equally a no-op on frames where nothing
     moved. `openConvo` itself is untouched. */
  const unreadLandingKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const convoKey = `${activeConvo.jobId}|${activeConvo.otherUserId}`;
    if (unreadLandingKeyRef.current === convoKey) return;
    // Nothing to anchor to yet — wait for the first page of messages.
    if (messages.length === 0) return;
    unreadLandingKeyRef.current = convoKey;
    const targetId = initialFirstUnreadIdRef.current;
    if (!targetId || initialUnreadCountRef.current <= 0) return;

    let raf = 0;
    let frames = 0;
    const land = () => {
      const el = scrollContainerRef.current;
      const node = el?.querySelector<HTMLElement>(
        `[data-msg-id="${targetId}"]`,
      );
      if (node) node.scrollIntoView({ behavior: "auto", block: "start" });
      // 4 frames clears the double rAF with room to spare; short enough that
      // a reader who scrolls immediately is not fought for long.
      if (++frames < 4) raf = requestAnimationFrame(land);
    };
    land();
    raf = requestAnimationFrame(land);
    return () => cancelAnimationFrame(raf);
  }, [activeConvo.jobId, activeConvo.otherUserId, messages.length]);

  // Reset the jump button whenever the conversation changes so a stale
  // "scrolled up" state from a previous thread doesn't bleed through.
  useEffect(() => {
    setShowJumpToBottom(false);
    setFirstUnreadOffscreen(false);
  }, [activeConvo.jobId, activeConvo.otherUserId]);

  // Re-anchor to the newest message when the keyboard opens. Tapping the
  // composer raises the keyboard, which adds `keyboardInset` of bottom
  // padding and shrinks the visible thread — without this the latest
  // messages slide up behind the keyboard. We only pull to the bottom if
  // the user was already parked near it (nearBottomRef); if they'd scrolled
  // up to read history, yanking them down would be hostile. We key on the
  // open transition only (>0) — on close the padding shrinks back and the
  // content is already in view.
  //
  // The scroll is re-applied EVERY FRAME until the padding animation has
  // settled, not once on a double-rAF. The wrapper that carries the
  // keyboard padding animates it (`transition-[padding] duration-150` in
  // ChatView), so the thread's height shrinks gradually. A single scroll
  // fired ~2 frames in landed while the container had not shrunk yet —
  // measured at 375x812 with a 291px keyboard: at +16ms the scroller's max
  // scrollTop was still 0, so `scrollTo` clamped to 0 and did nothing; by
  // +100ms the max was 161px and the position was still 0, leaving the
  // newest 161px of the thread — including the whole last message — parked
  // behind the keyboard with no indication it was there. Re-pinning across
  // the animation is what actually keeps the latest message visible.
  const prevKeyboardInsetRef = useRef(keyboardInset);
  useEffect(() => {
    const opened = prevKeyboardInsetRef.current === 0 && keyboardInset > 0;
    prevKeyboardInsetRef.current = keyboardInset;
    if (!opened || !nearBottomRef.current) return;
    let raf = 0;
    // Comfortably past the 150ms padding transition; short enough that a
    // user who starts scrolling right after the keyboard opens isn't fought
    // for long.
    const settleBy = performance.now() + 400;
    const pinToBottom = () => {
      const el = scrollContainerRef.current;
      // Assigning scrollTop (rather than scrollTo) clamps to the current
      // maximum, so this is a no-op on every frame where nothing moved.
      if (el) el.scrollTop = el.scrollHeight;
      if (performance.now() < settleBy) raf = requestAnimationFrame(pinToBottom);
    };
    raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [keyboardInset]);

  return {
    scrollContainerRef,
    initialFirstUnreadIdRef,
    initialUnreadCountRef,
    showJumpToBottom,
    firstUnreadOffscreen,
    setThreadRef,
    pullDistance,
    refreshing,
    isPulling,
    canTrigger,
  };
}
