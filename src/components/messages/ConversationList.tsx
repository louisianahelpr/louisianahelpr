import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { coerceInboxView, defaultInboxTab, UNFILTERED_INBOX_TAB } from "@/lib/inboxDefault";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { CheckSquare, Menu, MessageSquare, Pin, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PageScaffold } from "@/components/ui/PageScaffold";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { ScreenHeaderRow } from "@/components/ui/ScreenHeaderRow";
// Card-matching skeleton — mirrors the actual ConversationRow shape
// (avatar + name/job/last-msg lines + timestamp + unread dot) so the
// loading→loaded swap doesn't shift the row. See task #121.
import { MessageThreadSkeleton } from "@/components/ui/skeletons/MessageThreadSkeleton";
import { VirtualList, type VirtualListHandle } from "@/components/VirtualList";
import { ConversationRow } from "./ConversationRow";
import { SwipeableConversationRow } from "./SwipeableConversationRow";
import { getPinnedSet, loadPins, pinnedKey, togglePinned } from "@/lib/pinnedConversations";
import {
  ARCHIVE_CHANGED_EVENT,
  isArchived as isConvoArchived,
  loadArchives,
  unarchiveConversation,
} from "@/lib/archivedConversations";
import type { Conversation } from "./types";
import { serverNow } from "@/lib/messagingLockout";
import { isThreadAgedOut, THREAD_AGE_OUT_DAYS } from "./threadAgeOut";

/**
 * Job states that mean "this work is still running", for the Active inbox tab.
 * `open` is deliberately absent: a thread on an open posting is somebody asking
 * about a job nobody has been awarded yet, which is a conversation, not a job in
 * progress. Completed / cancelled are equally absent — those threads are
 * history, and history lives under All.
 */
const LIVE_JOB_STATUSES = new Set([
  "accepted",
  "in_progress",
  "revision_requested",
  "disputed",
  "pending_approval",
]);

// Cap the rendered list; "Show all" reveals the rest. The virtualizer
// keeps long lists cheap, but a default cap keeps first paint trivial.
const CONVO_LIMIT = 50;

interface ConversationListProps {
  conversations: Conversation[];
  /** Full inbox including locally-archived threads — needed for the
   *  hamburger's "Recently Deleted" view, since `conversations` above has
   *  archived threads already filtered out (see useMessagesData). */
  allConversations?: Conversation[];
  loading: boolean;
  loadError: boolean;
  /**
   * Retry for the inbox error state. Must come from the hook rather than
   * being built here from `userId`: `loadError` is true in a branch where
   * `userId` is null by definition, so a `if (userId)` retry is dead in the
   * one state it most needs to work. See useMessagesData.retryInbox.
   */
  retryInbox: () => void | Promise<void>;
  userId: string | null;
  /** Reloads the conversation list — drives retry + pull-to-refresh. */
  loadConversations: (uid: string) => Promise<void>;
  /** Opens a conversation into the chat view. */
  openConvo: (convo: Conversation) => void;
  /** Opens the confirm dialog for hiding one thread (an honest local
   *  archive, not a hard delete). Fired by the row's left swipe. */
  setDeleteConvoConfirm: Dispatch<SetStateAction<Conversation | null>>;
  /** When true, render only the inbox body (no PageScaffold / fixed-
   *  viewport shell, no title card) so the desktop Messages page can host
   *  it as the left pane of a list+thread split. Defaults to false —
   *  mobile/native render the full standalone PageScaffold exactly as
   *  before. The selected thread is highlighted via `activeKey`.
   *
   *  NOTHING IN PRODUCTION PASSES `true` — the desktop list+thread split was
   *  removed (Messages.tsx passes `embedded={false}` on both panes), so every
   *  branch below still keyed on this prop is unreachable outside tests. The
   *  desktop-website behaviours that DO have to ship (the inline tab strip,
   *  the absent disclosure, the sr-only page name) are keyed on
   *  `useIsWebDesktop()` instead. Left in place rather than deleted: it is a
   *  public prop of a shared component and removing it is a separate change,
   *  not a side effect of this one. */
  embedded?: boolean;
  /** `${jobId}_${otherUserId}` of the open thread — used to highlight the
   *  active row in the embedded (desktop split) layout. */
  activeKey?: string | null;
  /** Batch-hide the selected threads (multi-select delete). Reuses the
   *  same honest local-archive semantics as the single-row delete — the
   *  parent opens ONE combined confirm dialog and, on confirm, archives
   *  each. Never a hard delete. */
  onBatchArchive: (convos: Conversation[]) => void;
  /** Bumped by the parent after a batch archive resolves — clears the
   *  in-list selection and exits select mode. */
  resetSelectionNonce?: number;
}

// Sort comparator (descending by lastAt) — pulled out so the pinned /
// unpinned partitions both use the exact same ordering rule.
function byLastAtDesc(a: Conversation, b: Conversation): number {
  return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
}

/**
 * Title-card padding. The SAME value as ActivityHeader's
 * ACTIVITY_HEADER_PADDING — that identity is the whole point: this card is
 * supposed to have My Posts' exact geometry. Copied rather than imported
 * because importing it pulls the Activity page module into the Messages
 * chunk for two utility classes. `!` because PageScaffold concatenates
 * rather than merges. If one moves, move the other.
 */
const MESSAGES_HEADER_PADDING = "!py-1.5 lg:!py-2";

/**
 * The tab the inbox LANDS on, and the tab that means UNFILTERED — since
 * 2026-09-19 these are two different values and the difference matters.
 *
 * The owner asked Messages to open on a slice with something in it and, shown
 * the 2026-08-30 "the default view moved around depending on read state"
 * history, chose Active over Unread (see lib/inboxDefault.ts for the full
 * reasoning). So:
 *
 *   DEFAULT_INBOX_TAB    = "active" — where a visit starts.
 *   UNFILTERED_INBOX_TAB = "all"    — where "show me everything" goes.
 *
 * Before today these were the same constant, and every "Show All" affordance
 * was wired to the default. Leaving them conflated would have turned the
 * empty-state button into a no-op that sets the tab it is already on.
 *
 * The argument to `defaultInboxTab` is the unread count; the rule ignores it
 * (deliberately — that is what makes the landing tab stable), so 0 is a
 * truthful stand-in for "whatever the rule says".
 *
 * There is no `DEFAULT_INBOX_TAB` constant here any more, and no
 * `INBOX_TABS_ID` either: both existed only for the phone disclosure — the
 * first to darken the chevron's ink while a non-default slice was on, the
 * second as its `aria-controls` target. The strip is inline at every width as
 * of 2026-09-19 (owner), so there is no control to label and no panel to
 * point at. `defaultInboxTab` itself is still read, once, by the seeding
 * effect below.
 */

/**
 * The header row's icon buttons — search, the tab disclosure, the overflow
 * menu — as ONE class, copied verbatim from ActivityHeader's non-inline
 * buttons.
 *
 * Cross-screen: My Posts / My Jobs put the same search + chevron pair in the
 * same corner of the same card, and two identical clusters in two different
 * inks is the kind of difference a reader feels without being able to name it.
 * Within the row: the chevron must not be a different weight of grey from the
 * magnifier eight pixels away.
 *
 * `h-11` is 44px, the HIG target index.css already floors every button at.
 */
const HEADER_ICON_BUTTON_CLASS =
  "rounded-ds-md flex items-center justify-center btn-press transition " +
  "text-muted-foreground hover:text-foreground hover:bg-secondary/60 h-11 w-11";

/**
 * ConversationList — the inbox surface of the Messages page: the
 * Messages title card, the "All threads" header, and the pull-to-
 * refresh, virtualized list of conversation rows (avatar, unread
 * badge, job status chip, relative timestamp).
 *
 * Extracted verbatim from Messages.tsx (a step in splitting that file)
 * — the JSX is unchanged. The "show all" toggle and the pull-to-
 * refresh wiring are local to this surface, so they live here.
 */
export function ConversationList({
  conversations,
  allConversations,
  loading,
  loadError,
  retryInbox,
  userId,
  loadConversations,
  openConvo,
  setDeleteConvoConfirm,
  embedded = false,
  activeKey = null,
  onBatchArchive,
  resetSelectionNonce = 0,
}: ConversationListProps) {
  const navigate = useNavigate();
  /* Same gate Activity uses (Activity.tsx:410). On the desktop WEBSITE the
     header stops being the scaffold's floating title card and becomes the
     panel's first child under a hairline — see the PageScaffold call at the
     bottom of this file. Messages was the last of the four scaffold pages
     still wearing a separate top panel at every width (owner, 2026-09-16).
     False on phone and on native at every size, so the phone rendering is
     byte-for-byte unchanged. */
  const isWebDesktop = useIsWebDesktop();
  const [showAllConvos, setShowAllConvos] = useState(false);
  // Multi-select delete mode. `selectMode` swaps each row into a
  // checkbox toggle (opening is suppressed) and reveals a bottom action
  // bar; `selectedKeys` holds up to MAX_SELECT `${jobId}_${otherUserId}`
  // keys. Reset from the parent via `resetSelectionNonce` after a batch
  // archive resolves.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // In-list search: an expandable field (mirrors the Activity tabs'
  // search pattern) that client-filters the already-loaded threads by
  // the other person's name and the last-message snippet. No new query —
  // a pure local filter over `conversations`, so no debounce needed.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /* ONE PRESS OUT, AND THE FOCUS COMES BACK — the same dismiss contract
     ActivityHeader states (see the note there, owner 2026-09-19). The field
     unmounts under the caret, so without this `document.activeElement` falls
     to <body>: the keyboard user who pressed the X is dropped at the top of
     the document with the inbox they were filtering gone. Escape is wired to
     the identical call, so "get me out of search" has a keyboard spelling. */
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const wasSearchOpenRef = useRef(searchOpen);
  useEffect(() => {
    if (wasSearchOpenRef.current && !searchOpen) searchTriggerRef.current?.focus();
    wasSearchOpenRef.current = searchOpen;
  }, [searchOpen]);
  const closeSearch = () => {
    hapticLight();
    setSearchQuery("");
    setSearchOpen(false);
  };
  /* Which slice of the inbox. ACTIVE is the default (owner, 2026-09-19) —
     see defaultInboxTab in lib/inboxDefault.ts for why Active and not the
     Unread rule that was removed on 2026-08-30. Resolved once, on mount, from
     the first load; changing tabs after that is the user's business.

     `null` means "not chosen yet" so the effect below can seed it as soon as
     the first page of threads lands. */
  const [inboxFilter, setInboxFilter] = useState<string | null>(null);
  /* ── THE FILTER STRIP IS ALWAYS VISIBLE. THERE IS NO DISCLOSURE ───────
     OWNER, 2026-09-19 (after the Unread tab was cut): the desktop website
     showed `Active · All` inline in the header row while phone hid the SAME
     control behind a chevron — and the one the reader has to discover was the
     phone's. The chevron is gone at every width. The strip is always on
     screen, and `pinnedFilterChip` aside there is no longer any way for this
     inbox to be filtered without the filter being visible.

     WHERE IT SITS IS DECIDED BY MEASUREMENT, NOT BY TASTE, and the header row
     does not have the width on a phone. Measured on the production build
     (`vite preview`), poster-e2e, 31 threads, with the chevron already
     removed so the cluster is two buttons and not three:

                     row    actions  gaps  strip   left for "Messages"  needs
       320 (title card 238px)   92     20    106            20            88  ✗
       375 (title card 293px)   92     20    106            75            88  ✗
       1440 (in-panel 1102px)   92     20    106           884            78  ✓

     At 375 the screen's own name rendered "Messa…"; at 320 it rendered "M.".
     Dropping the tab COUNTS buys ~25px and still misses 320 by 43. So on
     phone the strip keeps its own line under the toolbar, which is the only
     placement with room — the same split ActivityHeader makes under
     `inlineFilters`, not a Messages-only invention.

     WHAT THAT COSTS, stated plainly: this title card is ~118px on phone in
     every state now, where the disclosure made it 62px closed and 118px open
     (owner, from a device: "Messages should also be collapsed when opened").
     The always-visible strip is the newer instruction and it wins; the older
     one is what the 62px bought.

     WHAT WENT WITH THE CHEVRON: `tabsOpenPhone` / `tabsOpen`, the effect that
     force-opened the row when a non-default filter arrived (an always-visible
     strip can never be "silently filtered"), `isDefaultInboxFilter`, which
     existed only to darken the chevron's ink, and `INBOX_TABS_ID`, its
     `aria-controls` target. */
  /* EVERY read of the filter goes through the coercion, never through the raw
     state. `inboxFilter` is component-local and un-persisted, so today the
     only writers are the tab strip, the overflow menu and the seeding effect
     — but `"unread"` was a legal value until 2026-09-19 and this is a shipped
     app: a session open across the change must not be left staring at a tab
     that no longer exists, highlighted-nothing and empty. Unknown coerces to
     the default (see coerceInboxView). `null` is preserved by the seeding
     effect below, which owns the "not chosen yet" distinction. */
  const inboxTab = coerceInboxView(inboxFilter);
  // Bump this nonce after a pin/unpin so the derived order re-reads
  // sessionStorage (the pin set is read directly to avoid a parallel
  // state branch). Cheap, scoped to a paint.
  const [pinNonce, setPinNonce] = useState(0);
  // Same idea as pinNonce, for the "Recently Deleted" view below — bumped
  // whenever a thread is archived/restored anywhere (this list's own swipe
  // action, or another tab/device) so the archived-only filter re-reads
  // the local archive map instead of going stale.
  const [archiveNonce, setArchiveNonce] = useState(0);
  useEffect(() => {
    const onArchiveChanged = () => setArchiveNonce((n) => n + 1);
    window.addEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);
    return () => window.removeEventListener(ARCHIVE_CHANGED_EVENT, onArchiveChanged);
  }, []);

  // Pull the pin list from the server once the user is known.
  //
  // Pins are now durable (public.thread_pins) rather than sessionStorage, so
  // a cold launch has to fetch them. `loadPins` seeds its cache from the local
  // mirror first, so the first paint is already right in the common case; this
  // bump is what folds in anything pinned on another device. It never rejects
  // — a failed pin fetch resolves to the mirror rather than breaking the inbox.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadPins(userId).then(() => {
      if (!cancelled) setPinNonce((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Same idea, for archives (public.thread_archives — see
  // archivedConversations.ts). Without this, a thread hidden on another
  // device wouldn't be filtered out of THIS device's inbox, or show up in
  // THIS device's Recently Deleted, until something else happened to
  // trigger a re-read of the local mirror.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadArchives(userId).then(() => {
      if (!cancelled) setArchiveNonce((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Partition + sort: pinned threads first (kept in their own
  // newest-first stack), then everything else in newest-first order.
  // Keeps the inbox readable when 2-3 threads are pinned without
  // splitting them into a separate panel.
  const orderedConversations = useMemo(() => {
    if (!userId) return [...conversations].sort(byLastAtDesc);
    const pinnedSet = getPinnedSet(userId);
    const pinned: Conversation[] = [];
    const rest: Conversation[] = [];
    for (const c of conversations) {
      if (pinnedSet.has(pinnedKey(c.jobId, c.otherUserId))) pinned.push(c);
      else rest.push(c);
    }
    pinned.sort(byLastAtDesc);
    rest.sort(byLastAtDesc);
    return [...pinned, ...rest];
    // pinNonce is the dependency, even though it's not used in the body —
    // bumping it triggers a re-read of sessionStorage.
  }, [conversations, userId, pinNonce]);

  // Client-side search over the already-ordered list. Case-insensitive
  // substring match on the other person's name and the last-message
  // snippet — the two fields a user scans when hunting for a thread.
  // Empty query is a no-op (returns the full ordered list).
  /* THE ALL TAB'S OWN SLICE — "everything, minus finished work old enough
     that nothing can send you back to it" (owner, 2026-09-19: keep the
     threads, auto-hide after a while, NEVER delete).

     The rule, the 44-day derivation, the unread exemption and the three ways
     an aged-out thread is still reachable all live in threadAgeOut.ts. Two
     things are true here and nowhere else:

       - It is applied ONLY to the All branch below. Active already excludes
         finished work by status (LIVE_JOB_STATUSES), Unread is the exemption
         itself, and Pinned / Recently Deleted are explicit human choices an
         automatic age rule has no business overruling.
       - `serverNow()`, never `Date.now()`. The closing instant it is measured
         against was stamped by the server; comparing it to a device clock is
         the same mistake the lockout notice was careful not to make.

     `conversations` is already the archive-filtered inbox, so this composes
     with the user's own archive rather than fighting it. Nothing is written. */
  const allTabConversations = useMemo(() => {
    const now = serverNow();
    return orderedConversations.filter((c) => !isThreadAgedOut(c, now));
  }, [orderedConversations]);

  /* How many finished threads the age rule is currently holding back. Drives
     the one line of copy that keeps "hidden" from reading as "lost" — see the
     aged-out note rendered above the list. */
  const agedOutCount = orderedConversations.length - allTabConversations.length;

  const filteredConversations = useMemo(() => {
    /* Tab first, then the search box. Searching inside the slice you are
       looking at is what a two-control list is expected to do; searching the
       whole inbox while a tab says "Active" would make the tab a lie.

       THE ONE EXCEPTION is the age rule. A search that could not find a
       finished thread would not be "hiding" it, it would be deleting it with
       extra steps (threadAgeOut.ts names search as reachability path #1), so
       when the search box has text the All branch reads the untrimmed list.
       The age rule is about what a RESTING inbox shows, not about what the
       app is willing to admit exists. */
    const searching = !!searchQuery.trim();
    const byTab =
      inboxTab === "active"
        ? orderedConversations.filter(
            (c) => c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus),
          )
        : inboxTab === "pinned"
            ? (() => {
                // Real filter, not a stub: pin state already exists
                // (swipe-to-pin, see orderedConversations above) — the
                // hamburger's "Pinned" entry just needed to read it instead
                // of toasting "coming soon".
                const pinnedSet = userId ? getPinnedSet(userId) : new Set<string>();
                return orderedConversations.filter((c) =>
                  pinnedSet.has(pinnedKey(c.jobId, c.otherUserId)),
                );
              })()
            : inboxTab === "recentlyDeleted"
              ? (() => {
                  // Real filter, not a stub: archiving already exists (swipe
                  // action → archivedConversations.ts) and useMessagesData
                  // already keeps the full pre-filter list around as
                  // `allConversations` for deep-link resolution — this just
                  // reads both instead of toasting "coming soon". Threads
                  // here aren't in `conversations`/`orderedConversations`
                  // (already filtered out), so this reads allConversations
                  // directly rather than filtering the byTab source above.
                  if (!userId || !allConversations) return [];
                  return [...allConversations]
                    .filter((c) => isConvoArchived(userId, c.jobId, c.otherUserId, c.lastAt))
                    .sort(byLastAtDesc);
                })()
              : /* ALL — the only tab the age rule trims, and only at rest. */
                searching
                ? orderedConversations
                : allTabConversations;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter((c) => {
      const name = c.otherUserName?.toLowerCase() ?? "";
      const snippet = c.lastMessage?.toLowerCase() ?? "";
      const title = c.jobTitle?.toLowerCase() ?? "";
      return name.includes(q) || snippet.includes(q) || title.includes(q);
    });
  }, [orderedConversations, allTabConversations, searchQuery, inboxTab, userId, pinNonce, allConversations, archiveNonce]);
  const isRecentlyDeletedView = inboxTab === "recentlyDeleted";
  // Pinned and Recently Deleted both read a different source than the
  // default inbox (see filteredConversations above), so an empty default
  // inbox must not blank either of them out — see the render-gate comment
  // below where this is used.
  const isSpecialFilterView = inboxTab === "pinned" || isRecentlyDeletedView;

  // Seed the default tab from the FIRST loaded page, once. See the state decl.
  // The rule itself lives in `defaultInboxTab` so the app and its tests read it
  // from ONE place. Since 2026-09-19 that rule is a constant — Active — and it
  // deliberately does NOT consult the count passed to it: a landing tab that
  // depended on read state was what the owner removed on 2026-08-30.
  //
  // The count is still computed and still passed, because the module's
  // contract is "ask this function, with the inbox's state, which tab to open
  // on" — the day the rule needs state again, it is already here.
  useEffect(() => {
    if (inboxFilter !== null || conversations.length === 0) return;
    const unreadCount = conversations.reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);
    setInboxFilter(defaultInboxTab(unreadCount));
  }, [conversations, inboxFilter]);

  // True when an active search filters every thread out — drives a tidy
  // "No conversations match" state in place of the list.
  const noSearchMatches =
    !!searchQuery.trim() && filteredConversations.length === 0;

  /* And the same thing for a TAB that filters everything out.
     `hasThreads` asks whether the whole inbox has anything, so it stayed true
     while a narrow tab was showing nothing (it was the Unread tab at the time,
     since removed; Active reproduces it exactly) — and the list column rendered as a
     blank white panel with no message at all. A caught-up inbox is a good
     outcome; it should say so rather than look broken. */
  const noTabMatches =
    !searchQuery.trim() && conversations.length > 0 && filteredConversations.length === 0;

  const handleTogglePin = (convo: Conversation) => {
    if (!userId) return;
    togglePinned(userId, convo.jobId, convo.otherUserId);
    setPinNonce((n) => n + 1);
  };

  const handleArchive = (convo: Conversation) => {
    // Reuse the existing "delete conversation" confirm flow — it's an
    // honest local archive, not a destructive delete (see archivedConversations.ts).
    setDeleteConvoConfirm(convo);
  };

  // Cap the selection so batch-delete stays a deliberate, small action.
  const MAX_SELECT = 3;
  const convoKey = (c: Conversation) => `${c.jobId}_${c.otherUserId}`;

  // Enter select mode from the toolbar. Close any open search so the two
  // modes never overlap.
  const enterSelectMode = () => {
    hapticLight();
    setSearchOpen(false);
    setSearchQuery("");
    setSelectMode(true);
    setSelectedKeys(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  };

  // Toggle one row's selection, enforcing the 3-thread cap with a toast
  // when a fourth is attempted. Reads `selectedKeys` from the closure so
  // the cap check stays out of the state updater (no double toast under
  // StrictMode's double-invoked reducers).
  const toggleSelect = (c: Conversation) => {
    const key = convoKey(c);
    const already = selectedKeys.has(key);
    if (!already && selectedKeys.size >= MAX_SELECT) {
      toast(`You can select up to ${MAX_SELECT} conversations.`);
      return;
    }
    hapticLight();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Hand the selected threads up to the parent, which owns the combined
  // confirm dialog + the honest local-archive. Selection is cleared via
  // `resetSelectionNonce` only after that confirm resolves.
  const handleBatchDelete = () => {
    const selected = filteredConversations.filter((c) =>
      selectedKeys.has(convoKey(c)),
    );
    if (selected.length === 0) return;
    onBatchArchive(selected);
  };

  // Parent bumps `resetSelectionNonce` after a batch archive resolves —
  // clear the selection and drop out of select mode.
  useEffect(() => {
    if (resetSelectionNonce > 0) exitSelectMode();
    // Only react to the nonce changing. exitSelectMode is deliberately
    // omitted — and it is NOT stable (a plain arrow re-created every render;
    // this said "is stable" until 2026-09-10). Harmless only because it
    // closes over nothing but useState setters. Anything closure-dependent
    // added to it would go stale here silently.
  }, [resetSelectionNonce]);

  // The current pinned key-set for the rendered conversations. Kept
  // outside the render loop so SwipeableConversationRow's `isPinned`
  // prop is a stable Set lookup, not a per-row sessionStorage read.
  const pinnedSetForRender = useMemo(
    () => (userId ? getPinnedSet(userId) : new Set<string>()),
    // pinNonce drives re-evaluation when a pin/unpin happens.
    [userId, pinNonce],
  );

  // Are there threads to ACT ON? This gates every control on the page — the
  // Active/All tabs, the Select/Search cluster, and the select-mode
  // action bar — none of which have anything to operate on without them.
  //
  // Note what it is NOT: the negation of "is the inbox empty". The gate used to
  // be `!isEmpty`, where `isEmpty = !loading && …length === 0`, and the `!loading`
  // made an unanswered inbox count as non-empty. So the tabs rendered during the
  // load and then vanished the instant the query came back with zero — the owner
  // saw exactly that and described it as "Messages opens different then realized
  // there are no messages and changes the view of the screen". Measured at 375
  // on the built app: the thread area sat at y=122 while loading and snapped to
  // y=65 when the empty state landed, a 57px jump.
  //
  // Phrased as a positive — "we KNOW there are threads" — loading is treated as
  // "not yet", so nothing appears that later has to be taken away.
  //
  // WHAT IT NO LONGER GATES, AND WHY (owner ruling, 2026-09-20).
  // The paragraph that used to sit here said this could not be made jump-free
  // in both directions, because the loading frame has to guess one of the two
  // outcomes and the other one then moves by the tab row's height. That is
  // true of a row that is CONDITIONAL. It is not true of a row that is not:
  // the owner's ruling is "keep the row's height reserved whether or not there
  // are threads, and render the tabs in both cases", which removes the guess
  // instead of making it. The strip renders on the loading frame, on the empty
  // inbox and on the populated one, so there is no frame it has to appear in
  // or disappear from, and the old paragraph's "permanent dead band above the
  // empty state" is not dead: it holds the tabs and the search the owner asked
  // to be able to see on an empty inbox — the same "looks broken" shape just
  // fixed on /my-posts and /my-jobs.
  //
  // Measured on the built app, prod data, before → after:
  //   375  empty inbox   thread area y=83  → y=127      tabs: none → 293x42
  //   375  populated     thread area y=127 → y=127      tabs: 293x42 (unchanged)
  //   1440 empty inbox   thread area y=130 → y=130      tabs: none → 106x20
  //   1440 populated     thread area y=130 → y=130      tabs: 106x20 (unchanged)
  // i.e. the 44px the empty inbox used to sit above the populated one at 375
  // is now zero, and the number that moved is the empty state's, not the
  // populated one's. Guarded in e2e/prod-audit/activity-tabs-visible.spec.ts,
  // which drives both accounts and fails on any difference at all.
  //
  // `hasThreads` survives for the things that genuinely have nothing to
  // operate on without threads — "Select messages" and the select-mode action
  // bar. Those live in a menu and in a mode; neither is on the screen at rest,
  // so neither can move the thread area.
  const hasThreads = !loading && !loadError && conversations.length > 0;

  /* There used to be a whole-inbox `unreadThreads` count here, feeding the
     "2 unread" header caption and then the Unread tab's badge. Both are gone
     (the caption when the tabs landed, the tab on 2026-09-19), and a total
     that is never rendered is a total that can quietly go wrong. The only
     unread number the inbox still states is `hiddenUnreadCount` below, which
     is a narrower question: how many unread threads is the CURRENT view
     concealing. Unread itself is shown per-row, where it always was. */
  /* The inbox had no filter at all — a single undifferentiated list, with
     "2 unread" printed beside the title as the only acknowledgement that some
     threads want you and the rest don't (owner: "i think unread should be the
     default tab??" and "where are the other options?").

     It grew to three slices, and on 2026-09-19 settled at TWO: which
     conversations belong to work that is still running, and everything. Same
     control My Posts / My Jobs use — literally the same component — because
     "which slice of this list am I looking at" is one idea and the app should
     express it one way.

     The third slice (Unread) was removed the same day: it answered a question
     the row's own unread mark and the on-entry unread scroll already answer.
     See the tab strip below and lib/inboxDefault.ts. The "2 unread" caption
     it replaced does NOT come back — its job is now the hidden-unread banner,
     which says the same number only when it is actually being hidden. */
  const activeThreads = conversations.filter(
    (c) => c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus),
  ).length;

  /* Unread threads the ACTIVE slice does not show — the number the banner
     below prints. Derived from the SAME predicate the Active branch filters
     by, not a restatement of it, so the two cannot drift into claiming
     different things. An unread thread on an `open` posting is the common
     case; a completed or cancelled one that is still unread is the other. */
  const hiddenUnreadCount = conversations.filter(
    (c) => c.unread > 0 && !(c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus)),
  ).length;

  // Pull-to-refresh: swiping down on the list re-runs loadConversations.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { if (userId) await loadConversations(userId); },
  });

  /* "Messages should open to the unread messages" (owner, 2026-09-16) — the
     LIST half of that ask. The in-thread half already lands on the first
     unread message (chatView/useChatScroll.ts).

     This is a SCROLL, not a filter, and that distinction now carries real
     weight: on 2026-09-19 the Unread TAB was removed precisely BECAUSE this
     effect already does its job (lib/inboxDefault.ts). The list parks on the
     first thread that wants a reply instead of on whatever was most recent.

     It scrolls within whatever slice is showing (`filteredConversations`), so
     since the default became Active it lands on the first unread LIVE thread.
     Unread threads outside that slice are not scrolled to and not shown —
     which is exactly what the hidden-unread banner below exists to say out
     loud. Do not "fix" this by widening the effect to `conversations`: it
     would scroll to a row the current tab is not rendering.

     Once per mount, and only when it buys something:
       - the first row is already unread  → nothing to jump to;
       - nothing is unread                → nothing to jump to;
       - the first unread sits past the CONVO_LIMIT slice → that row is not
         rendered yet, so scrolling to it would land on empty space.
     Realtime delivering a new message never re-fires it: yanking the list out
     from under someone who is reading it is worse than the stale position. */
  const listHandleRef = useRef<VirtualListHandle | null>(null);
  const didUnreadJumpRef = useRef(false);
  useEffect(() => {
    if (didUnreadJumpRef.current || loading) return;
    const list = filteredConversations;
    if (list.length === 0) return;
    // One attempt per mount, taken or not — the conditions below are about
    // this first paint, and re-evaluating them later is the re-yank we don't
    // want.
    didUnreadJumpRef.current = true;
    const idx = list.findIndex((c) => c.unread > 0);
    const rendered = showAllConvos ? list.length : Math.min(list.length, CONVO_LIMIT);
    if (idx <= 0 || idx >= rendered) return;
    // One frame so the virtualizer has its scrollMargin (measured in a layout
    // effect on the row container) before it converts an index to an offset.
    const raf = requestAnimationFrame(() => {
      listHandleRef.current?.scrollToIndex(idx, { align: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, filteredConversations, showAllConvos]);

  // The title card holds the toolbar itself — the name, the Select/Search
  // cluster and (on phone) the Active/All tabs. It does NOT hold a
  // "N threads" chip: that restated the thread list directly beneath it, the
  // same count box My Posts / My Jobs dropped.

  const inboxTabs = (
    <UnderlineTabs
      /* Dense ONLY inline in the desktop header row, which is already 44px
         tall for its icon buttons. On phone the strip has its own line and
         the non-dense `py-[13px]` is what carries the 44px touch target —
         see UnderlineTabs' own note. */
      dense={isWebDesktop}
      ariaLabel="Filter conversations"
      /* TWO tabs, Active then All (owner, 2026-09-19, confirmed twice).
         Narrow to wide, and the tab the inbox lands on comes first — "here,
         or everything", rather than the old strip's "All, and some filters".

         THE UNREAD TAB IS DELIBERATELY GONE, and it is redundant three times
         over: Active is the default so the landing view is already filtered
         to live conversations; unread is marked on the ROW itself (the dot +
         bold treatment in ConversationRow); and the list already SCROLLS to
         the first unread thread on entry (028fe3837, the effect just above).
         A filter that duplicates what the list already shows is chrome.

         This reverses the owner's own earlier ask the same afternoon ("in the
         top bar it should say all unread and active", 9b0eb1fc8). The other
         half of that commit — inline on desktop, disclosure on phone — is
         untouched and must stay. Only the third entry went.

         All's count is `allTabConversations`, NOT `conversations`: the age
         rule trims that tab (threadAgeOut.ts), and a tab whose number does
         not match the list under it is a worse lie than no number. */
      tabs={[
        { key: "active", label: "Active", count: activeThreads },
        { key: "all", label: "All", count: allTabConversations.length },
      ]}
      value={inboxTab}
      onChange={setInboxFilter}
    />
  );

  // Neither "Pinned" nor "Recently Deleted" is one of the three visible
  // tabs (both are reached via the hamburger instead), so with either
  // active none of the underline tabs highlight — this chip is the only
  // thing telling the user why the list shrank and how to get back.
  const pinnedFilterChip = (inboxTab === "pinned" || inboxTab === "recentlyDeleted") && (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setInboxFilter("all")}
        className="flex items-center gap-1.5 px-4 py-1.5 text-ds-11 font-sans font-semibold"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        {inboxTab === "pinned" ? <Pin className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
        {inboxTab === "pinned" ? "Showing pinned only" : "Showing recently deleted"}
        <X className="w-3 h-3" />
      </button>
      {/* Two honesty notes, since "Recently Deleted" as a name implies both
          "temporary" and "complete" and this view is neither: hiding a
          thread never expires it on its own (it stays hidden until you
          restore it, not just for N days), and very old archives can fall
          outside the 200-message fetch window (see the onClick refresh
          above) and simply not be resolvable here yet. */}
      {inboxTab === "recentlyDeleted" && (
        <p className="px-4 pb-1 text-ds-10 font-sans" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>
          Hidden threads stay here until restored — not on a timer. Very old ones may take a refresh to appear.
        </p>
      )}
    </div>
  );

  /* SELECT mode takes the whole row over. ScreenHeaderRow's `children` branch
     is precisely that escape hatch: it keeps the row geometry and still renders
     the page's h1 `sr-only`, so Messages never has zero headings while
     something is standing in for its name. Null in the normal state, which is
     what puts the row back on its title / meta / actions branch.

     SEARCH mode does NOT come through here any more — it is the shared
     `expandingSearch` slot below, which is the one arrangement every screen
     with an expanding search now uses. */
  const rowTakeover = selectMode ? (
    /* Select mode — the row is just the page name's stand-in. The live
       "N/3 selected" count lives in the floating action bar at the bottom of
       the list (see below); having it here too put the same number on screen
       twice. */
    <span className="flex-1 text-ds-13 font-medium" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {selectedKeys.size}/{MAX_SELECT} selected
    </span>
  ) : null;

  /* SEARCH MODE — the shared shape, not a third arrangement of it.
     Capped at `lg:max-w-md` on desktop (owner, 2026-09-14, VN-35: "search
     shouldn't open that large for messages either") — the same cap as the
     Browse search (VN-5) and My Posts / My Jobs (VN-31). Phone stays
     full-width.

     THE MAGNIFIER IS IN THE FIELD and the ✕ is the field's only control
     (owner, 2026-09-19: "the magnifier should move to the left and the x
     stay"). The dismiss used to be a 32px circle OUTSIDE the field, with a
     SECOND ✕ inside it for "clear" once you had typed: two X's a few pixels
     apart doing nearly the same thing, and the outer one sitting exactly where
     the magnifier comes back to. One ✕ now, inside the field on the right,
     clearing and closing in a single press — the two things "done searching"
     means — with the magnifier's slot in the cluster held open beside it so
     the press can never land on the control that replaces it.

     `ml-auto` is load-bearing above `lg`, where the `max-w-md` cap stops the
     field growing to fill the row. Measured at 1440 without it: the field
     capped at 448px and flexbox parked the remaining ~600px of slack AFTER
     it, so the field sat hard against the screen name with a dead band
     between it and the cluster — the field opening on the LEFT, which is the
     shape of the owner's Home report. Below `lg` the field fills the row and
     this is a no-op. */
  const searchField = (
    <div className="relative flex-1 min-w-0 lg:max-w-md ml-auto">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input
        autoFocus
        type="search"
        aria-label="Search conversations"
        placeholder="Search conversations…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        /* Escape is the keyboard's X — same single activation, same return
           to the pre-open state, same focus hand-back. */
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }}
        spellCheck={false}
        className="w-full pl-9 pr-10 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
      />
      {/* `.ctl-exit` is the app's one exit shape and `.ctl-tint` its sanctioned
          hover tone — both kept from the control-sameness pass that put them
          on this button when it lived outside the field.
          `!min-h-0 !min-w-0` because index.css's bare 44px HIG floor on every
          `button` otherwise wins over `h-7 w-7`, rendering a 44x44 hit box
          inside a 36px-tall field and spilling past its edges. */}
      <button
        type="button"
        onClick={closeSearch}
        aria-label="Close search"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 ctl-exit inline-flex items-center justify-center text-muted-foreground hover:text-foreground ctl-tint btn-press transition"
      >
        <X className="w-4 h-4" strokeWidth={2.25} />
      </button>
    </div>
  );

  /* What sits beside the screen name ON THE DESKTOP WEBSITE: the tabs
     themselves, exactly as they do on My Posts / My Jobs, where the row is
     1102px wide and the name is `sr-only` anyway. On phone this slot stays
     empty and the strip takes its own line below — see the placement note
     above the state block for the widths that decided it.

     It is not just the tabs that do not fit here on a phone. An earlier
     attempt put a separate "1 unread" caption in this slot and that missed
     too: at 393 the row is 353px of card, the controls and their gaps took
     144, the caption and its gap 73 more, leaving 96px for a title needing
     101 — "Messag…". This slot has never had room on a phone for anything at
     all, which is the finding, not a coincidence. */
  /* UNCONDITIONAL on whether the inbox has threads — the owner's 2026-09-20
     ruling, see the note on `hasThreads`. Still conditional on the desktop
     website, because on a phone this slot has no room for anything at all
     (the widths are measured in the note above). */
  const headerMeta = isWebDesktop ? inboxTabs : undefined;

  /* The trailing icon cluster.
     Search · hamburger · chevron, in that order (owner, 2026-09-14, VN-35:
     "on messages, move the chevron to the right of the hamburger"). This
     reverses the earlier search · chevron · hamburger order, which had put
     the chevron next to search to mirror Activity.

     All three share ONE class, and it is ActivityHeader's: the chevron cannot
     be a different ink from the search glyph beside it, and Messages' cluster
     should not be a different ink from the identical cluster on My Jobs. */
  /* THE MAGNIFIER, kept separate from the rest of the cluster.
     While the field is open it is not here at all — it is inside the field, on
     its left — and ScreenHeaderRow holds its 44px slot open in its place. The
     split is what makes that possible without also unmounting the hamburger
     beside it: opening search must hide no other control. */
  /* ALWAYS. It used to be `hasThreads || isSpecialFilterView` — the second
     half because Pinned/Recently Deleted read a different source than the
     default inbox (see isSpecialFilterView above) and can have threads of
     their own when the default inbox has none. Both halves are now moot: the
     owner's 2026-09-20 ruling is that the inbox's controls are on the screen
     whether or not there are threads, and a magnifier that vanishes on an
     empty inbox is half of the "looks broken" shape they reported. It costs
     nothing to leave: pressing it on an empty inbox opens a field that finds
     nothing, which is an honest answer, not a dead end. */
  const searchTriggerButton = (
    <button
      ref={searchTriggerRef}
      type="button"
      data-search-trigger
      onClick={() => { hapticLight(); setSearchOpen(true); }}
      aria-label="Search conversations"
      className={HEADER_ICON_BUTTON_CLASS}
    >
      <Search className="w-4 h-4" />
    </button>
  );

  /* Everything in the cluster that is NOT the magnifier. Stays mounted in both
     states — see the `expandingSearch` contract on ScreenHeaderRow. */
  const headerActionsWithoutSearch = (
    <>
      {/* Hamburger — the OVERFLOW MENU, not the disclosure. It opens Select
          messages / Pinned / Recently Deleted: one bulk action and two views
          onto data the three tabs do not cover. It stays exactly as it was —
          the chevron beside it is an addition, not a replacement — because
          Recently Deleted is the only route back to a thread you have hidden.

          Deliberately NOT gated on hasThreads: Pinned/Recently Deleted look at
          DIFFERENT data than what is currently showing, so an empty "All" must
          not strand the user unable to reach either. (Concretely: archive the
          one thread you have and the inbox goes empty — hiding this would make
          restoring that thread permanently unreachable through the UI.) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Conversation list options"
            className={HEADER_ICON_BUTTON_CLASS}
          >
            <Menu className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasThreads && (
            <DropdownMenuItem onClick={enterSelectMode}>
              <CheckSquare className="w-4 h-4 mr-2" />
              Select messages
            </DropdownMenuItem>
          )}
          {/* Both entries are wired to real data: Pinned reads the existing
              swipe-to-pin state (getPinnedSet/pinnedKey above); Recently
              Deleted reads the existing archive state
              (archivedConversations.ts, already backing the swipe-to-archive
              action) via allConversations, the pre-archive-filter list
              useMessagesData already keeps around for deep links. The
              status-filter stubs (Needs You / Scheduled / Waiting / Done) were
              removed — they had no data behind them and no owner-approved
              design for what "status" means for a two-party thread (unlike
              Activity's single-sided job status), so a toast-only entry was
              pure dead-end UI. Re-add if/when that's designed. */}
          <DropdownMenuItem onClick={() => setInboxFilter("pinned")}>
            <Pin className="w-4 h-4 mr-2" />
            Pinned
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setInboxFilter("recentlyDeleted");
              // allConversations is capped to the 200 most recent messages
              // across every thread (fetchConversations) — a thread archived
              // long enough ago to fall outside that window (or archived
              // before this device's cache was ever populated) wouldn't be
              // resolvable without a fresh fetch. Refresh on open so this view
              // is as complete as that cap allows; it's still not a guarantee
              // for very old archives.
              if (userId) void loadConversations(userId);
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Recently Deleted
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* NO DISCLOSURE. The chevron that used to sit here — third in the
          cluster, after search and the hamburger — is gone at every width
          (owner, 2026-09-19): the Active / All strip is inline in this row
          now, on phone as well as on the desktop website, so there is nothing
          left for it to fold away. Removing it also bought back the ~48px
          this row needed to seat the strip at 320. */}
    </>
  );

  /* The cluster as the RESTING row renders it: magnifier first, then the
     overflow menu. One definition, so the open and closed states cannot drift
     on which controls exist. */
  const headerActions = (
    <>
      {searchTriggerButton}
      {headerActionsWithoutSearch}
    </>
  );

  /* THE TITLE CARD, on phone and native (owner, 2026-08-27).
     Messages used to render its name INSIDE the content panel, under a
     hairline, so the whole screen was one tall box while Home, My Posts and
     My Jobs beside it were a floating title card, a gap, then the panel. One
     screen out of four wearing a different shell is the kind of difference a
     reader feels without being able to name.

     Same split Activity makes, and for the same reason: on the DESKTOP website
     this stays the panel's first child under a hairline (owner: "merge into
     1"), because there the app bar and the side rail already say where you
     are. Phone and native get the two-card stack. `embedded` is exactly that
     desktop mode here — see the prop's docs. */
  const headerEl = (
    <>
          <ScreenHeaderRow
            /* THE SHARED ROW — literally the component My Posts / My Jobs
               render through ActivityHeader, and the Browse feed through
               BrowseTasksToolbar. This row used to be a hand-rolled copy of it
               (same `flex items-center gap-3`, same `min-w-0 flex-1 gap-2
               py-2.5` title block, same `gap-1 shrink-0` action cluster), which
               is exactly how two screens end up a few pixels apart. It is now
               the real thing, so the geometry cannot drift.

               The row renders ALWAYS, including on an empty inbox. It used to
               be gated on the inverse of the controls' gate, which meant an
               empty Messages had no title bar at all — the screen opened on the
               empty illustration with nothing naming it, while My Jobs beside
               it kept its title, and the page had ZERO h1 so a screen reader
               landed on an unnamed screen. Only the Search / disclosure actions
               are gated: those genuinely have nothing to act on. */
            title="Messages"
            /* On the desktop website the page name is deleted from this row
               (owner) — the app bar and the side panel both already say where
               you are, so a third "Messages" three rows apart is chrome
               restating chrome. It goes `sr-only`, never away. Phone and native
               keep it visible: they have no app bar. */
            titleSrOnly={embedded || isWebDesktop}
            // In the title card the card owns the horizontal padding and there
            // is nothing below to rule off from — the gap does that. Embedded
            // (desktop) keeps both, because there it IS the panel's first row.
            /* `max-[359px]:gap-2` is the ONLY deviation from the shared row's
               geometry, and it is 4px on one breakpoint. At 320 the card gives
               this row 240px; the three 44px controls and their gaps take 141,
               the shared `gap-3` takes 12, and "Messages" wants 88 in the 87
               that leaves — a two-pixel miss that cost the screen its own name
               ("Messag…", measured, not guessed). Tightening the title-to-
               actions gap by one step below 360 buys the four pixels back.
               375 and up are untouched, so the row stays pixel-identical to My
               Posts / My Jobs at every width a shipping phone actually has. */
            className={`shrink-0 max-[359px]:gap-2 ${embedded ? "px-4" : ""}`}
            style={{
              // The 52px floor is an IN-PANEL toolbar measure: it keeps the row
              // off the list under it. In the title card the card's own padding
              // governs the height and ScreenHeaderRow's own 44px floor carries
              // the controls — keeping 52 there made this card 6pt taller than
              // the identical card on My Posts, measured on device.
              minHeight: embedded ? "52px" : undefined,
              borderBottom: embedded ? "1px solid hsl(var(--olivewood) / 0.1)" : undefined,
            }}
            meta={rowTakeover ? undefined : headerMeta}
            actions={rowTakeover ? undefined : headerActions}
            /* Search is the SHARED slot. `open` is false whenever select mode
               has the row (the two takeovers are mutually exclusive and select
               mode wins), which puts the row back on `children`. */
            expandingSearch={{
              open: searchOpen && !selectMode,
              field: searchField,
              /* HEADER_ICON_BUTTON_CLASS is `h-11 w-11`. The slot reserves the
                 magnifier's real box, not a guess — see SearchTriggerSlot. */
              triggerWidth: "44px",
              /* THE NAME STEPS ASIDE ON A NARROW PHONE, exactly as it does on
                 My Posts / My Jobs — same row component, same arithmetic, and
                 this row was the WORSE of the two. Measured at this commit's
                 parent, signed in, by
                 e2e/prod-audit/expanding-search-geometry.spec.ts:

                   320   title 41…129 (88px)   field 137…179  =  42px
                   375   title 41…129 (88px)   field 141…230  =  89px

                 42px of field, and the magnifier at `pl-9` plus the ✕ at
                 `pr-10` already claim 76px of it — so at 320 the two glyphs
                 were drawn on top of each other and there was no typing area
                 at all. The `<h1>` is `sr-only` in this state either way, so
                 nothing is lost to a screen reader; only the visible twin
                 steps aside, only while the field is open, only below 500px.
                 The comment on the tab strip below already said this row "has
                 20px to spare at 320 … against a title that needs 88" — that
                 was true of the CLOSED row, and the open one had no such
                 spare. */
              narrowTitleStepsAside: true,
              actions: headerActionsWithoutSearch,
            }}
          >
            {rowTakeover}
          </ScreenHeaderRow>
          {/* PHONE / NATIVE: the same strip, on its own line under the
              toolbar, and ALWAYS — no chevron, no collapsed state, nothing to
              discover. The header row beside a visible "Messages" and the
              action cluster has 20px to spare at 320 and 75 at 375 against a
              title that needs 88, measured; this line is the placement that
              has room. Still hidden while search or select mode has taken the
              row over: one control at a time.

              AND ALWAYS means always: not gated on `hasThreads` any more
              (owner, 2026-09-20). This is the row whose height the ruling
              reserves — at 375 it is the 42px strip, and its presence in both
              outcomes is what makes the empty inbox's thread area start at the
              same y as the populated one's (127 either way, measured; it used
              to be 83 against 127). */}
          {!isWebDesktop && !searchOpen && !selectMode && (
            /* `-mx-1 px-1 pb-0.5` are ActivityHeader's exact classes, so this
               card matches My Posts / My Jobs. The negative margin keeps the
               tabs' focus rings inside the scroller rather than clipped by it;
               the scroller itself is insurance for 320px, where two labels are
               already comfortable. */
            <div className="shrink-0 -mx-1 px-1 pb-0.5 overflow-x-auto scrollbar-hide">
              {inboxTabs}
            </div>
          )}
          {!searchOpen && !selectMode && pinnedFilterChip}
    </>
  );

  const listBody = (
    <>
          {/* NO horizontal padding on these two branches. EmptyState/ErrorState
              render their own `dock` card; inset inside the page panel — which
              is itself a rounded card — that produced TWO nested rounded
              frames a few px apart, visible on device. The thread LIST below
              keeps its padding, because rows do need to clear the panel edge.
              Same defect and same fix as Activity's empty state. */}
          {!loading && loadError && conversations.length === 0 ? (
            <div className="flex-1 min-h-0 flex" data-thread-area>
              <ErrorState
                title="We couldn't load your messages."
                onRetry={() => { void retryInbox(); }}
              />
            </div>
          ) : !loading && conversations.length === 0 && !isSpecialFilterView ? (
            // `conversations` (the default inbox, archived threads already
            // dropped) being empty does NOT mean Pinned/Recently Deleted are
            // empty too — they read a DIFFERENT source (orderedConversations
            // / allConversations, see filteredConversations above). Gating
            // this global "No messages yet" state on the default inbox alone
            // meant archiving your one thread made Recently Deleted
            // permanently show "No messages yet" instead of the thread you
            // just hid — the exact thing that view exists to surface.
            <div className="flex-1 min-h-0 flex" data-thread-area>
              <EmptyState
                icon={MessageSquare}
                illustration={<EmptyStateIllustration variant="inbox" />}
                eyebrow="Quiet for now"
                title="No messages yet"
                body="Apply to a job or accept a Helpr's offer — conversations appear here once they start."
                action={
                  <BarkPillButton onClick={() => navigate("/dashboard")}>
                    Browse Jobs
                  </BarkPillButton>
                }
              />
            </div>
          ) : (
          <PullToRefreshWrapper
            data-thread-area
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 min-h-0 px-3 py-3"
            style={{
              /* CLEARANCE FOR THE DOCK, AND ONLY WHERE THE DOCK EXISTS
                 (owner, 2026-09-19: "messages need to fill the screen").

                 96px is AppShell's `reserveBottomNav` clearance — the floating
                 MobileNav pill plus the Post FAB, which ride in the same
                 `.mobile-nav-frame`. On the desktop website that frame is
                 `display: none !important` (index.css, `html.web-desktop
                 .mobile-nav-frame`), so the reserve was holding open 96px of
                 scroll for something that is not painted: the inbox ran out of
                 threads ~96px above the panel's bottom edge, and since the
                 panel itself runs flush to the viewport floor on desktop
                 (pageCardSurfaces' zeroed bottom radii — owner, 2026-09-16,
                 panels are NOT curved at the bottom), that reserve read as the
                 list simply stopping short of the screen.

                 This used to be keyed on `embedded`, which no production
                 caller ever sets, so the trim never once ran. It is keyed on
                 `useIsWebDesktop()` now — the SAME predicate that puts the
                 `web-desktop` class on <html>, which is the only thing that
                 hides the dock. Those are two separate literals in two files
                 (useIsWebDesktop.ts and useAppShellViewport.ts), so a guard
                 asserts they stay identical; if they ever drift, this padding
                 would come off at a width where the dock is still painted and
                 the last thread would hide behind it.

                 Desktop keeps a real 1rem gutter rather than zero — the panel
                 has no bottom edge there, so 0 would leave the final row
                 sitting on the viewport floor. The safe-area term stays in:
                 web-desktop is a BROWSER at >=900px, which includes an iPad in
                 landscape with a home indicator.

                 Phone and native are untouched: `isWebDesktop` is false at
                 every phone width and on native at every size, so this is the
                 same string it has always been there, and the dock clearance
                 is load-bearing. */
              paddingBottom: isWebDesktop
                ? "calc(var(--safe-area-bottom, 0px) + 1rem)"
                : "calc(var(--safe-area-bottom, 0px) + 96px)",
            }}
          >
          <div className="space-y-2">
          {/* ── THE HIDDEN-UNREAD BANNER ────────────────────────────────────
              The price of landing on Active (owner, 2026-09-19), paid openly.

              Active is `LIVE_JOB_STATUSES`, which does NOT include `open` —
              so an applicant's unread question about a posting you have not
              awarded yet, the single most common unread thread a poster gets,
              is NOT in the tab the inbox now opens on. "Opens to Active" must
              never mean "hides something you have not read".

              This is the only place that can say so, and it matters most on
              PHONE: the tab strip lives behind a disclosure that starts
              collapsed, so the "All N" count is not even on screen. There is
              no Unread tab to fall back on any more either — it was removed
              the same day.

              Shown only when there is genuinely something concealed: on
              Active, not searching, with at least one unread thread outside
              the live slice. It sends the reader to All (the widest view),
              not to a filter, because the point is to stop hiding. */}
          {!loading && inboxTab === "active" && !searchQuery.trim() && hiddenUnreadCount > 0 && (
            <button
              type="button"
              onClick={() => { hapticLight(); setInboxFilter(UNFILTERED_INBOX_TAB); }}
              className="w-full flex items-center gap-2 rounded-ds-md px-3 py-2.5 btn-press transition-colors text-left"
              style={{
                background: "hsl(var(--amber-tint) / 0.10)",
                border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
              }}
            >
              <span
                className="shrink-0 w-2 h-2 rounded-full"
                style={{ background: "hsl(var(--burnt-sienna))" }}
                aria-hidden="true"
              />
              <span
                className="font-sans text-ds-13 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.9)" }}
              >
                {hiddenUnreadCount === 1
                  ? "1 unread conversation isn't in Active — show all"
                  : `${hiddenUnreadCount} unread conversations aren't in Active — show all`}
              </span>
            </button>
          )}
          {/* ── THE AGED-OUT NOTE ───────────────────────────────────────────
              "Keep them, auto-hide after a while. Never delete" (owner,
              2026-09-19). Hiding silently is how "hidden" becomes "I lost my
              messages", so All says how many finished threads it is holding
              back and how to reach them. The answer is the search box, which
              deliberately ignores the age rule (see filteredConversations).
              Not a button: there is no "show them all" tab to send anyone to,
              and inventing one would undo the decision. */}
          {!loading && inboxTab === "all" && !searchQuery.trim() && agedOutCount > 0 && (
            <p
              role="status"
              className="font-sans text-ds-12 leading-snug px-3 py-2"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              {agedOutCount === 1
                ? `1 finished conversation is older than ${THREAD_AGE_OUT_DAYS} days and is tucked away. It's still here — search for the person or the job to open it.`
                : `${agedOutCount} finished conversations are older than ${THREAD_AGE_OUT_DAYS} days and are tucked away. They're still here — search for the person or the job to open one.`}
            </p>
          )}
          {loading ? (
            /* No `space-y` here on purpose. The real list stacks
               ConversationRows flush and divides them with each row's own
               inset hairline; an 8px gap between bones put the placeholder
               list at a 76px pitch against the real 64px, so every row below
               the first slid up when the inbox landed. The bones carry the
               same hairline and stack the same way.

               SIX, not four. The panel is ~600px tall at 375 and a 64px row
               fills it six times over — four bones left a third of the list
               blank and then filled in, which reads as the page growing. Six
               is a FLOOR, not a promise: the real count is unknowable while
               the query is out, so reserve what the viewport will hold and let
               a longer list extend past the fold, where nothing is displaced. */
            <div>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <MessageThreadSkeleton key={i} />
              ))}
            </div>
          ) : noTabMatches ? (
            <div className="flex flex-col items-center text-center py-14 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--success-ink) / 0.10)",
                  border: "0.5px solid hsl(var(--success-ink) / 0.24)",
                }}
              >
                <MessageSquare className="w-5 h-5" style={{ color: "hsl(var(--success-ink))" }} strokeWidth={1.75} />
              </div>
              <p
                className="font-display italic font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {/* The "You're all caught up" variant went with the Unread
                    tab on 2026-09-19 — it was that tab's empty state and
                    nothing else can reach it now. */}
                Nothing here right now
              </p>
              <p
                className="font-sans text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* NAME THE NUMBER, the way My Jobs does ("you have 3 in
                    Waiting and 2 in Done"). This is the one place the counts
                    the collapsed header folds away are genuinely owed to the
                    reader: the list below is empty, so it cannot show them,
                    and "Switch to All" without a number asks you to go and
                    check whether there is anything over there at all. */}
                {inboxTab === "pinned"
                  ? "No conversations are pinned. Swipe a thread right to pin it."
                  : inboxTab === "recentlyDeleted"
                    ? "Nothing hidden. Swipe a thread left to hide it — it stays here, not deleted."
                    : inboxTab === "active"
                      /* THE ACTIVE EMPTY STATE, and the one the Active
                         default made common: a user whose jobs have all
                         finished now LANDS here, where All would have shown
                         them threads. It has to read as "nothing is running",
                         never as "your inbox is broken" — so it names the
                         reason, and the button beneath it names the number
                         waiting under All. */
                      ? "No conversations belong to a job that's still running. Finished ones are under All."
                      : "No conversations match this view."}
              </p>
              {/* THE COUNT, and a way to ACT on it — the "Show Waiting (3)"
                  button My Jobs puts under the same copy, which is where that
                  screen surfaces the numbers its own collapsed header folds
                  away. This is the one place Messages' counts are genuinely
                  owed to the reader: the list is empty, so it cannot show them,
                  and "switch to All" without a number asks you to go and check
                  whether there is anything over there at all. Carrying the
                  number HERE rather than in the sentence also keeps the prose
                  from saying "All" twice in one line.

                  Only for Active, the one tab whose fix really is "switch to
                  All" (Unread, the other one, was removed on 2026-09-19).
                  Pinned and Recently Deleted are told to swipe instead: there
                  is nothing under All to send them to.

                  The count is `allTabConversations`, the same number the All
                  tab prints — promising "Show All (12)" and then rendering 9
                  because the age rule trimmed three would be a fresh lie.

                  UNFILTERED_INBOX_TAB, not DEFAULT_INBOX_TAB. Those were the
                  same constant until 2026-09-19, when the landing tab became
                  Active; a button labelled "Show All" that set the default
                  would, from the Active empty state, set Active again and do
                  nothing at all. */}
              {inboxTab === "active" && allTabConversations.length > 0 && (
                <BarkPillButton onClick={() => { hapticLight(); setInboxFilter(UNFILTERED_INBOX_TAB); }}>
                  Show All ({allTabConversations.length})
                </BarkPillButton>
              )}
            </div>
          ) : noSearchMatches ? (
            /* Active search filtered every thread out — a tidy in-place
               message rather than an empty list. */
            <div className="flex flex-col items-center text-center py-14 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--ivory-sand) / 0.6)",
                  border: "0.5px solid hsl(var(--olivewood) / 0.16)",
                }}
              >
                <Search className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} strokeWidth={1.75} />
              </div>
              <p
                className="font-display italic font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No conversations match
              </p>
              <p
                className="font-sans text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* Same generic search-empty state as the default inbox, but
                    scoped so it doesn't read as "you have zero X" — it means
                    "zero X match this search," which is a different claim
                    when X is Pinned or Recently Deleted specifically. */}
                {isSpecialFilterView
                  ? `Try a different name or keyword, or clear the search to see all ${inboxTab === "pinned" ? "pinned" : "hidden"} threads.`
                  : "Try a different name or keyword."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const visibleConvos = showAllConvos
                  ? filteredConversations
                  : filteredConversations.slice(0, CONVO_LIMIT);
                return (
                  <VirtualList
                    items={visibleConvos}
                    getKey={(c) => `${c.jobId}_${c.otherUserId}`}
                    estimateSize={80}
                    overscan={6}
                    /* /messages is an AppShell route, deliberately OFF
                       DOCUMENT_SCROLL_ROUTES, so `html.app-shell` pins
                       window.scrollY at 0 and a window virtualizer never
                       advances. The inbox scrolls inside
                       PullToRefreshWrapper — that is the scroll source.
                       Measured before this prop: 16 of 29 threads mounted at
                       375, unchanged after scrolling 1758px; the rest of the
                       panel was blank. */
                    scrollElementRef={containerRef}
                    virtualizerRef={listHandleRef}
                    renderItem={(c) => {
                      const key = `${c.jobId}_${c.otherUserId}`;
                      const pinned = pinnedSetForRender.has(
                        pinnedKey(c.jobId, c.otherUserId),
                      );
                      // In the desktop split, highlight the row whose thread
                      // is open in the right pane so the inbox tracks the
                      // selection. No-op on mobile (activeKey stays null).
                      const isActive = !!activeKey && activeKey === key;
                      const selected = selectedKeys.has(key);
                      const row = (
                        <div className="relative">
                          {/* Tiny pin chip — peeks over the top-right
                              corner of the avatar so a pinned row reads at a
                              glance. Hidden when not pinned, and while
                              selecting (the checkbox takes that corner). */}
                          {pinned && !selectMode && (
                            <span role="img"
                              aria-label="Pinned"
                              className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full pointer-events-none"
                              style={{
                                background: "hsl(var(--burnt-sienna) / 0.9)",
                                boxShadow:
                                  "0 1px 3px hsl(var(--burnt-sienna) / 0.45)",
                              }}
                            >
                              <Pin
                                className="w-2.5 h-2.5"
                                style={{ color: "hsl(var(--parchment))" }}
                                strokeWidth={2.4}
                              />
                            </span>
                          )}
                          {/* Recently Deleted view: a real "un-hide" control,
                              not just a re-visit. Swiping isn't available
                              here (that's the archive gesture itself, and
                              re-archiving an already-archived thread is a
                              dead end), so restore needs its own button. */}
                          {isRecentlyDeletedView && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!userId) return;
                                unarchiveConversation(userId, c.jobId, c.otherUserId);
                                // Archive has an explicit confirm dialog
                                // ("Hide 1 conversation?"); Restore was the
                                // only one-tap action here with no feedback
                                // beyond the row silently vanishing from
                                // THIS list — a toast closes that gap without
                                // adding a confirm step Restore doesn't need
                                // (it's the non-destructive direction).
                                hapticLight();
                                toast(`Restored conversation with ${c.otherUserName ?? "this person"}`);
                              }}
                              aria-label={`Restore conversation with ${c.otherUserName ?? "this person"}`}
                              className="absolute top-1/2 -translate-y-1/2 right-2 z-10 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-ds-sm text-ds-11 font-sans font-semibold btn-press transition-colors"
                              style={{
                                background: "hsl(var(--bark) / 0.10)",
                                color: "hsl(var(--bark))",
                              }}
                            >
                              <RotateCcw className="w-3 h-3" />
                              Restore
                            </button>
                          )}
                          <ConversationRow
                            convo={c}
                            currentUserId={userId}
                            openConvo={openConvo}
                            isActive={isActive}
                            selectMode={selectMode}
                            selected={selected}
                            onToggleSelect={() => toggleSelect(c)}
                          />
                        </div>
                      );
                      // Swipe gestures (archive / pin) are inert in select
                      // mode, and meaningless in the Recently Deleted view
                      // (Restore replaces them there) — render the bare row
                      // so a drag can't fire an archive mid-selection or
                      // re-archive an already-archived thread.
                      return selectMode || isRecentlyDeletedView ? row : (
                        <SwipeableConversationRow
                          isPinned={pinned}
                          onArchive={() => handleArchive(c)}
                          onTogglePin={() => handleTogglePin(c)}
                        >
                          {row}
                        </SwipeableConversationRow>
                      );
                    }}
                  />
                );
              })()}
              {!showAllConvos && filteredConversations.length > CONVO_LIMIT && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={() => setShowAllConvos(true)}
                    className="btn-press inline-flex items-center justify-center rounded-ds-md px-4 py-1.5 text-ds-13 font-medium transition-colors"
                    style={{
                      background: "hsl(var(--parchment) / 0.8)",
                      color: "hsl(var(--bark))",
                      border: "1px solid hsl(var(--bark) / 0.22)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
                        "0 1px 2px hsl(var(--bark) / 0.10)",
                    }}
                  >
                    Show All {filteredConversations.length} Conversations
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
          </PullToRefreshWrapper>
          )}

          {/* Multi-select action bar.
              
              This used to be an in-flow `shrink-0` row that padded itself by
              `safe-area + 88px` to clear the floating nav dock. In-flow, that
              reserve is not clearance — it is 88px of card-coloured padding
              rendered BELOW the buttons, so select mode showed a dead white
              band between Cancel/Delete and the bottom of the screen.

              It is now a fixed floating bar, which is what the app already
              does for this exact interaction on Activity (`BulkDismissBar`).
              Same ink pill, same safe-area maths, same left-count /
              right-actions arrangement — so the two bulk-select surfaces stop
              being two different inventions of the same control.

              The count moved in here with it; the toolbar's "N/3 selected"
              text is gone, because with both present the same number was on
              screen twice. */}
          {selectMode && hasThreads && (
            <div
              role="toolbar"
              aria-label="Bulk hide action bar"
              // Embedded (desktop split): anchor inside the list pane so the
              // bar doesn't stretch across the thread pane; standalone keeps
              // the fixed viewport-bottom float above the nav dock.
              className={`${embedded ? "absolute" : "fixed"} inset-x-0 z-40 px-4`}
              style={{ bottom: embedded ? "1rem" : "calc(var(--safe-area-bottom, 0px) + 80px)" }}
            >
              <div
                className="mx-auto max-w-xl flex items-center justify-between gap-3 px-4 py-3 rounded-ds-md"
                style={{
                  background: "hsl(var(--ink-deep))",
                  boxShadow: "0 12px 28px hsl(var(--ink-deep) / 0.32)",
                }}
              >
                <span
                  className="text-ds-13 font-semibold truncate"
                  style={{ color: "hsl(var(--parchment))" }}
                  aria-live="polite"
                >
                  {selectedKeys.size === 0
                    ? "Tap to select"
                    : `${selectedKeys.size} of ${MAX_SELECT} selected`}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={exitSelectMode}
                    aria-label="Cancel selection"
                    // Rest fill as a CLASS, not inline: an inline background
                    // beats the stylesheet, so no hover tint could ever land
                    // on it. Same computed value, and `.ctl-tint-invert` (the
                    // tone for chrome on a permanently dark ground) can now
                    // paint. `.ctl-exit` is the one exit shape — src/index.css.
                    className="h-9 w-9 ctl-exit bg-[hsl(var(--parchment)/0.06)] ctl-tint-invert inline-flex items-center justify-center btn-press transition"
                    style={{ color: "hsl(var(--parchment) / 0.85)" }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    disabled={selectedKeys.size === 0}
                    // "Hide", not "Delete" — the action is the same honest
                    // local archive every other surface calls hiding ("no
                    // messages are deleted"); the bar must not promise more.
                    aria-label={`Hide ${selectedKeys.size} selected conversation${selectedKeys.size === 1 ? "" : "s"}`}
                    className="h-9 px-3 rounded-ds-md inline-flex items-center gap-1.5 text-ds-13 font-semibold btn-press transition disabled:opacity-40 disabled:pointer-events-none"
                    style={{
                      background: "hsl(var(--burnt-sienna))",
                      color: "hsl(var(--parchment))",
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    Hide
                  </button>
                </div>
              </div>
            </div>
          )}

    </>
  );

  // Embedded (desktop list+thread split): just the inbox body, no
  // PageScaffold shell or title card — the parent provides the outer
  // shell and a shared title card spanning both panes.
  if (embedded) {
    // `relative` so the embedded select-mode action bar anchors to this
    // pane instead of the viewport.
    return (
      <div className="relative flex-1 min-h-0 flex flex-col">
        {headerEl}
        {listBody}
      </div>
    );
  }

  return (
    // No "N threads" chip above the list: the list directly below IS the
    // count, and the empty state already says there's nothing — the same
    // redundant count line removed from Activity, /jobs, and the browse
    // toolbar. The desktop split's bar keeps its UNREAD pill, which is real
    // information you can't get by glancing at the list.
    // The page's h1 lives in the toolbar row (visible on phone/native,
    // sr-only when embedded, and an sr-only stand-in during search/select
    // modes), which is what the title card renders.
    /* ONE BOX on the desktop website, exactly as Activity does it
       (Activity.tsx:484-496; owner, 2026-09-16: Messages was "the only page
       with a separate top panel"). Home, My Posts and My Jobs all fold their
       header into the panel at ≥900px; Messages was still passing a title
       card unconditionally, so it alone showed two stacked boxes.

       Phone and native keep the two-card stack — there the header carries the
       VISIBLE page name (no app bar exists to carry it). `isWebDesktop` is
       false at every phone width and on native at every size, so that
       rendering is untouched. */
    <PageScaffold
      titleCard={isWebDesktop ? undefined : headerEl}
      titleCardClassName={isWebDesktop ? undefined : MESSAGES_HEADER_PADDING}
    >
      {isWebDesktop && (
        /* The wrapper owns the hairline and the horizontal padding, the same
           way Activity's does — which is why the row's own `px-4` /
           `minHeight: 52px` / `borderBottom` stay keyed to `embedded` below
           and are NOT doubled up here. */
        <div
          className="shrink-0 px-5 py-1"
          style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          {headerEl}
        </div>
      )}
      {listBody}
    </PageScaffold>
  );
}
