/**
 * FORMS the prod messy-input sweep reaches by URL (messy-input.spec.ts), and
 * the GAPS: inventory files (docs/audit/form-inventory.md) that hold no typed
 * text, with the reason each is not swept. The explore half of the spec
 * credits everything it reaches from real seeded records; the coverage test
 * fails on any inventory file with neither a credit nor a reason here.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { TEXTLIKE, runtime, settle, type Account } from "./harness";

export interface FormSpec {
  name: string;
  url: string;
  /** null = signed out */
  as: Account | null;
  /** Get from the URL to the form itself (e.g. press "Start Fresh"). */
  prepare?: (page: Page) => Promise<void>;
  /** Inventory files this form exercises. */
  covers: string[];
}

const pressIfPresent = async (page: Page, name: RegExp) => {
  const b = page.getByRole("button", { name }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
};

/**
 * RECOVER THE ADMIN GATE BEFORE JUDGING AN ADMIN SCREEN.
 *
 * `AdminRoute` does not render the admin view until it knows the role. When
 * the role lookup does not come back it renders a DESIGNED recovery state —
 * "We couldn't verify your access. … Tap Try again." (AdminRoute.tsx:71-98) —
 * a correct screen that happens to hold zero text-like fields. The sweep then
 * counted zero and reported "the form did not render", blaming the form for a
 * gate that never opened.
 *
 * Measured 2026-09-20 against prod: `profiles` (the read that lookup makes)
 * swung between 1s and a 25s timeout while the other lanes were driving prod,
 * and `/auth/v1/admin/generate_link` was returning 504 at the same time.
 * Holding that read locally reproduced the CI failure exactly — 0 fields on
 * `/admin?view=referrals`, with this screen on display — and pressing the
 * screen's own Try again took it back to 1.
 *
 * So press the recovery control, which is what an admin does, and only then
 * look for the form. It is a no-op on a healthy gate, and the field floor is
 * untouched: an admin view that renders no field once the gate is open still
 * fails, which is what made these eight visible in the first place.
 */
const recoverAdminGate = async (page: Page, budgetMs = 30_000) => {
  const denied = page.getByText(/couldn't verify your access/i).first();
  // `role="status"` is what both loading gates wear: AdminRoute's own
  // HelprSpinner while the role is still in flight, and RouteSuspenseFallback
  // while the lazy admin chunk loads. Returning while either is up would be
  // the same silent no-op in a different costume — the prepare would press
  // nothing and the sweep would count zero — so wait the gate out first.
  const loading = page.getByRole("status").first();
  const deadline = Date.now() + budgetMs;
  let retries = 0;
  while (Date.now() < deadline) {
    if (await denied.isVisible().catch(() => false)) {
      if (retries++ >= 3) return;
      await page.getByRole("button", { name: /^try(ing)? again/i }).first().click().catch(() => {});
      await page.waitForTimeout(2_000);
      continue;
    }
    if (!(await loading.isVisible().catch(() => false))) return;
    await page.waitForTimeout(500);
  }
};

/**
 * OPEN THE COLLAPSED SEARCH. Five surfaces (/legal, /dashboard, /messages,
 * /my-posts, /profile?tab=saved_helpers) start with no search field in the DOM
 * at all: a magnifier trigger holds its place, and pressing it mounts the
 * field (owner's ruling, 2026-09-16 — the magnifier moves inside the field and
 * the ✕ becomes its only control). A sweep that only counted the fields on
 * screen at load therefore found zero on every one of them and reported "the
 * form did not render" when nothing was broken.
 *
 * A field behind a disclosure is still a field, so the sweep opens the
 * disclosure rather than skipping the surface or lowering its floor to zero.
 * The trigger is read from the app's own marker — `[data-search-trigger]`,
 * the contract `src/test/searchDismissAndOverlay.test.tsx` pins on every one
 * of these five — not from a per-page selector guess, so a surface that grows
 * an expanding search inherits this for free and one that loses its trigger
 * fails the field floor loudly instead of silently sweeping nothing.
 */
const openSearch = async (page: Page) => {
  const trigger = page.locator("[data-search-trigger]").first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click();
  // The field mounts and animates open, so the sweep must not race it. Waited
  // for by TEXTLIKE — the sweep's OWN definition of a field — rather than a
  // per-page selector: /legal carries its own trigger and a plain text input,
  // while the ScreenHeaderRow surfaces put a type=search inside the slot, and
  // a wait that only knew one of those shapes would silently time out on the
  // other and hand the sweep a half-open field.
  await page.locator(TEXTLIKE).filter({ visible: true }).first().waitFor({ timeout: 5_000 }).catch(() => {});
};

/**
 * DYNAMIC `prepare` STEPS for the 21 forms nothing reached (docs/OPEN.md,
 * 2026-09-22). None of these can go in `FORMS[].url`: this module loads (and
 * the array literal evaluates) before `messy-input.spec.ts`'s `beforeAll` has
 * resolved a single session or fixture, so a job id or a user id has to be
 * read out of `runtime` (harness.ts) INSIDE the callback, at test time, never
 * baked into a string here. See the comment on `runtime` for the full reason.
 *
 * Every one of these opens a dialog or reveals a field the write firewall
 * would refuse a submit from — that is the SAFE half of the design (harness.ts
 * `writeFirewall`), not a reason to skip them. See docs/OPEN.md, "messy-input
 * has 21 unswept forms": the 21 were never refused, they were simply never
 * reached, and a GAP entry for them would be the false statement this file's
 * own coverage test exists to catch.
 */
const fixtureOrThrow = <K extends keyof NonNullable<typeof runtime.fixtures>>(key: K, what: string) => {
  const job = runtime.fixtures?.[key];
  if (!job) throw new Error(`no ${what} between the shared poster/helper accounts on prod right now`);
  return job as { id: string; title: string };
};

const emailFor = (a: Account): string => {
  const e = runtime.email[a];
  if (!e) throw new Error(`no resolved email for the "${a}" account`);
  return e;
};

const idFor = (a: Account): string => {
  const id = runtime.userId[a];
  if (!id) throw new Error(`no resolved user id for the "${a}" account`);
  return id;
};

/** Expand an Activity/My Jobs card by tapping its own title bar (JobCardShell's whole header is the toggle — see JobCardShell.tsx). */
const expandJobCard = async (page: Page, title: string) => {
  const card = page.getByText(title, { exact: false }).first();
  await card.waitFor({ timeout: 20_000 });
  await card.click();
};

/**
 * OPEN ONE JOB'S CARD ON AN ACTIVITY TAB. A card lives in whichever bucket
 * (Needs You / Waiting / Scheduled / Done) its state puts it, and only the
 * default bucket is on screen at load — which is why the pending-application
 * sweep waited 20s for a title that was not in the default "Needs You" bucket
 * (measured on prod 2026-09-23: "SEED Feed and walk two dogs"). `?job=<id>`
 * is the app's own deep link (Activity.tsx `deepLinkJobId`): it resolves the
 * bucket the job is ACTUALLY in, exactly as a notification tap does.
 */
const openActivityCard = async (page: Page, tab: "/my-jobs" | "/my-posts", job: { id: string; title: string }) => {
  await page.goto(`${tab}?job=${job.id}`);
  await settle(page);
  await expandJobCard(page, job.title);
};

/** Press a card chip by its accessible name (JobActionChip's `ariaLabel`, not its visible label) and wait for the field it opens. */
//
// A step whose action row is full parks the rest behind its "More" overflow
// (JobActionRow.tsx `data-job-step-overflow`) — measured on prod 2026-09-23:
// the confirmed card shows Directions · More · I'm On My Way, with Cancel Job
// inside More. So: the chip if it is on the row, else open the overflow first.
const pressChipForField = async (page: Page, name: RegExp, opts: { field?: boolean } = {}) => {
  const chip = page.getByRole("button", { name }).filter({ visible: true }).first();
  const onRow = await chip.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  if (!onRow) {
    const more = page.locator("[data-job-step-overflow]").filter({ visible: true }).first();
    await more.waitFor({ timeout: 10_000 });
    await more.click();
    await chip.waitFor({ timeout: 10_000 });
  }
  await chip.click();
  // `field: false` for a control that opens a CHOICE first (withdraw reasons):
  // the caller waits for its own field once the choice is made.
  if (opts.field !== false) await page.locator(TEXTLIKE).filter({ visible: true }).first().waitFor({ timeout: 15_000 });
};


/**
 * OPEN A REAL MESSAGE THREAD — RichMessageInput/ChatView render only inside
 * an open conversation, and the standing in-progress job between the shared
 * accounts is the one already used by the "chat composer" targeted rule
 * above; this is the same door, opened for the field sweep instead of one
 * hand-picked value battery.
 */
const openMessageThread = (other: Account) => async (page: Page) => {
  const job = fixtureOrThrow("inProgressJob", "in-progress job");
  await page.goto(`/messages?jobId=${job.id}&userId=${idFor(other)}`);
  await settle(page);
  await page.getByRole("textbox", { name: /type a message/i }).waitFor({ timeout: 20_000 });
};

/** /dashboard's Filters sheet folds "Saved Searches" into its last section (BrowseTasksToolbar.tsx) — open the sheet, then the row. */
const openSavedSearches = async (page: Page) => {
  await page.getByRole("button", { name: /^filters/i }).first().click();
  const row = page.getByRole("button", { name: /saved searches/i }).first();
  await row.waitFor({ timeout: 10_000 });
  await row.click();
};

/**
 * /user/:id's "More options" menu holds Report User (UserProfile.tsx). The
 * dialog OPENS ON A REASON PICKER, not a text box (ReportDialog.tsx `step`:
 * reason → details → confirmation) — the description field only exists once
 * a reason is chosen, which is why the sweep found "no text-like field" on a
 * dialog that had opened perfectly (prod, 2026-09-23). "Something else" is the
 * one reason every report context offers.
 */
const openReportDialog = (target: Account) => async (page: Page) => {
  await page.goto(`/user/${idFor(target)}`);
  await settle(page);
  await page.getByRole("button", { name: /more options/i }).first().click();
  await page.getByRole("menuitem", { name: /report user/i }).first().click();
  const dialog = page.getByRole("dialog").filter({ visible: true }).last();
  await dialog.getByRole("button", { name: /something else/i }).first().click();
  await dialog.locator("textarea").first().waitFor({ timeout: 10_000 });
};

/**
 * DisputeDialog (the one ActivityDialogs mounts for both sides), opened from
 * the HELPER's "Report a problem" chip on a job they are on the way to or
 * working (ActiveJobSection.tsx `showReport`).
 *
 * Not from the poster's "Dispute" chip: that chip only exists on a
 * `revision_requested` job whose revision window has run out
 * (DisputeLink.tsx `shouldShowDisputeLink`), a state no seeded job is in and
 * none can be put in without running a real revision cycle. The poster's
 * in-progress card offers SOS / More / Approve — measured on prod 2026-09-23,
 * where the old spec waited 10s for a chip that is correctly absent.
 */
const openDisputeDialog = async (page: Page) => {
  const job = fixtureOrThrow("helperEnRouteJob", "job the helper is on the way to or working");
  await openActivityCard(page, "/my-jobs", job);
  await pressChipForField(page, /^report a problem/i);
};

/**
 * The helper's expanded Active-Job card offers exactly one of "Cancel Job"
 * (reveals ActiveJobSection's own abort-reason textarea) or "Report a
 * Problem" (opens the same DisputeDialog as above) — never both, they are the
 * complement of each other over the job's tracker sub-status
 * (ActiveJobSection.tsx: `showExit`/`showReport`). Press whichever the
 * standing job is actually showing rather than assuming one.
 */
//
// The field this FormSpec covers is ActiveJobSection's OWN abort-reason box,
// which only the Cancel Job confirm holds — so it opens on a job the helper
// has confirmed and not yet left for (`helperConfirmedJob`), never on the
// Report-a-problem side, whose field belongs to DisputeDialog (the
// activity-dispute-dialog spec). The old version pressed "whichever is
// showing", matched neither (both chips' accessible names are their
// `ariaLabel`s — "Cancel this job? …" and "Report a problem — …" — so the
// exact-label regexes never matched), and swallowed the miss.
const openActiveJobSection = async (page: Page) => {
  const job = fixtureOrThrow("helperConfirmedJob", "job the helper confirmed but has not left for");
  await openActivityCard(page, "/my-jobs", job);
  // Unanchored: inside the overflow sheet the same control is named
  // "Cancel Job — Cancel this job? …" (label + ariaLabel).
  await pressChipForField(page, /cancel this job\?/i);
};

/**
 * The helper's expanded Disputed card offers "Respond to Dispute"/"Add Your
 * Side" (a textarea) to whichever side did NOT file, and "Withdraw Dispute"
 * (a confirm, no typed field) to whichever side DID (DisputedSection.tsx:
 * `canRespond`/`canWithdraw`). The standing disputed job's opener is not
 * pinned by the fixture picker, so press Respond when it is offered and fall
 * back to Withdraw only so the section itself is still exercised.
 */
//
// The fixture is `helperDisputedJob`: a dispute the OTHER side filed that the
// helper has not answered (harness.ts), so Respond is always the control
// offered — Withdraw has no typed field and would sweep nothing. Resolved from
// the helper's own jobs, any poster: poster-e2e had no disputed job on prod
// 2026-09-23, while the helper was assigned one a seeded poster had filed.
const openDisputedSectionResponse = async (page: Page) => {
  const job = fixtureOrThrow("helperDisputedJob", "dispute filed against the helper, unanswered");
  await openActivityCard(page, "/my-jobs", job);
  await pressChipForField(page, /respond to dispute|add your side/i);
};

/** The helper's expanded pending-application card's "Edit" chip opens the message editor (AppliedJobCard.tsx). */
// The pencil's accessible name is "Edit your message" (PendingApplicationSection.tsx).
const openPendingApplicationEdit = async (page: Page) => {
  const job = fixtureOrThrow("jobWithPendingApplicant", "job with a pending application");
  await openActivityCard(page, "/my-jobs", job);
  await pressChipForField(page, /^edit your message$/i);
};

/**
 * Seeded, `is_seed=true` admin-console test subjects distinct from the
 * shared poster/helper/admin accounts (scripts/audit/prod-seed.mjs `OWNED`):
 * one held `approval_status: "pending"` (for Deny, which only renders on a
 * pending profile) and one held two real `user_violations` rows (for
 * "Reverse this strike", which only renders on a profile with one). Neither
 * is ever the account these sweeps sign in as — only the admin console's
 * SEARCH target.
 */
const SEED_PENDING_EMAIL = "helpr-seed-pending-0912@mailinator.com";
const SEED_BANNED_EMAIL = "helpr-seed-banned-0912@mailinator.com";

/**
 * Search /admin?view=people (tab=all, so approval/ban status can never hide
 * the target) for one account by email and open its detail dialog, which
 * lands on the Actions tab by default (AdminUserDetailDialog.tsx
 * `defaultValue="actions"`) — where AdminUserNotes and UserAuditLog render
 * unconditionally, and Ban/Deny/Formal-Warning/Restrict-Applications are one
 * more click away.
 */
const openAdminUserByEmail = (email: string) => async (page: Page) => {
  await recoverAdminGate(page);
  const search = page.getByPlaceholder(/search name, email, phone or job id/i);
  await search.waitFor({ timeout: 20_000 });
  await search.fill(email);
  await page.waitForTimeout(600);
  const row = page.locator('[role="button"][tabindex="0"]').first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await row.click();
};

const openAdminUserAction = (email: string, buttonName: RegExp) => async (page: Page) => {
  await openAdminUserByEmail(email)(page);
  const btn = page.getByRole("button", { name: buttonName }).first();
  await btn.waitFor({ timeout: 10_000 });
  await btn.click();
};

/**
 * /admin?view=jobs auto-opens a job's JobDetailDialog from `?job=<uuid>`
 * (AdminJobs.tsx: the same deep-link the admin people search's UUID drill
 * uses) — Remove/Manual-Override/Refund are one click inside it.
 */
const openAdminJobAction = (buttonName: RegExp) => async (page: Page) => {
  const job = fixtureOrThrow("inProgressJob", "in-progress (escrowed) job");
  await recoverAdminGate(page);
  await page.goto(`/admin?view=jobs&job=${job.id}`);
  await recoverAdminGate(page);
  const btn = page.getByRole("button", { name: buttonName }).first();
  await btn.waitFor({ timeout: 15_000 });
  await btn.click();
};

export const FORMS: FormSpec[] = [
  { name: "login", url: "/login", as: null, covers: ["src/pages/Login.tsx"] },
  { name: "forgot-password", url: "/forgot-password", as: null, covers: ["src/pages/ForgotPassword.tsx"] },
  { name: "signup-step1", url: "/signup", as: null, covers: ["src/pages/signup/SignupStep1.tsx"] },
  {
    name: "signup-step2", url: "/signup", as: null,
    prepare: async (page) => {
      // Step 2 is gated on a well-formed step 1; nothing is sent until the final step.
      await page.locator("#email").fill("messy.prodaudit@example.com");
      await page.locator("#password").fill("Sturdy-passw0rd-123");
      // TWO HARD GATES, not one field pair (SignupStep1.handleContinue): the
      // policies agreement (#policies) and the 18+ attestation (#age-confirm).
      // Continue deliberately stays ENABLED while either is unchecked — it
      // shakes the offending box instead of greying out, which is better for a
      // person and invisible to a driver that only presses it. Leaving them
      // unchecked is why step 2 never opened and every spec that starts here
      // failed with "#firstName not found" (measured 2026-09-20).
      for (const id of ["#policies", "#age-confirm"]) {
        const box = page.locator(id);
        await box.waitFor({ timeout: 10_000 });
        if ((await box.getAttribute("data-state")) !== "checked") await box.click();
        await expect(box, `${id} did not check — step 1 will not advance`).toHaveAttribute("data-state", "checked");
      }
      await page.getByRole("button", { name: /continue|next/i }).first().click();
      // Say WHICH gate held, instead of surfacing three steps later as a
      // missing #firstName.
      await expect(
        page.locator("#firstName"),
        "step 1 did not advance to step 2 — email/password accepted and both consent boxes checked, " +
          "so a new required control was added to SignupStep1",
      ).toBeVisible({ timeout: 15_000 });
    },
    covers: ["src/pages/signup/SignupStep2.tsx"],
  },
  { name: "support", url: "/support", as: null, covers: ["src/pages/Support.tsx", "src/lib/supportTopics.ts"] },
  { name: "legal-search", url: "/legal", as: null, prepare: openSearch, covers: ["src/pages/Legal.tsx"] },
  {
    // SIGNED IN, not signed out. /reset-password renders its two password
    // fields on three conditions (ResetPassword.tsx): a `#type=recovery` hash,
    // a PASSWORD_RECOVERY/SIGNED_IN auth event, or — the one a spec can reach
    // honestly — an existing session, because a signed-in user changing their
    // password is a real journey the screen serves. Signed out and with no
    // link it correctly shows "use the reset link from your email" and no
    // field, which is what the sweep was hitting.
    //
    // Why not mint a real recovery link: `generate_link` ignores a
    // `redirect_to` that is not on the project's allow-list (verified
    // 2026-09-20 — it returned the www.louisianahelpr.com action link for a
    // 127.0.0.1:4173 request), so the token cannot land on the local preview
    // this project serves. And a live recovery session here would be actively
    // dangerous: the write firewall lets `/auth/v1/user` through, so a stray
    // submit would change a SHARED test account's password out from under
    // every other lane. A plain session renders the identical form with no
    // such edge.
    name: "reset-password", url: "/reset-password", as: "poster", covers: ["src/pages/ResetPassword.tsx"],
  },
  {
    name: "post-job", url: "/post-job", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /start fresh/i); },
    covers: ["src/components/postjob/detailsSection/TitleField.tsx", "src/components/postjob/detailsSection/DescriptionField.tsx"],
  },
  { name: "dashboard-search", url: "/dashboard", as: "helper", prepare: openSearch, covers: ["src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx"] },
  { name: "messages-list", url: "/messages", as: "helper", prepare: openSearch, covers: ["src/components/messages/ConversationList.tsx"] },
  { name: "my-posts-search", url: "/my-posts", as: "poster", prepare: openSearch, covers: ["src/pages/activity/ActivityHeader.tsx"] },
  { name: "complete-profile", url: "/complete-profile", as: "incomplete", covers: ["src/pages/CompleteProfile.tsx", "src/components/postjob/CityAutocomplete.tsx"] },
  { name: "profile-edit", url: "/profile?tab=profile", as: "helper", covers: ["src/components/profile/ProfileEditForm.tsx", "src/components/profile/profileEditForm/PhotoNameSection.tsx"] },
  { name: "profile-support", url: "/profile?tab=support", as: "helper", covers: ["src/components/profile/SupportInline.tsx"] },
  { name: "gift-card", url: "/profile?tab=gift_card", as: "poster", covers: ["src/pages/GiftCard.tsx"] },
  {
    // Auto-tip opens on "Off", and the amount and cap fields only exist while
    // a mode is chosen (`mode !== "off"` in AutoTip.tsx) — correct product
    // behaviour: there is no amount to type when the feature is off. The mode
    // tiles are `role="radio"`, not buttons, so `pressIfPresent` cannot see
    // them. "Percent" is chosen over "Fixed" because it renders BOTH number
    // fields (the percent value and the dollar cap); "Fixed" renders only one.
    name: "auto-tip", url: "/profile?tab=auto_tip", as: "poster",
    prepare: async (page) => {
      await page.getByRole("radio", { name: /^percent$/i }).first().click().catch(() => {});
      await page.locator("#auto-tip-custom").waitFor({ timeout: 5_000 }).catch(() => {});
    },
    covers: ["src/pages/AutoTip.tsx"],
  },
  { name: "saved-helpers", url: "/profile?tab=saved_helpers", as: "poster", prepare: openSearch, covers: ["src/components/profile/SavedHelpersTab.tsx"] },
  {
    name: "pets", url: "/profile?tab=pets", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /add (a |another )?pet/i); },
    covers: ["src/pages/petProfiles/PetForm.tsx"],
  },
  {
    name: "str-settings", url: "/profile?tab=str_settings", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /add (a )?calendar/i); },
    covers: ["src/pages/strSettings/AddCalendarForm.tsx"],
  },
  // Every admin entry opens the gate first — see `recoverAdminGate`. The four
  // below reach their field on a healthy gate and would have reported "the
  // form did not render" on a hiccuped one, exactly as referrals did.
  { name: "admin-settings", url: "/admin?view=settings", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminSettings.tsx"] },
  { name: "admin-people", url: "/admin?view=people", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminUsers.tsx"] },
  {
    // The referrals search box is scoped to the three list tabs and hidden on
    // the "Overview" tab the view opens on (`tab !== "overview"` in
    // AdminReferrals.tsx) — Overview is a stat summary with nothing to search.
    // OPEN THE GATE, THEN WAIT FOR THE TAB, THEN PRESS IT. `pressIfPresent`
    // presses whatever is on screen at that instant and silently does nothing
    // when it is not, so neither a hiccuped admin gate nor a slow render left
    // any trace: the tab strip was not there, the press never happened, the
    // searchbox never opened, and the sweep blamed the form.
    name: "admin-referrals", url: "/admin?view=referrals", as: "admin",
    prepare: async (page) => {
      await recoverAdminGate(page);
      const codes = page.getByRole("button", { name: /^codes\b/i }).first();
      await codes.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
      if (await codes.isVisible().catch(() => false)) await codes.click();
      await page.getByRole("searchbox", { name: /search referrals/i }).waitFor({ timeout: 10_000 }).catch(() => {});
    },
    covers: ["src/components/admin/AdminReferrals.tsx"],
  },
  { name: "admin-subscriptions", url: "/admin?view=subscriptions", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminSubscriptions.tsx"] },
  { name: "admin-notiflogs", url: "/admin?view=notiflogs", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminNotificationLogs.tsx"] },

  // ── The 21 forms docs/OPEN.md (2026-09-22) flagged as never reached ──────
  // (20 here; the 21st, ReuploadIdDialog.tsx, was dead code and was deleted.)
  {
    name: "messages-thread", url: "/messages", as: "helper", prepare: openMessageThread("poster"),
    covers: ["src/components/RichMessageInput.tsx", "src/components/messages/ChatView.tsx"],
  },
  { name: "saved-searches-dialog", url: "/dashboard", as: "poster", prepare: openSavedSearches, covers: ["src/components/SavedSearches.tsx"] },
  { name: "report-user-dialog", url: "/dashboard", as: "poster", prepare: openReportDialog("helper"), covers: ["src/components/ReportDialog.tsx"] },
  // Covers DisputeDialog.tsx, the file that renders the fields. The old entry
  // named ActivityDialogs.tsx, which only mounts it and is not in the form
  // inventory at all — a `covers` entry the coverage test could never check.
  { name: "activity-dispute-dialog", url: "/my-jobs", as: "helper", prepare: openDisputeDialog, covers: ["src/components/DisputeDialog.tsx"] },
  { name: "active-job-section", url: "/my-jobs", as: "helper", prepare: openActiveJobSection, covers: ["src/components/activity/appliedJobCard/ActiveJobSection.tsx"] },
  { name: "disputed-section", url: "/my-jobs", as: "helper", prepare: openDisputedSectionResponse, covers: ["src/components/activity/appliedJobCard/DisputedSection.tsx"] },
  { name: "pending-application-section", url: "/my-jobs", as: "helper", prepare: openPendingApplicationEdit, covers: ["src/components/activity/appliedJobCard/PendingApplicationSection.tsx"] },
  {
    name: "admin-reports-message", url: "/admin?view=reports", as: "admin",
    // "Message <name>" renders only on a report that is still open — New or
    // Investigating (AdminReports.tsx) — and the view opens on New. On prod
    // 2026-09-23 New was empty while four reports sat in Investigating, so
    // the old wait timed out on a correct empty state. Widen to "All" (the
    // filter strip's own chip, told apart from the per-report "Investigating"
    // ACTION by `aria-pressed`); ensureMessyInputState (harness.ts) makes
    // sure at least one open report exists.
    prepare: async (page) => {
      await recoverAdminGate(page);
      const all = page.locator("button[aria-pressed]").filter({ hasText: /^all$/i }).first();
      await all.waitFor({ timeout: 20_000 });
      await all.click();
      // Enabled only: a report whose subject was deleted renders a DISABLED
      // "Message Reported" first (measured on prod 2026-09-23).
      const msg = page.getByRole("button", { name: /^message /i, disabled: false }).first();
      await msg.waitFor({ timeout: 15_000 });
      await msg.click();
      await page.getByRole("textbox", { name: /message to user/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/admin/AdminReports.tsx"],
  },
  {
    // Notes render unconditionally on the Actions tab for ANY user — no
    // special seed state needed, so the shared poster account is enough.
    name: "admin-user-notes", url: "/admin?view=people&tab=all", as: "admin",
    prepare: async (page) => { await openAdminUserByEmail(emailFor("poster"))(page); },
    covers: ["src/components/admin/AdminUserNotes.tsx"],
  },
  {
    // Reject renders only on a pending credential WITH a document
    // (AdminCredentialQueue.tsx). ensureMessyInputState (harness.ts) attaches
    // one to the helper's own pending credential for the run — prod's only
    // queue row on 2026-09-23 had none, so the row rendered with no actions.
    name: "admin-credential-reject", url: "/admin?view=credentials", as: "admin",
    prepare: async (page) => {
      await recoverAdminGate(page);
      const reject = page.getByRole("button", { name: /^reject$/i }).first();
      await reject.waitFor({ timeout: 20_000 });
      await reject.click();
      await page.getByRole("textbox", { name: /credential rejection reason/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/admin/AdminCredentialQueue.tsx"],
  },
  {
    name: "admin-dispute-decide", url: "/admin?view=disputes", as: "admin",
    prepare: async (page) => {
      await recoverAdminGate(page);
      const decide = page.getByRole("button", { name: /decide outcome/i }).first();
      await decide.waitFor({ timeout: 15_000 });
      await decide.click();
    },
    covers: ["src/components/admin/adminDisputes/DisputeCard.tsx"],
  },
  {
    // Only a profile carrying a real user_violations row shows "Reverse this
    // strike" — the seed-owned banned tester carries two (prod-seed.mjs
    // viol:banned-1/-2), never the shared accounts.
    name: "admin-reverse-strike", url: "/admin?view=people&tab=all", as: "admin",
    prepare: openAdminUserAction(SEED_BANNED_EMAIL, /reverse this strike/i),
    covers: ["src/components/admin/userDetail/UserAuditLog.tsx"],
  },
  {
    name: "admin-ban-dialog", url: "/admin?view=people&tab=all", as: "admin",
    prepare: async (page) => { await openAdminUserAction(emailFor("poster"), /suspend\s*\/\s*ban/i)(page); },
    covers: ["src/components/admin/BanDialog.tsx"],
  },
  {
    // Deny only renders on a profile with approval_status "pending" — the
    // seed-owned pending tester, never the shared (already-approved) accounts.
    name: "admin-deny-dialog", url: "/admin?view=people&tab=all", as: "admin",
    prepare: openAdminUserAction(SEED_PENDING_EMAIL, /^deny$/i),
    covers: ["src/components/admin/DenyUserDialog.tsx"],
  },
  {
    name: "admin-formal-warning", url: "/admin?view=people&tab=all", as: "admin",
    prepare: async (page) => { await openAdminUserAction(emailFor("poster"), /^formal warning$/i)(page); },
    covers: ["src/components/admin/FormalWarningDialog.tsx"],
  },
  {
    name: "admin-restrict-applications", url: "/admin?view=people&tab=all", as: "admin",
    prepare: async (page) => { await openAdminUserAction(emailFor("poster"), /restrict applications/i)(page); },
    covers: ["src/components/admin/RestrictApplicationsDialog.tsx"],
  },
  { name: "admin-job-refund", url: "/admin?view=jobs", as: "admin", prepare: openAdminJobAction(/^refund poster$/i), covers: ["src/components/admin/adminJobs/RefundJobDialog.tsx"] },
  { name: "admin-job-remove", url: "/admin?view=jobs", as: "admin", prepare: openAdminJobAction(/^remove job$/i), covers: ["src/components/admin/adminJobs/RemoveJobDialog.tsx"] },
  { name: "admin-job-override", url: "/admin?view=jobs", as: "admin", prepare: openAdminJobAction(/manual override/i), covers: ["src/components/admin/adminJobs/StatusOverrideDialog.tsx"] },

  // ── The coverage test's 14 unaccounted files (prod run 35817028797, and the
  // local rerun 2026-09-23): 7 FormSpecs here, 3 non-text files and 4
  // funded-open-job forms in GAPS ─────────────────────────────────────────────
  // Each was expected to be credited by an EXPLORE pass, and none ever was:
  // the explore presses a screen's top-level controls, and every one of these
  // sits one level deeper — inside an expanded activity card, behind a card's
  // overflow, in a panel a chip opens, or behind a pencil. Credited here by a
  // FormSpec that opens it the way a person does, so the sweep types into the
  // real field instead of the coverage test hoping a presser stumbles on it.
  {
    name: "withdraw-application-other", url: "/my-jobs", as: "helper",
    prepare: async (page) => {
      await openActivityCard(page, "/my-jobs", fixtureOrThrow("jobWithPendingApplicant", "job with a pending application"));
      await pressChipForField(page, /^withdraw application$/i, { field: false });
      // The reason list is radio-like rows; only "Other" reveals the box.
      await page.getByRole("button", { name: /^other$/i }).or(page.getByRole("radio", { name: /^other$/i })).first().click();
      await page.getByRole("textbox", { name: /withdraw reason — other/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/activity/AppliedJobsTab.tsx"],
  },
  {
    name: "block-user-dialog", url: "/dashboard", as: "poster",
    prepare: async (page) => {
      await page.goto(`/user/${idFor("helper")}`);
      await settle(page);
      await page.getByRole("button", { name: /more options/i }).first().click();
      await page.getByRole("menuitem", { name: /block/i }).first().click();
      await page.getByRole("textbox", { name: /block reason/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/BlockUserDialog.tsx"],
  },
  {
    // Own profile only: "Add Response" renders for the profile's owner on a
    // review with no response yet (ReviewsSection.tsx `isOwnProfile`). The
    // helper held 25 such reviews on prod, 2026-09-23. The list is collapsed
    // behind the reviews tile until `?tab=reviews` (UserProfile.tsx `showReviews`).
    name: "review-public-response", url: "/dashboard", as: "helper",
    prepare: async (page) => {
      await page.goto(`/user/${idFor("helper")}?tab=reviews`);
      await settle(page);
      const add = page.getByRole("button", { name: /^add response$/i }).first();
      await add.waitFor({ timeout: 20_000 });
      await add.click();
      await page.getByRole("textbox", { name: /write a public response/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/pages/userProfile/ReviewsSection.tsx"],
  },
  {
    name: "saved-helper-note", url: "/profile?tab=saved_helpers", as: "poster",
    prepare: async (page) => {
      const note = page.getByRole("button", { name: /^(edit|add) (a )?private note$/i }).filter({ visible: true }).first();
      await note.waitFor({ timeout: 20_000 });
      await note.click();
      await page.getByRole("textbox", { name: /private note about this helpr/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/profile/savedHelpersTab/SavedHelperCard.tsx"],
  },
  {
    // The goal card renders only on the "This Month" range (EarningsTab.tsx
    // `range === "month"`); the tab opens on Lifetime.
    name: "monthly-goal", url: "/profile?tab=earnings", as: "helper",
    prepare: async (page) => {
      const month = page.getByRole("button", { name: /^this month$/i }).or(page.getByRole("tab", { name: /^this month$/i })).or(page.getByRole("radio", { name: /^this month$/i })).first();
      await month.waitFor({ timeout: 20_000 });
      await month.click();
      const edit = page.getByRole("button", { name: /edit monthly goal/i }).first();
      await edit.waitFor({ timeout: 20_000 });
      await edit.click();
      await page.getByRole("spinbutton", { name: /monthly earnings goal/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/profile/MonthlyGoalCard.tsx"],
  },
  {
    // The field renders only while "I Am Licensed"/"I Am Insured" is on, so
    // the prepare flips the switch the way the helper does. Since Q99 the
    // switch writes nothing (profiles.is_licensed is server-owned:
    // `prevent_self_escalation` resets it for every non-admin), so there is
    // nothing to undo; the switch opens the field for this visit only.
    name: "credentials-business-name", url: "/profile?tab=credentials", as: "helper",
    prepare: async (page) => {
      const lic = page.locator("#lic-toggle");
      await lic.waitFor({ timeout: 20_000 });
      if ((await lic.getAttribute("data-state")) !== "checked") await lic.click();
      await page.locator("#business-name").waitFor({ timeout: 15_000 });
    },
    covers: ["src/components/profile/CredentialsTab.tsx"],
  },
  {
    // The AI builder is a collapsed card on the post-job ENTRY step
    // (EntryChoice.tsx), so this does not press "Start Fresh".
    name: "ai-job-builder", url: "/post-job", as: "poster",
    prepare: async (page) => {
      const toggle = page.locator("button[aria-expanded]").filter({ hasText: /let ai fill/i }).first();
      await toggle.waitFor({ timeout: 20_000 });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await page.getByRole("textbox", { name: /^describe your job$/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/postjob/AiJobBuilder.tsx"],
  },
];

const FUNDED_OPEN_JOB_GAP =
  "needs a FUNDED open job of poster-e2e with a pending applicant — none on prod (every open one is unpaid/abandoned, which My Posts hides); creating one is a Stripe test checkout, tracked in docs/OPEN.md";

/** Inventory files with no typed text (or scanner false positives), each with its reason. */
export const GAPS: Record<string, string> = {
  // Scanner false positives: the regex matched a string/comment, not a rendered control.
  "src/lib/sentry.ts": "false positive — '<input' in a PII-scrubbing comment/regex, no control",
  "src/lib/nativeCamera.ts": "false positive — creates a hidden file <input> for the camera fallback; file inputs take no typed text",
  "src/lib/offerResponseWindow.ts": "false positive — option list for a Select, rendered by DirectOfferBanner",
  "src/components/admin/marketing/marketingTypes.ts": "false positive — type/constant module",
  "src/components/notificationPreferences/constants.tsx": "false positive — constants module",
  "src/components/activity/JobCardMetaRow.tsx": "false positive — displays a date, no control",
  "src/components/dashboard/JobCard.tsx": "false positive — displays a date, no control",
  "src/hooks/useComboboxKeyboard.ts": "false positive — a keyboard hook; the scanner matched `<input type=\"search\">` in a comment, it renders nothing",
  "src/components/postjob/CheckoutStep.tsx": "checkboxes only (save-card, confirm-details) — the 'input×1' is a comment naming the raw `<input type=\"checkbox\">` it replaced; no typed text",
  "src/components/DisputeTimelineDialog.tsx": "file input only (evidence upload) — no typed text",
  // Reached only through a control the explore is FORBIDDEN to press.
  // `NEVER_PRESS` in harness.ts matches /delete (my )?account/, so the button
  // that opens this dialog is refused before the dialog can exist. That is not
  // a coverage decision to revisit: the shared test accounts are a sign-in
  // dependency for this whole suite, and the write firewall does not help here
  // because the refusal is at the press, not the request.
  //
  // RESOLVED 2026-09-22: the 21 files docs/OPEN.md flagged as unaccounted
  // (prod-audit run 35798352756) were NOT this case — BanDialog,
  // RefundJobDialog, RemoveJobDialog, StatusOverrideDialog and the rest were
  // always SAFE to open behind the write firewall, simply never reached. 20
  // of the 21 now have a FormSpec above. The 21st, ReuploadIdDialog.tsx, was
  // genuinely dead (no control opened it) and was deleted (owner, 2026-09-23).
  "src/components/profile/DeleteAccountDialog.tsx":
    "opened only by a control NEVER_PRESS refuses (/delete (my )?account/) — the shared accounts are a sign-in dependency for the suite",
  // Non-text controls: no typed value to be messy. Checked by press-every-control (npm run audit:press).
  "src/components/dashboard/FilterSheet.tsx": "switch only — no typed input",
  "src/components/admin/AdminNotifications.tsx": "switches only",
  "src/components/admin/adminPayoutBatches/BatchRow.tsx": "checkbox only",
  "src/components/admin/AdminFraudDashboard.tsx": "select only",
  "src/components/admin/userDetail/JobsTab.tsx": "select only",
  "src/components/HelperAvailability.tsx": "switches only",
  "src/components/profile/AvailabilityTab.tsx": "switch only",
  "src/components/profile/earningsTab/PayoutHistory.tsx": "select only",
  "src/components/postjob/detailsSection/PhotoProofToggle.tsx": "switch only",
  "src/components/TimePickerSelect.tsx": "selects only — constrained options",
  "src/components/TimePickerWheel.tsx": "wheel picker — constrained options",
  "src/components/DatePickerField.tsx": "calendar/wheel picker — no typed date (DOB bound asserted in the targeted tests)",
  "src/components/profile/ScheduleTab.tsx": "calendar only",
  "src/pages/HomeHistory.tsx": "date picker only",
  "src/pages/WorkRecord.tsx": "date picker only",
  "src/components/admin/adminJobs/JobDetailDialog.tsx": "calendar display only",
  "src/components/EarningsExport.tsx": "selects + date pickers, constrained",
  "src/pages/postjob/DirectOfferBanner.tsx": "select only",
  "src/components/TimeRangeField.tsx": "time input, constrained by the browser",
  "src/components/profile/AvatarCropDialog.tsx": "file input / zoom slider — no typed text",
  "src/components/PhotoProof.tsx": "file input only",
  "src/components/postjob/detailsSection/PhotoUpload.tsx": "file inputs only",
  "src/components/postjob/detailsSection/VideoScope.tsx": "file input only",
  "src/components/profile/profileEditForm/RecentWorkSection.tsx": "file input only",
  "src/components/NotificationPreferences.tsx": "switches only",
  "src/components/profile/TwoFactorCard.tsx": "6-digit code field appears only after a real authenticator enrolment; not swept on the shared accounts (would enrol 2FA on them)",
  "src/components/W9CollectionDialog.tsx": "opens only when a helper crosses the $600 tax threshold in the current year; no seed state (real money)",
  "src/components/feedback/NpsPrompt.tsx": "appears on a 30-day cadence after a completed job; not reachable on demand",
  "src/components/ResponseDeadlineDialog.tsx": "select only (response window)",
  "src/components/CompletionPrompts.tsx": "yes/no prompts, no typed text",
  "src/components/activity/CompletionChoiceSheet.tsx": "choice sheet, no typed text",
  // Admin queues that only real events fill (prod-seed.mjs 'Not produced, by design').
  "src/components/admin/AdminExceptionQueue.tsx": "verification_exceptions queue — no seed row (prod-seed: admin work queue, no honest seed value)",
  "src/components/admin/AdminPayoutBatches.tsx": "payout batches — real Stripe transfers only; no seed batch",
  // Measured on prod as the admin test account, 2026-09-20 (screenshots in
  // the lane report). These two are EMPTY QUEUES, not unreachable screens:
  // the form is real, there is simply no row in prod for it to open against,
  // and seeding one would mean manufacturing a ban or a paid-for failed
  // Stripe Identity attempt. Re-check when prod has a row.
  "src/components/admin/AdminBanReview.tsx": "empty queue on prod — /admin?view=banreview renders \"No accounts awaiting review\"; the ban-reason and dismissal-note boxes live on a pending-review row and there is none. Seeding one means putting a real consequence-ladder restriction on a shared test account",
  "src/components/admin/AdminIDVReview.tsx": "empty queue on prod — /admin?view=idvreview renders \"Nobody is waiting on a human\"; a row lands here only after Stripe CHARGED for an identity attempt and failed it, which cannot be seeded without paying Stripe for a real verification",
  // Opened only from a FUNDED open job of the poster's (OpenStep.tsx: Edit
  // job / Cancel job; PostedJobsTab: the applicants panel and its Decline
  // sheet). My Posts hides an unfunded open job entirely
  // (activityFilters.ts `jobIsUnfundedDraft`), and on prod 2026-09-23
  // poster-e2e's every open job was unpaid/abandoned — the seeded
  // pending-applicant job is `abandoned`. Making one means a real Stripe
  // test-mode checkout plus a helper application, torn down with
  // cancel_escrow: a money fixture, tracked in docs/OPEN.md (Q49 follow-up,
  // "funded open job fixture"). The FormSpec stops being a gap the day it
  // lands — the stale-gap check fails if these are ever credited.
  "src/components/activity/EditJobDialog.tsx": FUNDED_OPEN_JOB_GAP,
  "src/components/CancellationDialog.tsx": FUNDED_OPEN_JOB_GAP,
  "src/components/activity/postedJobs/ApplicantsPanel.tsx": FUNDED_OPEN_JOB_GAP,
  "src/components/activity/postedJobs/DeclineApplicantSheet.tsx": FUNDED_OPEN_JOB_GAP,
  // Read-only by decision, not by reachability.
  "src/components/admin/EditEmailDialog.tsx": "reachable (user detail → Edit email) but deliberately NOT swept: it rewrites an account's login address, and every shared test account is a sign-in dependency for this whole suite. One stray submit slipping the write firewall would lock every lane out of that account",
};
