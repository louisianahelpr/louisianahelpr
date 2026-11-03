import { useLayoutEffect, useRef, useState } from "react";
import { WorkRecordReserve } from "@/components/profile/WorkRecordReserve";
import { Skeleton } from "@/components/ui/skeleton";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { currentSearch, profileTabTitle, type Tab } from "@/pages/profile/types";
import { SCHEDULE_LAYOUT_CLASS } from "@/components/profile/scheduleLayout";

/**
 * ProfileTabFallback — what a Profile tab looks like before its chunk lands.
 *
 * OWNER, 2026-09-19: loading states "jump and are not consistent with their
 * info", and the ruling on how to fix it, decided in a pop-up: "SKELETON
 * FILLS THE SCREEN, GROWS BELOW." The placeholder reserves ONE SCREENFUL —
 * not the full height of the real content. Anything taller than the screen
 * grows downward, below the fold, where nothing is under the reader's eye or
 * thumb. Declined in the same pop-up: a true per-tab skeleton reserving (for
 * Home History) 3,477px of grey bones, and no skeleton at all.
 *
 * WHAT WAS MEASURED, at 375 on prod, with the tab's own module held back so
 * the loading frame exists:
 *
 *   - THE TITLE ARRIVED LATE. There was no `<h1>` at all in the loading frame
 *     and one at y=26 in the loaded frame, on every tab — so every pixel of
 *     every tab's content slid down by the height of a page header at the
 *     moment the chunk landed. That is the single biggest jump on the screen
 *     and it was on all twenty-four tabs.
 *   - THE PLACEHOLDER WAS THE WRONG SCREEN ENTIRELY. A cold deep link into
 *     ?tab=gift_card painted Profile's LANDING skeleton — an avatar hero and
 *     three stat tiles — because Profile.tsx's boot skeleton special-cased
 *     exactly one tab (earnings) and gave the other twenty-three the landing's
 *     shape. An avatar standing in for a gift-card form is "not consistent
 *     with their info" in its purest form, and it is also the third of the
 *     three loading screens a deep link used to paint (splash → landing bones
 *     → tab bones → tab).
 *   - THE BODY RESERVED 118px against real content of 447–3,477px.
 *
 * SO, THREE THINGS, ALL IN THIS ONE COMPONENT:
 *
 *  1. THE HEADER IS REAL, not a bone. The tab is known before its chunk is,
 *     and `TAB_TITLES` already carries every tab's on-screen title (it exists
 *     to keep `document.title` equal to the h1). Rendering the actual
 *     `<ProfileTabHeader>` means the h1 is in its final position from the
 *     first frame, the back chevron WORKS while the chunk loads — it did not
 *     before — and the lazy component's own identical header replaces it in
 *     place with nothing moving — INCLUDING the word, now.
 *
 *     `wrapped` used to be the one tab where the word DID change: the
 *     placeholder showed the static "Helpr Wrapped" and the loaded screen
 *     showed "Your 2026 so far", on the claim that the season label was
 *     "computed inside the lazy chunk" and so unreachable from here. That was
 *     false — only the `SEASON` binding is in the chunk; `wrappedSeasonLabel`
 *     is in `src/lib/format.ts`, which anything may import. `TAB_TITLES.wrapped`
 *     now calls it, and HelprWrapped reads `TAB_TITLES.wrapped` back, so the
 *     placeholder header, the loaded h1 and `document.title` are one string
 *     from one expression.
 *
 *  2. THE RESERVE IS ONE SCREENFUL, measured rather than guessed: the
 *     element's own distance from the top of the viewport, subtracted from
 *     the viewport height, on mount. A hard `100dvh` would over-reserve by
 *     the header it sits under; `min-h-full` would resolve against an
 *     auto-height ancestor and reserve nothing.
 *
 *  3. THE RESERVE IS EMPTY BELOW THE BONES — and this is how the short tabs
 *     are handled, which the ruling calls out explicitly. Account Security's
 *     real content is 44px. If the screenful were FILLED with bones, that tab
 *     would paint 700px of grey and then visibly collapse to a single row.
 *     Because the reserve below the two bone cards is blank canvas, a short
 *     tab settles with nothing visible disappearing: the only thing that
 *     shrinks is unused space that was already empty, so there is no dead gap
 *     left behind and no flash of vanishing furniture. A tall tab, meanwhile,
 *     grows into the reserve and then past it, downward, off the fold.
 *
 * The bones themselves stay deliberately few — two cards, a handful of bars.
 * A placeholder holds the shape and gets out of the way; drawing a tab's real
 * furniture would be inventing content we do not have yet.
 *
 * OWNER, 2026-10-01 (pop-up): SHORT TABS ARE "SIZE TO CONTENT". Point 3 above
 * did not hold up when measured: a screenful over a tab shorter than the
 * screen is a placeholder 236-678px TALLER than what replaces it, and the
 * check counts that collapse as a jump. So a tab shorter than one screen now
 * draws its own silhouette (TAB_SHAPES): one block per real row, each the
 * height that row measured at 375 on prod with both test accounts, with the
 * same number of avatar/icon circles. `"fill"` is the rest of the screen, for
 * a long list that grows below. Tabs not in the table keep the screenful.
 * Pets depends on the account (two pets: 216px; none: a 363px empty state)
 * and is sized to the shorter, so the other case grows below, never collapses.
 * Analytics is one height either way (481px; owner, 2026-10-01: its intro and
 * its fee comparison share one five-line box in AnalyticsUpgradePanel), and
 * Saved Helprs sits between its empty state (340px) and a two-card list (348px).
 *
 * OWNER, 2026-10-03 (Q722): DATA-AWARE SKELETONS. Where the state is known
 * before the data, the placeholder draws THAT state, not the populated
 * layout. Nothing about the account is known in this frame (the profile row
 * and every tab query are still in flight), and a warm visit never reaches it
 * (the persisted query cache paints the real tab), so this frame is a cold
 * visit, and these two tabs draw their ZERO state:
 *   - reviews: the "No reviews yet" card (307px at 375, both test accounts,
 *     2026-10-05). It drew the populated layout (an 86px rating hero over a
 *     screenful) and collapsed 221px into the empty card. Once the review
 *     COUNT is known, ReviewsTab's own placeholder draws the populated shape,
 *     and only when there are reviews.
 *     SUPERSEDED for reviews (owner, 2026-11-02, via the lead): the zero-state
 *     card shape read as "No reviews yet" while the reviews were still loading.
 *     Reviews now wait in ONE neutral review-row shape (ReviewRowReserve), which
 *     says nothing about how many there are; the real list or the empty card
 *     grows below it.
 *   - wrapped: the "No activity yet" card (333px at 375: the real card with
 *     its stats swapped for the zero-state markup, measured 2026-10-05). A
 *     year with activity is taller (419px with one stats row, 510px with two)
 *     and grows below, never collapses; it drew a screenful (744px) and
 *     collapsed 234-325px.
 */
type Block = { h: number | "fill"; media?: number; /** The real block is a centred card this wide (px). */ maxW?: number };
export const TAB_SHAPES: Partial<Record<Exclude<Tab, "landing">, Block[]>> = {
  availability: [{ h: 85 }, { h: 768 }],
  // Email, password, two-factor, sign-in methods (Q446 added it after
  // two-factor; loading-states-refresh 37408930852 caught the missing bone:
  // 5 placeholder rows -> 6 real), active sessions. The sign-in methods card
  // renders only while SOCIAL_SIGN_IN_ENABLED (off for launch, Q1462), so its
  // bone follows the same switch (loading-states-refresh 37554743989, 2026-10-07: 6
  // placeholder rows -> 5 real once it went off).
  // Q1695 (loading-states refresh 2026-11-02 01:07Z, bot/refresh/loading-states 80cc9f9ff8, 375, both test
  // accounts): email 89, password 71, two-step 86, sign-in methods 229, active sessions 261 (two device rows, so
  // three icons). Heights from the gaps between the cards' <h2> landmarks (88.3, 189.6, 272.1, 370, 610.9) less
  // the 12px section gap; the last is the rest of rowRect.h 856.9. It read 74/74/74/224/196 (row 74 -> 86, media
  // 6 -> 7).
  security: [
    { h: 89, media: 1 },
    { h: 71, media: 1 },
    { h: 86, media: 1 },
    ...(SOCIAL_SIGN_IN_ENABLED ? [{ h: 229, media: 1 }] : []),
    { h: 261, media: 3 },
  ],
  subscription: [{ h: 66 }, { h: 51 }, { h: 1081 }, { h: 30 }],
  // + "Take the tour again" (2026-10-20, FirstRun replay).
  support: [{ h: 469 }, { h: 43 }, { h: 43 }],
  warnings: [{ h: 243, media: 1 }],
  credentials: [{ h: 92 }, { h: 152 }, { h: 169 }, { h: 70 }],
  accessibility: [{ h: 99 }, { h: 76 }],
  pets: [{ h: 216, media: 2 }],
  // Q1695: helper-e2e's empty record measured 375px (rowRect.h 443.4) in the 2026-11-02 01:07Z refresh, against 384.
  // poster-e2e's long record grows below (its jump is the 09-19 screenful ruling, byDesign).
  home_history: [{ h: 375, media: 1 }],
  str_settings: [{ h: 508, media: 1 }],
  // Q1695: 288px in the 2026-11-02 01:07Z refresh (both test accounts; Instant Release copy changed 10-30).
  auto_tip: [{ h: 288 }],
  saved_helpers: [{ h: 344, media: 1 }],
  // Q2275 (board 91): intro line, the list, Pause all alerts (375, poster-e2e with one saved search, 2026-10-21).
  saved_searches: [{ h: 36 }, { h: 72 }, { h: 60 }],
  // A3-C16: the intro line, two lines at 375 (customer-e2e with no blocks, 2026-10-29; it drew the two-card
  // default and collapsed 706px). Someone with blocks gets their list below it, growing down, never collapsing.
  blocked: [{ h: 40 }],
  // CMP-4: the intro, the private line, the 2-hour line, the 3-spot list card (always 3 rows: 180-182px at 0, 1 and
  // 2 floors), the add form (375, stub build, 2026-11-01). At 3 floors the form gives way to one line, below.
  // Q1695: the intro measured 122px in the 2026-11-02 01:07Z refresh (both test accounts; the only single change
  // that gives its median row 122 and its total 795px).
  instant_book: [{ h: 122 }, { h: 38 }, { h: 38 }, { h: 181 }, { h: 298 }],
  // Q1695: the no-plan card, 370px in the 2026-11-02 01:07Z refresh (both test accounts).
  analytics: [{ h: 370 }],
  // Board 177 (375, helper-e2e, 2026-10-21): Payout history's one body row (no payout account: the set-up line;
  // a list grows below), and Receipts' one column (nothing paid yet, the tax-form card).
  payout_history: [{ h: 68 }],
  receipts: [{ h: 137 }],
  // Q2013: the real card is `w-full max-w-[420px]` centred, so at 1440 the bone is too (it drew the full column).
  wrapped: [{ h: 333, maxW: 420 }],
  // You › Settings (board 52): Look, Your sections, Updates, Your account, More, Log out. Q1695: re-sized from the
  // loading-states refresh of 2026-11-02 01:07Z (bot PR #3963, 375, both test accounts): each group's height is
  // the gap between its heading and the next one's (12px section gap), Log out kept at 58. Look gained Language,
  // Updates has two rows, Your account gained the profile link and share rows, More lost one row.
  settings: [{ h: 235 }, { h: 301 }, { h: 166 }, { h: 626 }, { h: 313 }, { h: 58 }],
};

/** Avatar circles a screenful-reserve tab draws in its first card. */
const RESERVE_MEDIA: Partial<Record<Exclude<Tab, "landing">, number>> = { profile: 1 };

export interface ProfileTabFallbackProps {
  /** Which tab is loading — decides the title and the body's silhouette. */
  tab: Exclude<Tab, "landing">;
  /** Back out of the tab. Live during loading, which it was not before. */
  onBack?: () => void;
}

/**
 * The placeholder WITHOUT the header — two bone cards over a one-screenful
 * reserve.
 *
 * Exported because a tab waits twice: once for its chunk (this file's default
 * export covers that, header included) and again for its data, inside a body
 * whose header is already painted. Home History and Work Record both spent
 * that second wait on a job-card-shaped skeleton — three rows with badge
 * chips, a price tile and an apply-button footer — while what arrived was, in
 * Work Record's case, ONE letterhead document, and in Home History's a single
 * record card measured at 309px against the bone's 76px. Nothing in the
 * placeholder corresponded to anything in the content: "not consistent with
 * their info", verbatim. Both now wait in the same clothes they waited in a
 * moment earlier, so the sequence is one placeholder, not two.
 */
export const ProfileTabBodyReserve = ({ tab }: { tab?: Exclude<Tab, "landing"> } = {}) => {
  if (tab === "notifications") return <NotificationsReserve />;
  if (tab === "reviews") return <ReviewRowReserve />;
  if (tab === "work_record") return <WorkRecordReserve />;
  if (tab === "legal") return <LegalReserve />;
  if (tab === "schedule") return <ScheduleReserve />;
  const shape = tab ? TAB_SHAPES[tab] : undefined;
  if (shape) {
    // Siblings, not a wrapper: each block lines up with the real row that
    // replaces it, so the row count matches as well as the height.
    return (
      <>
        {shape.map((b, i) => (
          <ShapeBlock key={i} block={b} first={i === 0} />
        ))}
      </>
    );
  }
  return <ScreenfulReserve media={tab ? (RESERVE_MEDIA[tab] ?? 0) : 0} />;
};

/** One screenful from where the element starts. Read once: the placeholder's
 *  whole life is a few hundred ms, and a resize observer here would fight the
 *  content that is about to replace it. */
const useScreenfulBelow = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    setReserve(Math.max(0, Math.round(window.innerHeight - top)));
  }, []);
  return { ref, reserve };
};

const Circles = ({ n }: { n: number }) =>
  n > 0 ? (
    <div className="flex gap-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-9 w-9 rounded-full" />
      ))}
    </div>
  ) : null;

const ShapeBlock = ({ block, first }: { block: Block; first: boolean }) => {
  const { ref, reserve } = useScreenfulBelow();
  const height = block.h === "fill" ? reserve : block.h;
  const testId = first ? "profile-tab-fallback" : undefined;
  if (typeof block.h === "number" && block.h < 60) {
    return <Skeleton aria-hidden data-testid={testId} style={{ height }} className="w-full rounded-2xl" />;
  }
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid={testId}
      style={{ height, maxWidth: block.maxW }}
      className={`rounded-2xl liquid-glass p-card space-y-3 overflow-hidden${block.maxW ? " w-full mx-auto" : ""}`}
    >
      <Circles n={block.media ?? 0} />
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-4 w-2/3 rounded" />
    </div>
  );
};

/**
 * NOTIFICATIONS DRAWS ITS ROWS (owner, 2026-10-07, Q201 a; overrides the
 * 09-19 screenful ruling for this one screen). The real tab is ONE card: the
 * App / Email column labels, then a row per preference, each led by a round
 * icon (17 on prod at 375, both test accounts). The screenful reserve drew two
 * text cards and no icons at all, so the loaded card arrived with 17 avatars'
 * worth of shape the placeholder never promised. Rows are 74px, the measured
 * mean (the card is 1251-1323px with 17 rows plus the label strip; Quiet Hours
 * and the digest row run taller, the toggles-only rows shorter).
 */
export const NOTIFICATION_ROWS = 17;
/**
 * Reviews' placeholder (owner, 2026-11-02, superseding Q722 for loading): one neutral review row, the shape of a
 * review in the list (stars, a date, two lines), not the "No reviews yet" card, so the loading frame claims
 * neither "none" nor "some".
 */
const ReviewRowReserve = () => (
  <div data-testid="profile-tab-fallback" data-review-row-reserve="" className="rounded-ds-md liquid-glass p-card space-y-2.5" aria-hidden>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((s) => (
          <Skeleton key={s} className="h-3.5 w-3.5 rounded-sm" />
        ))}
      </div>
      <Skeleton className="h-3 w-20" />
    </div>
    <Skeleton className="h-3.5 w-full" />
    <Skeleton className="h-3.5 w-5/6" />
  </div>
);

const NotificationsReserve = () => (
  <div aria-hidden data-testid="profile-tab-fallback" className="rounded-2xl liquid-glass overflow-hidden">
    <div className="flex justify-end gap-4 px-card py-2">
      <Skeleton className="h-3 w-10 rounded" />
      <Skeleton className="h-3 w-12 rounded" />
    </div>
    {Array.from({ length: NOTIFICATION_ROWS }, (_, i) => (
      <div key={i} className="flex h-[74px] items-center gap-3 border-t border-border/40 px-card">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-1/3 rounded" />
        <div className="ml-auto flex gap-4">
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="h-7 w-12 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * Legal (Q2013, skeleton-shape check, 2026-10-17): the real tab is the Terms / Rules / Privacy pill row, then the
 * document 12px below it. The screenful drew no pill row, so the document card sat 56px high at 375, and at 1440
 * its full-width bone stood where the selected Terms pill (one third of the row) is. Same row classes as
 * LegalTab's TabsList and triggers, so each slot is one trigger's box; only the first (Terms, the default) is a
 * filled pill, as on the page. ONE wrapper, like the loaded Tabs
 * root, so the row count the loading-state check measures stays header + one.
 */
const LEGAL_DOCS = 3;
const LegalReserve = () => {
  const { ref, reserve } = useScreenfulBelow();
  return (
    <div ref={ref} style={{ minHeight: reserve }} aria-hidden data-legal-reserve="">
      <div className="flex items-center gap-1 sm:gap-2 px-1 w-full">
        {/* The selected document is the one filled pill; the other two are a label on the page ground. */}
        {Array.from({ length: LEGAL_DOCS }, (_, i) =>
          i === 0 ? (
            <Skeleton key={i} className="h-11 flex-1 min-w-0 rounded-full" />
          ) : (
            <div key={i} className="h-11 flex-1 min-w-0 flex items-center justify-center">
              <Skeleton className="h-3 w-14 rounded" />
            </div>
          ),
        )}
      </div>
      {/* The test id sits on the document bone, not the screenful wrapper: the shape check reads a test id with
          "fallback" in it as a placeholder box, and the wrapper's box starts at the pill row, above the document. */}
      <div data-testid="profile-tab-fallback" className="mt-3 rounded-2xl liquid-glass p-card space-y-3">
        <Skeleton className="h-5 w-32 rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
    </div>
  );
};

/**
 * Schedule (Q2013): from 1024px the real tab is a calendar column beside an Upcoming jobs column
 * (SCHEDULE_LAYOUT_CLASS, shared with ScheduleTab), not two full-width cards. Below 1024 the same grid stacks, so
 * the phone frame is unchanged: calendar card, then the list's title and card. One wrapper, one screenful.
 */
const ScheduleReserve = () => {
  const { ref, reserve } = useScreenfulBelow();
  return (
    <div ref={ref} style={{ minHeight: reserve }} aria-hidden data-schedule-reserve="" className={SCHEDULE_LAYOUT_CLASS}>
      {/* Test id on the calendar bone, not the full-width wrapper (see LegalReserve). */}
      <div data-testid="profile-tab-fallback" className="rounded-2xl liquid-glass p-card space-y-3 min-w-0 min-[1024px]:aspect-square">
        <Skeleton className="h-5 w-32 rounded mx-auto" />
        <Skeleton className="h-4 w-2/3 rounded mx-auto" />
        <Skeleton className="h-4 w-1/2 rounded mx-auto" />
      </div>
      <div className="min-w-0 space-y-3">
        <Skeleton className="h-6 w-40 rounded" />
        <div className="rounded-2xl liquid-glass p-card space-y-3">
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="h-4 w-3/4 rounded" />
        </div>
      </div>
    </div>
  );
};

const ScreenfulReserve = ({ media }: { media: number }) => {
  const { ref, reserve } = useScreenfulBelow();
  return (
    <div
      ref={ref}
      style={{ minHeight: reserve }}
      aria-hidden
      data-testid="profile-tab-fallback"
      className="space-y-section"
    >
      <div className="rounded-2xl liquid-glass p-card space-y-3">
        <Circles n={media} />
        <Skeleton className="h-5 w-32 rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
      <div className="rounded-2xl liquid-glass p-card space-y-3">
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
    </div>
  );
};

export const ProfileTabFallback = ({ tab, onBack }: ProfileTabFallbackProps) => (
  <ProfileTabBody>
    <ProfileTabHeader title={profileTabTitle(tab, currentSearch())} onBack={onBack} />
    <ProfileTabBodyReserve tab={tab} />
  </ProfileTabBody>
);

export default ProfileTabFallback;
