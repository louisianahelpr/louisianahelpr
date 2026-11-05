import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { coerceInboxView, defaultInboxTab } from "@/lib/inboxDefault";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSearchOnOwnLine } from "@/components/messages/useSearchOnOwnLine";
import type { VirtualListHandle } from "@/components/VirtualList";
import { useHiddenUnreadBarMarks } from "./HiddenUnreadBar";
import { getPinnedSet, loadPins, pinnedKey, togglePinned } from "@/lib/pinnedConversations";
import {
  ARCHIVE_CHANGED_EVENT,
  isArchived as isConvoArchived,
  loadArchives,
} from "@/lib/archivedConversations";
import type { Conversation } from "./types";
import { byLastAtDesc } from "./byLastAtDesc";
import { serverNow } from "@/lib/messagingLockout";
import { isThreadAgedOut } from "./threadAgeOut";
// The Active tab's predicate and its job states (LIVE_JOB_STATUSES) live there.
import { isLiveThread } from "./liveThread";
import type { ConversationListProps } from "./ConversationList";

// Cap the rendered list; "Show all" reveals the rest. The virtualizer
// keeps long lists cheap, but a default cap keeps first paint trivial.
export const CONVO_LIMIT = 50;

type ConversationListStateArgs = Pick<
  ConversationListProps,
  "conversations" | "allConversations" | "loading" | "loadError" | "userId" | "loadConversations"
  | "setDeleteConvoConfirm" | "onBatchArchive"
> &
  Required<Pick<ConversationListProps, "resetSelectionNonce">>;

/**
 * The inbox's state and handlers (search, Active / All / Pinned filter tabs,
 * select mode, pins and archives, pull-to-refresh, the first-unread jump),
 * moved verbatim out of ConversationList so that file is mostly its JSX
 * (Q806). Called once, first, at the top of ConversationList: the hook
 * order is unchanged.
 */
export function useConversationListState({
  conversations, allConversations, loading, loadError, userId, loadConversations, setDeleteConvoConfirm,
  onBatchArchive, resetSelectionNonce,
}: ConversationListStateArgs) {
  const navigate = useNavigate();
  /* Same gate Activity uses (Activity.tsx:410). On the desktop WEBSITE the
     header stops being the scaffold's floating title card and becomes the
     panel's first child under a hairline — see the PageScaffold call at the
     bottom of this file. Messages was the last of the four scaffold pages
     still wearing a separate top panel at every width (owner, 2026-09-16).
     False on phone and on native at every size, so the phone rendering is
     byte-for-byte unchanged. */
  const isWebDesktop = useIsWebDesktop();
  /* Below 360px on phone/native only; see SEARCH_OWN_LINE_QUERY. */
  const searchOnOwnLine = useSearchOnOwnLine() && !isWebDesktop;
  const [showAllConvos, setShowAllConvos] = useState(false);
  // Multi-select delete mode. `selectMode` swaps each row into a
  // checkbox toggle (opening is suppressed) and reveals a bottom action
  // bar; `selectedKeys` holds up to MAX_SELECT `${jobId}_${otherUserId}`
  // keys. Reset from the parent via `resetSelectionNonce` after a batch
  // archive resolves.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // In-list search: an expandable field (mirrors the Activity tabs' search pattern) that client-filters the
  // already-loaded threads by the other person's name and the last-message snippet. No new query — a pure
  // local filter over `conversations`, so no debounce needed.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /* ONE PRESS OUT, AND THE FOCUS COMES BACK — the same dismiss contract
     PostsHeader states (see the note there, owner 2026-09-19). The field
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
  /* Which slice of the inbox. ALL is the default (spec v2 10-20; was Active) —
     see defaultInboxTab in lib/inboxDefault.ts for why Active and not the
     Unread rule that was removed on 2026-08-30. Resolved once, on mount, from
     the first load; changing tabs after that is the user's business.

     `null` means "not chosen yet" so the effect below can seed it as soon as
     the first page of threads lands. */
  const [inboxFilter, setInboxFilter] = useState<string | null>(null);
  /* ── WHERE THE FILTER STRIP SITS ───────────────────────────────────────
     On the desktop website `Active · All` rides inline in the header row. On
     a phone the header row has no room for it (measured on the production
     build, poster-e2e, 31 threads):

                     row    actions  gaps  strip   left for "Messages"  needs
       320 (title card 238px)   92     20    106            20            88  ✗
       375 (title card 293px)   92     20    106            75            88  ✗
       1440 (in-panel 1102px)   92     20    106           884            78  ✓

     so on a phone the strip has its own line under the toolbar, behind the
     chevron, and opens FOLDED on the default filter (owner, 2026-09-25: "open
     with the chevrons collapsed"; earlier, from a device: "Messages should
     also be collapsed when opened"). A non-default filter opens the strip, so
     the inbox is never filtered without the filter showing. */
  /* EVERY read of the filter goes through the coercion, never through the raw
     state. `inboxFilter` is component-local and un-persisted, so today the
     only writers are the tab strip, the overflow menu and the seeding effect
     — but `"unread"` was a legal value until 2026-09-19 and this is a shipped
     app: a session open across the change must not be left staring at a tab
     that no longer exists, highlighted-nothing and empty. Unknown coerces to
     the default (see coerceInboxView). `null` is preserved by the seeding
     effect below, which owns the "not chosen yet" distinction. */
  const inboxTab = coerceInboxView(inboxFilter);

  /* THE PHONE FILTER STRIP STARTS FOLDED ON THE DEFAULT FILTER.
     Same behaviour as PostsHeader and JobsHeader (see the note at their
     `tabsOpenPhone`, and the one above
     MESSAGES_HEADER_PADDING for why this screen has a chevron again). Not
     lifted into a shared hook: the two headers differ in their whole row
     composition (select-mode takeover, overflow menu, a different search
     contract), and the shared part is three lines of state plus one effect —
     forking a hook for that would be the bigger divergence, not the smaller.
     What IS shared is the real chrome: ScreenHeaderRow, UnderlineTabs and the
     icon-button class, all imported, and the parity test that pins the rest. */
  const isDefaultInboxFilter = inboxTab === defaultInboxTab(0);
  // ALWAYS FOLDED ON OPEN, like PostsHeader / JobsHeader (owner, 2026-10-08:
  // "Post and job at the top should open collapsed for their top panels").
  const [tabsOpenPhone, setTabsOpenPhone] = useState(false);
  /* On the desktop website the strip simply STAYS UP — it rides inline in the
     header row, where there is width to spare, so folding two short words
     behind a chevron buys nothing and costs a press. Same call PostsHeader and
     JobsHeader make under `inlineFilters`; the chevron is a phone affordance. */
  const tabsOpen = isWebDesktop || tabsOpenPhone;
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
      // Q262: a deleted-account thread (otherUserId null) cannot be pinned —
      // thread_pins.other_user_id is NOT NULL.
      if (c.otherUserId !== null && pinnedSet.has(pinnedKey(c.jobId, c.otherUserId))) pinned.push(c);
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
        ? orderedConversations.filter(isLiveThread)
        : inboxTab === "pinned"
            ? (() => {
                // Real filter, not a stub: pin state already exists
                // (swipe-to-pin, see orderedConversations above) — the
                // hamburger's "Pinned" entry just needed to read it instead
                // of toasting "coming soon".
                const pinnedSet = userId ? getPinnedSet(userId) : new Set<string>();
                return orderedConversations.filter(
                  (c) => c.otherUserId !== null && pinnedSet.has(pinnedKey(c.jobId, c.otherUserId)),
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
    !searchQuery.trim() && filteredConversations.length === 0 && (conversations.length > 0 || isSpecialFilterView);

  const handleTogglePin = (convo: Conversation) => {
    // Q262: never offered for a deleted-account thread (no swipe row below).
    if (!userId || convo.otherUserId === null) return;
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
    // Selection exists to hide threads, and a team thread cannot be hidden.
    if (c.teamThread) {
      toast("Louisiana Helpr Team conversations can't be hidden.");
      return;
    }
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
  // fixed on /posts and /jobs.
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
  const activeThreads = conversations.filter(isLiveThread).length;

  /* Unread threads the ACTIVE slice does not show — the number the banner
     below prints. Derived from the SAME predicate the Active branch filters
     by, not a restatement of it, so the two cannot drift into claiming
     different things. An unread thread on an `open` posting is the common
     case; a completed or cancelled one that is still unread is the other. */
  const hiddenUnreadCount = conversations.filter(
    (c) => c.unread > 0 && !isLiveThread(c),
  ).length;

  // The device's last count (holds the bar's space while loading, MQ28) and
  // the count its X was pressed at: see ./HiddenUnreadBar.
  const { cachedHiddenUnread, dismissedHiddenUnread, dismissHiddenUnread } = useHiddenUnreadBarMarks(
    userId, hiddenUnreadCount, loading, inboxTab === "active" && !searchQuery.trim(),
  );

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

  return {
    navigate, isWebDesktop, searchOnOwnLine, showAllConvos, setShowAllConvos, selectMode, selectedKeys,
    searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchTriggerRef, closeSearch,
    setInboxFilter, inboxTab, isDefaultInboxFilter, setTabsOpenPhone, tabsOpen, allTabConversations,
    agedOutCount, filteredConversations, isRecentlyDeletedView, isSpecialFilterView, noSearchMatches,
    noTabMatches, handleTogglePin, handleArchive, MAX_SELECT, enterSelectMode, exitSelectMode,
    toggleSelect, handleBatchDelete, pinnedSetForRender, hasThreads, activeThreads, hiddenUnreadCount,
    cachedHiddenUnread, dismissedHiddenUnread, dismissHiddenUnread, containerRef, pullDistance,
    refreshing, isPulling, canTrigger, listHandleRef,
  };
}
