/**
 * Which Messages tab the inbox opens on, expressed once so the app and its
 * tests cannot drift apart.
 *
 * ── THE HISTORY, because it is the whole reason the answer is what it is ──
 *
 * 1. Originally: "Unread, when there is unread, otherwise All." Good
 *    intentions — Unread is the tab with something to do — but the landing
 *    tab CHANGED depending on read state, so the inbox you opened on Monday
 *    was not the inbox you opened on Tuesday.
 * 2. 2026-08-30 — the owner had that removed for exactly that reason: "the
 *    inbox's default view moved around depending on read state." The rule
 *    became a hard `return "all"`.
 * 3. 2026-09-19 — the owner asked again for a landing tab with something in
 *    it ("for messages the page should open to unread or active"), was shown
 *    the 2026-08-30 history, and chose **Active**.
 *
 * ── WHY ACTIVE AND NOT UNREAD (AGAIN) ──
 *
 * Unread was rejected a second time for the same defect it was removed for:
 * it is a function of read state, so it moves. Reading your last unread
 * thread would silently relocate the inbox's landing tab underneath you.
 *
 * Active does not reintroduce that problem, because it is not a function of
 * anything the reader does in this screen: a thread is in Active when its JOB
 * is still running (see LIVE_JOB_STATUSES in ConversationList.tsx — accepted,
 * in_progress, revision_requested, disputed, pending_approval). Opening the
 * screen, reading a thread, or replying never changes which tab you land on.
 * The slice's CONTENTS change as jobs start and finish, which is the point;
 * the DEFAULT is a constant, which is what the owner asked for both times.
 *
 * ── THE COST, HANDLED IN ConversationList ──
 *
 * Active is narrower than All, so it can hide a thread you have not read —
 * an unread question on an `open` posting is the common case. "Opens to
 * Active" must never mean "hides something you have not read", so the inbox
 * renders an explicit "N unread in other conversations" banner whenever the
 * Active slice is hiding unread threads. Do not delete the default without
 * also revisiting that banner, and do not delete the banner while this
 * returns "active".
 *
 * ── 4. 2026-09-19, LATER THE SAME DAY: THE UNREAD *TAB* IS REMOVED ──
 *
 * This file now records TWO separate removals of Unread, for two different
 * reasons, and they must not be confused:
 *
 *   - 2026-08-30 removed "Unread WHEN there is unread" as the DEFAULT RULE,
 *     because a landing tab that depends on read state moves around.
 *   - 2026-09-19 removes the Unread TAB itself, because it is redundant:
 *       · Active is now the default, so the landing view is already filtered
 *         to live conversations;
 *       · unread is marked on the ROW itself, in the list;
 *       · the inbox already scrolls to the first unread thread on entry
 *         (028fe3837), which is the one job the filter actually did.
 *     A filter that duplicates what the list already shows is chrome, not
 *     function.
 *
 * This reverses a request the owner made earlier the same afternoon ("in the
 * top bar it should say all unread and active", shipped as 9b0eb1fc8). They
 * were shown that and confirmed twice. The INLINE-ON-DESKTOP half of that
 * commit stays exactly as it shipped — desktop keeps the strip, phone keeps
 * its disclosure; the strip simply holds two entries now. Do not "restore"
 * the third one.
 *
 * ── TAB ORDER: Active · All ──
 *
 * Narrow to wide, and the first entry is the one the inbox lands on. The
 * alternative (All first) would put the tab you are NOT on in the leading
 * position, which is the arrangement that made the old three-tab strip read
 * as "All, and some filters" rather than "here, or everything".
 *
 * ── THE PARAMETER ──
 *
 * `_unreadCount` is KEPT even though the rule no longer reads it. Two call
 * sites pass it (ConversationList's seeding effect passes the live count;
 * the disclosure's DEFAULT_INBOX_TAB and an E2E spec pass 0), and the
 * signature is the module's whole contract: "the landing tab is a function
 * of inbox state, asked of one place." Dropping it would churn three call
 * sites and a spec to save an underscore, and would have to be put back the
 * next time the rule depends on state again. It is underscore-prefixed, so
 * no-unused-vars is satisfied.
 *
 * This lives in its own module rather than inline in ConversationList because
 * an E2E spec once asserted the old behaviour as a literal and broke the
 * moment the rule changed — the test was encoding a product decision by
 * restating it. Anything that needs to know the default imports it from here
 * instead.
 */
/**
 * The two filter TABS. `"unread"` is deliberately gone — see history item 4.
 *
 * The inbox's filter state also legally holds two values that are NOT tabs:
 * `"pinned"` and `"recentlyDeleted"`, both reached from the overflow menu and
 * both rendered with a chip rather than a highlighted tab. They are modelled
 * in `InboxView` below rather than here so that "which tabs exist" stays one
 * short, honest list.
 */
export type InboxTab = "all" | "active";

/** Every value the inbox's filter state may legally hold. */
export type InboxView = InboxTab | "pinned" | "recentlyDeleted";

const LEGAL_INBOX_VIEWS = new Set<string>(["all", "active", "pinned", "recentlyDeleted"]);

/**
 * Normalise whatever the inbox's filter state is holding into a value the
 * renderer knows how to draw.
 *
 * This exists because `"unread"` was a legal value until 2026-09-19 and this
 * app is shipped, not deployed — a client that was open across the change, a
 * future stored preference, or a link that learns to carry `?tab=` could all
 * still hand the inbox the name of a tab that no longer exists. An unknown
 * view must never render as a highlighted-nothing, empty, unexplained list.
 *
 * Unknown (including the retired `"unread"`) coerces to the DEFAULT tab, not
 * to `"all"`: landing somewhere that is explicitly a filtered slice, with a
 * tab lit to say so, is honest. Landing on All would silently widen what the
 * caller asked for.
 *
 * `null` means "not seeded yet" and is passed through by the caller, which
 * owns that distinction.
 */
export function coerceInboxView(value: string | null | undefined): InboxView {
  if (value && LEGAL_INBOX_VIEWS.has(value)) return value as InboxView;
  return defaultInboxTab(0);
}

/**
 * The tab that means "no filter" — where every "show me everything again"
 * affordance sends the reader. NOT the same value as the default tab any
 * more, and the two must never be conflated: an empty-state button reading
 * "Show All" that called `defaultInboxTab()` would, since 2026-09-19, set
 * the tab it is already on and do nothing.
 */
export const UNFILTERED_INBOX_TAB: InboxTab = "all";

export function defaultInboxTab(_unreadCount: number): InboxTab {
  return "active";
}
