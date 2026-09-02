import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { defaultInboxTab } from "@/lib/inboxDefault";
import { CheckSquare, ChevronDown, Menu, MessageSquare, Pin, RotateCcw, Search, Trash2, X } from "lucide-react";
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
import { VirtualList } from "@/components/VirtualList";
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
   *  before. The selected thread is highlighted via `activeKey`. */
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
 * The tab this inbox calls "unfiltered", read from the same function the
 * default-tab effect below seeds its state with — so the disclosure and the
 * seeding rule can never disagree about what "unfiltered" means. Mirrors
 * ActivityHeader's DEFAULT_STATUS_FILTER for exactly the same reason.
 *
 * The argument is the unread count; `defaultInboxTab` ignores it and always
 * answers "all" (owner, 2026-08-30 — see lib/inboxDefault.ts), so 0 is a
 * truthful stand-in for "whatever the rule says with nothing unread".
 */
const DEFAULT_INBOX_TAB = defaultInboxTab(0);

/**
 * The id the disclosure's `aria-controls` points at.
 *
 * Exactly ONE of the two tab placements renders at a time (the inline desktop
 * one under `embedded`, the phone row under `!embedded`), so a single id stays
 * unique and the attribute resolves on whichever surface is live. Activity hit
 * the opposite of this: its desktop chevron pointed at an id that only existed
 * in the phone branch, which axe flags `aria-valid-attr-value` critical.
 */
const INBOX_TABS_ID = "messages-inbox-tabs";

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
  /* Which slice of the inbox. All is the default (owner, 2026-08-30) — see
     defaultInboxTab in lib/inboxDefault.ts. Resolved once, on mount, from
     the first load; changing tabs after that is the user's business.

     `null` means "not chosen yet" so the effect below can seed it as soon as
     the first page of threads lands. */
  const [inboxFilter, setInboxFilter] = useState<string | null>(null);
  /* ── The tab row's disclosure ──────────────────────────────────────────
     Messages opens COLLAPSED, exactly like My Posts / My Jobs (owner, from a
     device: "Messages should also be collapsed when opened, add that"). It was
     the only one of the three that opened with its filter row already down,
     which made this title card 122px against their 62px — measured at 320 /
     375 / 393 / 768 before the change.

     Deliberately the SAME shape as ActivityHeader's `tabsOpenPhone`, not a new
     invention: a plain component-local `useState`, so the state is per-visit
     and never persisted, and a chevron that only rotates (no height tween) —
     if the two screens remembered their disclosure differently, "the same
     control" would be a lie the second time you opened one.

     It starts open only when a NON-default filter is active. Collapsing a
     screen that is silently showing you a subset (the hamburger's Pinned /
     Recently Deleted views land here) would leave the reader looking at two of
     their six threads with nothing on screen saying why. The disclosure hides
     a control, never an active filter — ActivityHeader's rule, verbatim.

     `embedded` (the desktop website's list+thread split) has no disclosure at
     all: the tabs ride inline beside the screen name there, where there is
     room for them, which is what `inlineFilters` does on Activity. */
  const isDefaultInboxFilter = (inboxFilter ?? DEFAULT_INBOX_TAB) === DEFAULT_INBOX_TAB;
  const [tabsOpenPhone, setTabsOpenPhone] = useState(false);
  const tabsOpen = embedded || tabsOpenPhone;
  // A filter arriving LATER — the hamburger switching to Pinned / Recently
  // Deleted — has to be able to open the disclosure too, or the same
  // "filtered, but nothing says so" state comes back through the side door.
  useEffect(() => {
    if (!isDefaultInboxFilter) setTabsOpenPhone(true);
  }, [isDefaultInboxFilter]);
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
  const filteredConversations = useMemo(() => {
    // Tab first, then the search box. Searching inside the slice you are
    // looking at is what a two-control list is expected to do; searching the
    // whole inbox while a tab says "Unread" would make the tab a lie.
    const byTab =
      inboxFilter === "unread"
        ? orderedConversations.filter((c) => c.unread > 0)
        : inboxFilter === "active"
          ? orderedConversations.filter(
              (c) => c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus),
            )
          : inboxFilter === "pinned"
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
            : inboxFilter === "recentlyDeleted"
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
              : orderedConversations;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter((c) => {
      const name = c.otherUserName?.toLowerCase() ?? "";
      const snippet = c.lastMessage?.toLowerCase() ?? "";
      const title = c.jobTitle?.toLowerCase() ?? "";
      return name.includes(q) || snippet.includes(q) || title.includes(q);
    });
  }, [orderedConversations, searchQuery, inboxFilter, userId, pinNonce, allConversations, archiveNonce]);
  const isRecentlyDeletedView = inboxFilter === "recentlyDeleted";
  // Pinned and Recently Deleted both read a different source than the
  // default inbox (see filteredConversations above), so an empty default
  // inbox must not blank either of them out — see the render-gate comment
  // below where this is used.
  const isSpecialFilterView = inboxFilter === "pinned" || isRecentlyDeletedView;

  // Seed the default tab from the FIRST loaded page, once. See the state decl.
  // The rule itself lives in `defaultInboxTab` so the app and its tests read it
  // from ONE place: Unread when there IS unread, otherwise All. Opening a
  // caught-up inbox on an empty Unread tab hid every thread the user had behind
  // "You're all caught up", with nothing to say the tab had moved.
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
     while the Unread tab was showing nothing — and the list column rendered as a
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
    // Only react to the nonce changing (exitSelectMode is stable).
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
  // Unread/Active/All tabs, the Select/Search cluster, and the select-mode
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
  // This cannot be made jump-free in both directions: the loading frame has to
  // guess one of the two outcomes, and whichever it guesses, the other one moves
  // by the tab row's height. It now guesses "no controls", so the empty inbox —
  // the reported bug, and the case where a control genuinely disappears — is
  // stable from first paint, and the populated inbox instead gains the tab row
  // once, in the same frame its four skeletons are replaced by real rows.
  // Reserving the height instead would not help the empty case at all: it would
  // collapse on load exactly as it does today, or keep a permanent 57px dead
  // band above the empty state.
  const hasThreads = !loading && !loadError && conversations.length > 0;

  // Header second line, matching the Activity pages ("My Jobs" / "All · 4").
  //
  // Messages has no status filter, so there is no filter label to hoist — but
  // an inbox does have one number worth stating up front, which is how much is
  // waiting on you. Threads, not messages: "2 unread" means two conversations
  // need a reply, which is the actionable unit here.
  //
  // Omitted entirely at zero rather than rendering "0 unread" — a caught-up
  // inbox should say nothing, not report an absence.
  const unreadThreads = conversations.filter((c) => c.unread > 0).length;
  /* The inbox had no filter at all — a single undifferentiated list, with
     "2 unread" printed beside the title as the only acknowledgement that some
     threads want you and the rest don't (owner: "i think unread should be the
     default tab??" and "where are the other options?").

     Three slices, and they answer three different questions: who is waiting on
     me, which conversations belong to work that is still running, and
     everything. Same control My Posts / My Jobs use — literally the same
     component — because "which slice of this list am I looking at" is one idea
     and the app should express it one way.

     The count beside "Unread" is what "2 unread" used to say, so that caption
     comes out rather than sitting next to a tab that already says it. */
  const activeThreads = conversations.filter(
    (c) => c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus),
  ).length;

  // Pull-to-refresh: swiping down on the list re-runs loadConversations.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { if (userId) await loadConversations(userId); },
  });

  // The title card holds the toolbar itself — the name, the Select/Search
  // cluster and (on phone) the Unread/Active/All tabs. It does NOT hold a
  // "N threads" chip: that restated the thread list directly beneath it, the
  // same count box My Posts / My Jobs dropped.

  const inboxTabs = (
    <UnderlineTabs
      dense={embedded}
      ariaLabel="Filter conversations"
      tabs={[
        { key: "all", label: "All", count: conversations.length },
        { key: "unread", label: "Unread", count: unreadThreads },
        { key: "active", label: "Active", count: activeThreads },
      ]}
      value={inboxFilter ?? "all"}
      onChange={setInboxFilter}
    />
  );

  // Neither "Pinned" nor "Recently Deleted" is one of the three visible
  // tabs (both are reached via the hamburger instead), so with either
  // active none of the underline tabs highlight — this chip is the only
  // thing telling the user why the list shrank and how to get back.
  const pinnedFilterChip = (inboxFilter === "pinned" || inboxFilter === "recentlyDeleted") && (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setInboxFilter("all")}
        className="flex items-center gap-1.5 px-4 py-1.5 text-ds-11 font-sans font-semibold"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        {inboxFilter === "pinned" ? <Pin className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
        {inboxFilter === "pinned" ? "Showing pinned only" : "Showing recently deleted"}
        <X className="w-3 h-3" />
      </button>
      {/* Two honesty notes, since "Recently Deleted" as a name implies both
          "temporary" and "complete" and this view is neither: hiding a
          thread never expires it on its own (it stays hidden until you
          restore it, not just for N days), and very old archives can fall
          outside the 200-message fetch window (see the onClick refresh
          above) and simply not be resolvable here yet. */}
      {inboxFilter === "recentlyDeleted" && (
        <p className="px-4 pb-1 text-ds-10 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>
          Hidden threads stay here until restored — not on a timer. Very old ones may take a refresh to appear.
        </p>
      )}
    </div>
  );

  /* Select mode and search mode each take the WHOLE row over. ScreenHeaderRow's
     `children` branch is precisely that escape hatch: it keeps the row geometry
     and still renders the page's h1 `sr-only`, so Messages never has zero
     headings while a text input is standing in for its name. Null in the normal
     state, which is what puts the row back on its title / meta / actions
     branch. */
  const rowTakeover = selectMode ? (
    /* Select mode — the row is just the page name's stand-in. The live
       "N/3 selected" count lives in the floating action bar at the bottom of
       the list (see below); having it here too put the same number on screen
       twice. */
    <span className="flex-1 text-ds-13 font-medium" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {selectedKeys.size}/{MAX_SELECT} selected
    </span>
  ) : searchOpen ? (
    /* Search mode — input replaces the row inline (iOS pattern). */
    <>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          autoFocus
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          spellCheck={false}
          className="w-full pl-9 pr-9 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
        />
        {searchQuery && (
          // Fixed 24×24 circle, inset a touch further than the old bare icon
          // so its hover/active/focus-visible ring stays inside the field's
          // rounded-ds-md edge instead of poking past it. The old version had
          // no explicit box — just an icon glyph — so the browser's default
          // focus outline and any hover fill drew flush against (and past)
          // the field boundary.
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--olivewood)/0.10)] active:bg-[hsl(var(--olivewood)/0.16)] btn-press transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => { hapticLight(); setSearchOpen(false); setSearchQuery(""); }}
        className="shrink-0 text-ds-13 font-medium btn-press py-2"
        style={{ color: "hsl(var(--bark))" }}
      >
        Cancel
      </button>
    </>
  ) : null;

  /* What sits beside the screen name: on the DESKTOP website, the tabs
     themselves — exactly as they do on My Posts / My Jobs, where there is width
     to spare beside the name and nothing needs to hide behind a chevron.
     Nothing at all on phone.

     WHAT ABOUT THE COUNTS the collapsed row folds away ("All 2 · Unread 1 ·
     Active")? A "1 unread" caption beside the title was the obvious answer and
     it was wrong, measured: at 393 the row is 353px of card, the three 44px
     controls and their gaps take 144 of it, and the caption plus its gap takes
     73 more — which leaves 96px for a title that needs 101. The screen's own
     NAME truncated to "Messag…" to make room for a number. That is a worse
     trade than the one it was fixing, and it showed up at 375 and 393, the two
     widths that matter most.

     It is also a number the reader already has three ways over. The dock's
     Messages tab carries a live unread badge on every screen in the app; each
     unread thread in the list below wears its own dot and bold ink; and "All N"
     is just the length of that list. My Posts and My Jobs make the same call —
     neither surfaces its collapsed counts on the row. Where they DO surface
     them is the one place the list cannot speak for itself: an empty view,
     where My Jobs says "you have 3 in Waiting and 2 in Done" rather than
     leaving you to go hunting. Messages' tab-empty copy does the same (see
     noTabMatches below), and that is where the counts were owed. */
  const headerMeta =
    embedded && hasThreads ? <div id={INBOX_TABS_ID}>{inboxTabs}</div> : undefined;

  /* The trailing icon cluster.
     Search · chevron · hamburger, in that order — the chevron sits NEXT TO
     SEARCH, which is where the owner put it on Activity ("add a dropdown arrow
     next to search so these aren't always showing"), and the overflow menu
     stays last, where an overflow menu belongs.

     All three share ONE class, and it is ActivityHeader's: the chevron cannot
     be a different ink from the search glyph beside it, and Messages' cluster
     should not be a different ink from the identical cluster on My Jobs. */
  const headerActions = (
    <>
      {/* Pinned/Recently Deleted read a different source than the default
          inbox (see isSpecialFilterView above), so they can have their own
          threads to search even when hasThreads (the DEFAULT inbox) is
          false. */}
      {(hasThreads || isSpecialFilterView) && (
        <button
          type="button"
          onClick={() => { hapticLight(); setSearchOpen(true); }}
          aria-label="Search conversations"
          className={HEADER_ICON_BUTTON_CLASS}
        >
          <Search className="w-4 h-4" />
        </button>
      )}
      {/* THE DISCLOSURE — the same control, glyph and rotation My Posts / My
          Jobs use, so "collapsed when opened" is one behaviour across the three
          screens rather than three near-misses. Not rendered when `embedded`:
          the desktop split shows the tabs inline and a chevron there would hide
          three short words to save nothing (ActivityHeader drops it under
          `inlineFilters` for the same reason).

          Gated on `hasThreads` alongside search — with no threads there is
          nothing to slice, and the empty state below already says so. */}
      {!embedded && hasThreads && (
        <button
          type="button"
          onClick={() => { hapticLight(); setTabsOpenPhone((v) => !v); }}
          aria-expanded={tabsOpen}
          /* Only while the panel EXISTS. The tabs unmount when collapsed, so
             emitting this unconditionally points at a missing id — axe flags it
             `aria-valid-attr-value` critical, and it is a real lie to a screen
             reader. */
          aria-controls={tabsOpen ? INBOX_TABS_ID : undefined}
          aria-label={tabsOpen ? "Hide conversation filters" : "Filter conversations"}
          className={`${HEADER_ICON_BUTTON_CLASS} ${
            // No filled pill: the chevron's ROTATION already carries
            // open/closed. The ink darkens while a non-default slice is on, so
            // a filtered inbox is never silent even with the row folded away.
            isDefaultInboxFilter ? "" : "!text-[hsl(var(--bark))]"
          }`}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${tabsOpen ? "rotate-180" : ""}`}
            strokeWidth={2.25}
          />
        </button>
      )}
      {/* Hamburger — the OVERFLOW MENU, not the disclosure. It opens Select
          messages / Pinned / Recently Deleted: one bulk action and two views
          onto data the three tabs do not cover. It stays exactly as it was —
          the chevron above is an addition, not a replacement — because
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
            titleSrOnly={embedded}
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
          >
            {rowTakeover}
          </ScreenHeaderRow>
          {/* PHONE: the same tabs, on their own line under the toolbar — there
              is no room for them beside a visible "Messages" title and the
              action cluster. Behind the disclosure now (see tabsOpen), so this
              screen opens at My Posts' / My Jobs' height instead of twice it.
              Still hidden while search or select mode has taken the row over:
              one control at a time. */}
          {!embedded && hasThreads && tabsOpen && !searchOpen && !selectMode && (
            /* `-mx-1 px-1 pb-0.5`, not the `pt-1.5` this used to carry — these
               are ActivityHeader's exact classes, so the card matches My Posts
               / My Jobs at 118px EXPANDED as well as at 62px collapsed. (With
               the top pad it measured 122 against their 118: four pixels, but
               four pixels of nothing, on the one screen the owner had just
               asked to stop being the odd one out.) The negative margin keeps
               the tabs' focus rings inside the scroller rather than clipped by
               it; the scroller itself is insurance for 320px, where three
               labels are already comfortable. */
            <div id={INBOX_TABS_ID} className="shrink-0 -mx-1 px-1 pb-0.5 overflow-x-auto scrollbar-hide">
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
            <div className="flex-1 min-h-0 flex">
              <ErrorState
                title="We couldn't load your messages."
                onRetry={() => { if (userId) loadConversations(userId); }}
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
            <div className="flex-1 min-h-0 flex">
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
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 min-h-0 px-3 py-3"
            style={{
              // Mobile pads for the floating dock; the desktop split pane
              // has no dock, so the 96px reserve would just be dead scroll
              // space — trim it to a normal gutter when embedded.
              paddingBottom: embedded
                ? "1rem"
                : "calc(var(--safe-area-bottom, 0px) + 96px)",
            }}
          >
          <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
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
                {inboxFilter === "unread" ? "You're all caught up" : "Nothing here right now"}
              </p>
              <p
                className="font-serif italic text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* NAME THE NUMBER, the way My Jobs does ("you have 3 in
                    Waiting and 2 in Done"). This is the one place the counts
                    the collapsed header folds away are genuinely owed to the
                    reader: the list below is empty, so it cannot show them,
                    and "Switch to All" without a number asks you to go and
                    check whether there is anything over there at all. */}
                {inboxFilter === "unread"
                  ? "Every thread has been read — nothing is waiting on you."
                  : inboxFilter === "pinned"
                    ? "No conversations are pinned. Swipe a thread right to pin it."
                    : inboxFilter === "recentlyDeleted"
                      ? "Nothing hidden. Swipe a thread left to hide it — it stays here, not deleted."
                      : "No conversations belong to a job that's still running."}
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

                  Only for the two tabs whose fix really is "switch to All".
                  Pinned and Recently Deleted are told to swipe instead: there
                  is nothing under All to send them to. */}
              {(inboxFilter === "unread" || inboxFilter === "active") && conversations.length > 0 && (
                <BarkPillButton onClick={() => { hapticLight(); setInboxFilter(DEFAULT_INBOX_TAB); }}>
                  Show All ({conversations.length})
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
                className="font-serif italic text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* Same generic search-empty state as the default inbox, but
                    scoped so it doesn't read as "you have zero X" — it means
                    "zero X match this search," which is a different claim
                    when X is Pinned or Recently Deleted specifically. */}
                {isSpecialFilterView
                  ? `Try a different name or keyword, or clear the search to see all ${inboxFilter === "pinned" ? "pinned" : "hidden"} threads.`
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
                            <span
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
                    className="h-9 w-9 rounded-ds-md inline-flex items-center justify-center btn-press transition"
                    style={{
                      color: "hsl(var(--parchment) / 0.85)",
                      background: "hsl(var(--parchment) / 0.06)",
                    }}
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
    <PageScaffold titleCard={headerEl} titleCardClassName={MESSAGES_HEADER_PADDING}>
      {listBody}
    </PageScaffold>
  );
}
