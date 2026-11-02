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
import { APPLICANTS_PRIMARY, CANCEL_JOB_CHIP, DECLINE_BUTTON, EDIT_JOB_CHIP, MORE_BUTTON, MORE_PANEL, PRIVATE_NOTE_BUTTON } from "./applicantCardNames";

export interface FormSpec {
  name: string;
  url: string;
  /** null = signed out */
  as: Account | null;
  /** Get from the URL to the form itself (e.g. press "Start from scratch"). */
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
 * OPEN THE COLLAPSED SEARCH. Five surfaces (/legal, /home, /messages,
 * /posts, /profile?tab=saved_helpers) start with no search field in the DOM
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
// The old My Jobs / My Posts paths; Jobs > Working / Posted since 2026-10-19 (Q2205), with the job deep link kept.
const openActivityCard = async (page: Page, tab: "/jobs" | "/posts", job: { id: string; title: string }) => {
  await page.goto(`/jobs?tab=${tab === "/jobs" ? "working" : "posted"}&job=${job.id}`);
  await settle(page);
  await expandJobCard(page, job.title);
};

/** Press a card chip by its accessible name (JobActionChip's `ariaLabel`, not its visible label) and wait for the field it opens. */
//
// A step whose action row is full parks the rest behind its "More" overflow
// (JobActionRow.tsx `data-job-step-overflow`) — measured on prod 2026-09-23:
// the confirmed card shows Directions · More · I'm on my way, with Cancel job
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

/** /home's Filters sheet folds "Saved Searches" into its last section (BrowseTasksToolbar.tsx) — open the sheet, then the row. */
const openSavedSearches = async (page: Page) => {
  await page.getByRole("button", { name: /^filters/i }).first().click();
  const row = page.getByRole("button", { name: /saved searches/i }).first();
  await row.waitFor({ timeout: 10_000 });
  await row.click();
};

/**
 * /user/:id's "More options" menu holds Report user (UserProfile.tsx). The
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
  await openActivityCard(page, "/jobs", job);
  await pressChipForField(page, /^report a problem/i);
};

/**
 * The helper's expanded Active-Job card offers exactly one of "Cancel job"
 * (reveals ActiveJobSection's own abort-reason textarea) or "Report a
 * Problem" (opens the same DisputeDialog as above) — never both, they are the
 * complement of each other over the job's tracker sub-status
 * (ActiveJobSection.tsx: `showExit`/`showReport`). Press whichever the
 * standing job is actually showing rather than assuming one.
 */
//
// The field this FormSpec covers is ActiveJobSection's OWN abort-reason box,
// which only the Cancel job confirm holds — so it opens on a job the helper
// has confirmed and not yet left for (`helperConfirmedJob`), never on the
// Report-a-problem side, whose field belongs to DisputeDialog (the
// activity-dispute-dialog spec). The old version pressed "whichever is
// showing", matched neither (both chips' accessible names are their
// `ariaLabel`s — "Cancel this job? …" and "Report a problem — …" — so the
// exact-label regexes never matched), and swallowed the miss.
const openActiveJobSection = async (page: Page) => {
  const job = fixtureOrThrow("helperConfirmedJob", "job the helper confirmed but has not left for");
  await openActivityCard(page, "/jobs", job);
  // Unanchored: inside the overflow sheet the same control is named
  // "Cancel job — Cancel this job? …" (label + ariaLabel).
  await pressChipForField(page, /cancel this job\?/i);
};

/**
 * The helper's expanded Disputed card offers "Respond to dispute"/"Add Your
 * Side" (a textarea) to whichever side did NOT file, and "Withdraw dispute"
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
  await openActivityCard(page, "/jobs", job);
  await pressChipForField(page, /respond to dispute|add your side/i);
};

/** The helper's expanded pending-application card's "Edit" chip opens the message editor (AppliedJobCard.tsx). */
// The pencil's accessible name is "Edit your message" (PendingApplicationSection.tsx).
const openPendingApplicationEdit = async (page: Page) => {
  const job = fixtureOrThrow("jobWithPendingApplicant", "job with a pending application");
  await openActivityCard(page, "/jobs", job);
  await pressChipForField(page, /^edit your message$/i);
};

/**
 * Seeded, `is_seed=true` admin-console test subject distinct from the
 * shared poster/helper/admin accounts (scripts/audit/prod-seed.mjs `OWNED`):
 * it holds two real `user_violations` rows (for "Reverse this strike", which
 * only renders on a profile with one). It is never the account these sweeps
 * sign in as — only the admin console's SEARCH target. (A pending tester for
 * the Deny dialog lived here until Q193 removed approval/deny.)
 */
const SEED_BANNED_EMAIL = "helpr-seed-banned-0912@mailinator.com";

/**
 * Search /admin?view=people (tab=all, so approval/ban status can never hide
 * the target; test=show, because every account this harness targets is a test
 * account and the list hides those by default, owner 2026-10-09) for one
 * account by email and open its detail dialog, which
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

/**
 * Q100: open the applicant fixture's card on My Posts, expanded. `?job=`
 * resolves the card's bucket (Activity.tsx) and opens it; tap its title only
 * when the card's row (More + Applicants) is not already showing. Every chip of
 * that row lives under `More` since 2026-10-08 (applicantCardNames.ts), so the
 * card being open is read from its primary, never from "Edit job".
 */
async function openApplicantFixtureCard(page: Page): Promise<void> {
  const job = runtime.applicantJob;
  if (!job) throw new Error("Q100: no applicant fixture — messy-input.spec.ts's beforeAll did not mint one");
  await page.goto(`/posts?job=${job.id}`);
  await settle(page);
  const title = page.getByRole("heading", { name: job.title }).first();
  await title.waitFor({ timeout: 30_000 });
  const applicants = page.getByRole("button", { name: APPLICANTS_PRIMARY }).first();
  if (!(await applicants.isVisible().catch(() => false))) await title.click();
  await applicants.waitFor({ timeout: 15_000 });
}

/** Open the fixture card's `More` popover and press the chip named `chip` inside it. */
async function pressMoreChip(page: Page, chip: RegExp): Promise<void> {
  await openApplicantFixtureCard(page);
  await page.getByRole("button", { name: MORE_BUTTON }).first().click();
  const panel = page.getByRole("dialog", { name: MORE_PANEL });
  await panel.getByRole("button", { name: chip }).first().click({ timeout: 15_000 });
}

async function openApplicantsPanel(page: Page): Promise<void> {
  await openApplicantFixtureCard(page);
  await page.getByRole("button", { name: APPLICANTS_PRIMARY }).first().click();
  await page.getByRole("button", { name: DECLINE_BUTTON }).first().waitFor({ timeout: 20_000 });
}

export const FORMS: FormSpec[] = [
  { name: "login", url: "/login", as: null, covers: ["src/pages/auth/Login.tsx"] },
  { name: "forgot-password", url: "/forgot-password", as: null, covers: ["src/pages/auth/ForgotPassword.tsx"] },
  { name: "signup-step1", url: "/signup", as: null, covers: ["src/pages/auth/signup/SignupStep1.tsx"] },
  {
    name: "signup-step2", url: "/signup", as: null,
    prepare: async (page) => {
      // Step 2 is gated on a well-formed step 1; nothing is sent until the final step.
      // First and last name are on step 1 since 2026-10-27 (owner 2026-10-26).
      await page.locator("#firstName").fill("Messy");
      await page.locator("#lastName").fill("Prodaudit");
      await page.locator("#email").fill("messy.prodaudit@example.com");
      await page.locator("#password").fill("Sturdy-passw0rd-123");
      // A HARD GATE (SignupStep1.handleContinue): ONE box (#policies, board 55)
      // records both the policies agreement and the 18+ attestation.
      // Continue deliberately stays ENABLED while either is unchecked — it
      // shakes the offending box instead of greying out, which is better for a
      // person and invisible to a driver that only presses it. Leaving them
      // unchecked is why step 2 never opened and every spec that starts here
      // failed with "#firstName not found" (measured 2026-09-20).
      for (const id of ["#policies"]) {
        const box = page.locator(id);
        await box.waitFor({ timeout: 10_000 });
        if ((await box.getAttribute("data-state")) !== "checked") await box.click();
        await expect(box, `${id} did not check — step 1 will not advance`).toHaveAttribute("data-state", "checked");
      }
      await page.getByRole("button", { name: /continue|next/i }).first().click();
      // Say WHICH gate held, instead of surfacing three steps later as a
      // missing #zipCode.
      await expect(
        page.locator("#zipCode"),
        "step 1 did not advance to step 2 — email/password accepted and both consent boxes checked, " +
          "so a new required control was added to SignupStep1",
      ).toBeVisible({ timeout: 15_000 });
    },
    covers: ["src/pages/auth/signup/SignupStep2.tsx"],
  },
  { name: "support", url: "/support", as: null, covers: ["src/pages/info/Support.tsx", "src/lib/supportTopics.ts"] },
  { name: "legal-search", url: "/legal", as: null, prepare: openSearch, covers: ["src/pages/info/Legal.tsx"] },
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
    name: "reset-password", url: "/reset-password", as: "poster", covers: ["src/pages/auth/ResetPassword.tsx"],
  },
  {
    name: "post-job", url: "/post-job", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /start from scratch/i); await pressIfPresent(page, /^home/i); await pressIfPresent(page, /^cleaning$/i); },
    covers: ["src/components/postjob/detailsSection/TitleField.tsx", "src/components/postjob/detailsSection/DescriptionField.tsx"],
  },
  // dashboard-search left 2026-10-28: Jobs > Browse's phone search became an icon at the tabs row's end that opens
  // in place (owner: "search and filter should be next to gear"), InlineListSearch, a decided gap below (it writes
  // nothing: it filters the loaded feed).
  { name: "messages-list", url: "/messages", as: "helper", prepare: openSearch, covers: ["src/components/messages/ConversationList.tsx"] },
  // Board 89: /search, the one search across the sections (its field is always open).
  { name: "search-page", url: "/search", as: "helper", prepare: openSearch, covers: ["src/pages/search/SearchPage.tsx"] },
  // Q2437: Find a Helpr's town box (find_helprs matches it literally and refuses over 60 characters).
  { name: "find-helprs", url: "/helprs", as: "helper", covers: ["src/pages/helprs/FindHelprs.tsx"] },
  // Declutter > Browse (2026-10-19): the same shared SectionSearchRow as Jobs > Browse (every test account is a tester).
  { name: "declutter-search", url: "/declutter", as: "helper", prepare: openSearch, covers: ["src/components/sections/SectionSearchRow.tsx", "src/components/declutter/DeclutterBrowseBar.tsx"] },
  { name: "complete-profile", url: "/complete-profile", as: "incomplete", covers: ["src/pages/auth/CompleteProfile.tsx", "src/components/postjob/CityAutocomplete.tsx"] },
  { name: "profile-edit", url: "/profile?tab=profile", as: "helper", covers: ["src/components/profile/ProfileEditForm.tsx", "src/components/profile/profileEditForm/PhotoNameSection.tsx"] },
  { name: "profile-support", url: "/profile?tab=support", as: "helper", covers: ["src/components/profile/SupportInline.tsx"] },
  { name: "gift-card", url: "/profile?tab=gift_card", as: "poster", covers: ["src/pages/profile/GiftCard.tsx"] },
  {
    // Auto-tip opens switched off, and the amount and cap fields only exist
    // while it is on (board 182: a switch, then pills 10% 15% 20% $5 flat
    // Other). Correct product behaviour: there is no amount to type when the
    // feature is off. Switch on (percent by default, which renders the dollar
    // cap), then "Other" for the custom field: BOTH number fields render.
    // The pills are `role="radio"`, so `pressIfPresent` cannot see them.
    name: "auto-tip", url: "/profile?tab=auto_tip", as: "poster",
    prepare: async (page) => {
      // NEVER REALLY FLIP IT. The switch saves the moment it flips, and this is the SHARED poster account on
      // prod with live Stripe: this prepare ran before the sweep's write firewall and left poster-e2e tipping
      // 15% on every job (found 2026-10-25). The flip's PATCH is answered here, in the browser, so the amount
      // fields render and nothing reaches the database. Guard: src/test/e2eNeverSavesMoneySwitches.test.ts.
      await page.route(/\/rest\/v1\/profiles\b/, (route) =>
        route.request().method() === "PATCH"
          ? route.fulfill({ json: [{ user_id: "e2e-stub" }] })
          : route.continue(),
      );
      const sw = page.getByRole("switch", { name: /tip automatically/i }).first();
      if ((await sw.getAttribute("aria-checked").catch(() => null)) !== "true") await sw.click().catch(() => {});
      await page.getByRole("radio", { name: /^other$/i }).first().click().catch(() => {});
      await page.locator("#auto-tip-custom").waitFor({ timeout: 5_000 }).catch(() => {});
    },
    covers: ["src/pages/profile/AutoTip.tsx"],
  },
  { name: "saved-helpers", url: "/profile?tab=saved_helpers", as: "poster", prepare: openSearch, covers: ["src/components/profile/SavedHelpersTab.tsx"] },
  {
    name: "pets", url: "/profile?tab=pets", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /add (a |another )?pet/i); },
    covers: ["src/pages/profile/petProfiles/PetForm.tsx"],
  },
  {
    name: "str-settings", url: "/profile?tab=str_settings", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /add (a )?calendar/i); },
    covers: ["src/pages/profile/strSettings/AddCalendarForm.tsx"],
  },
  // Every admin entry opens the gate first — see `recoverAdminGate`. The four
  // below reach their field on a healthy gate and would have reported "the
  // form did not render" on a hiccuped one, exactly as referrals did.
  { name: "admin-settings", url: "/admin?view=settings", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminSettings.tsx", "src/components/admin/settings/AdminUserSearchField.tsx", "src/components/admin/settings/AbuseLimitsCard.tsx", "src/components/admin/settings/MinSupportedBuildCard.tsx"] },
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
  // B59: the matchmaker link builder (town, note). It writes nothing; it builds a /post-job link.
  { name: "admin-growth", url: "/admin?view=growth", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminGrowthLinks.tsx"] },

  // ── The 21 forms docs/OPEN.md (2026-09-22) flagged as never reached ──────
  // (20 here; the 21st, ReuploadIdDialog.tsx, was dead code and was deleted.)
  {
    name: "messages-thread", url: "/messages", as: "helper", prepare: openMessageThread("poster"),
    covers: ["src/components/RichMessageInput.tsx", "src/components/messages/ChatView.tsx"],
  },
  { name: "saved-searches-dialog", url: "/jobs", as: "poster", prepare: openSavedSearches, covers: ["src/components/SavedSearches.tsx"] },
  { name: "report-user-dialog", url: "/home", as: "poster", prepare: openReportDialog("helper"), covers: ["src/components/ReportDialog.tsx"] },
  // Covers DisputeDialog.tsx, the file that renders the fields. The old entry
  // named ActivityDialogs.tsx, which only mounts it and is not in the form
  // inventory at all — a `covers` entry the coverage test could never check.
  { name: "activity-dispute-dialog", url: "/jobs?tab=working", as: "helper", prepare: openDisputeDialog, covers: ["src/components/DisputeDialog.tsx"] },
  { name: "active-job-section", url: "/jobs?tab=working", as: "helper", prepare: openActiveJobSection, covers: ["src/pages/jobs/appliedJobCard/ActiveJobSection.tsx"] },
  { name: "disputed-section", url: "/jobs?tab=working", as: "helper", prepare: openDisputedSectionResponse, covers: ["src/pages/jobs/appliedJobCard/DisputedSection.tsx"] },
  { name: "pending-application-section", url: "/jobs", as: "helper", prepare: openPendingApplicationEdit, covers: ["src/pages/jobs/appliedJobCard/PendingApplicationSection.tsx"] },
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
    name: "admin-user-notes", url: "/admin?view=people&tab=all&test=show", as: "admin",
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
    covers: ["src/components/admin/AdminCredentialQueue.tsx", "src/components/admin/credentialQueue/ExpiryField.tsx"],
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
    name: "admin-reverse-strike", url: "/admin?view=people&tab=all&test=show", as: "admin",
    prepare: openAdminUserAction(SEED_BANNED_EMAIL, /reverse this strike/i),
    covers: ["src/components/admin/userDetail/UserAuditLog.tsx"],
  },
  {
    name: "admin-ban-dialog", url: "/admin?view=people&tab=all&test=show", as: "admin",
    prepare: async (page) => { await openAdminUserAction(emailFor("poster"), /suspend\s*\/\s*ban/i)(page); },
    covers: ["src/components/admin/BanDialog.tsx"],
  },
  {
    name: "admin-formal-warning", url: "/admin?view=people&tab=all&test=show", as: "admin",
    prepare: async (page) => { await openAdminUserAction(emailFor("poster"), /^formal warning$/i)(page); },
    covers: ["src/components/admin/FormalWarningDialog.tsx"],
  },
  {
    name: "admin-restrict-applications", url: "/admin?view=people&tab=all&test=show", as: "admin",
    prepare: async (page) => { await openAdminUserAction(emailFor("poster"), /restrict applications/i)(page); },
    covers: ["src/components/admin/RestrictApplicationsDialog.tsx"],
  },
  {
    // 2026-10-09: the admin's direct "Louisiana Helpr Team" message. The sweep
    // types and never presses Send, so the test poster receives nothing.
    name: "admin-message-user", url: "/admin?view=people&tab=all&test=show", as: "admin",
    prepare: async (page) => {
      await openAdminUserAction(emailFor("poster"), /^message$/i)(page);
      await page.getByRole("textbox", { name: /message to/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/admin/AdminMessageUserDialog.tsx"],
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
    name: "withdraw-application-other", url: "/jobs", as: "helper",
    prepare: async (page) => {
      await openActivityCard(page, "/jobs", fixtureOrThrow("jobWithPendingApplicant", "job with a pending application"));
      await pressChipForField(page, /^withdraw application$/i, { field: false });
      // The reason list is radio-like rows; only "Other" reveals the box.
      await page.getByRole("button", { name: /^other$/i }).or(page.getByRole("radio", { name: /^other$/i })).first().click();
      await page.getByRole("textbox", { name: /withdraw reason — other/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/pages/jobs/AppliedJobsTab.tsx"],
  },
  {
    name: "block-user-dialog", url: "/home", as: "poster",
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
    // Own profile only: "Add response" renders for the profile's owner on a
    // review with no response yet (ReviewsSection.tsx `isOwnProfile`). The
    // helper held 25 such reviews on prod, 2026-09-23. The list is collapsed
    // behind the reviews tile until `?tab=reviews` (UserProfile.tsx `showReviews`).
    name: "review-public-response", url: "/home", as: "helper",
    prepare: async (page) => {
      await page.goto(`/user/${idFor("helper")}?tab=reviews`);
      await settle(page);
      const add = page.getByRole("button", { name: /^add response$/i }).first();
      await add.waitFor({ timeout: 20_000 });
      await add.click();
      await page.getByRole("textbox", { name: /write a public response/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/pages/user/ReviewsSection.tsx"],
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
    // The goal card renders only on the "This month" range (EarningsTab.tsx
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
    // The field renders only once a license or COI is on the card. Since Q142
    // the switches are "Add license" / "Add insurance" buttons that open a
    // file picker, so the prepare picks a file into the license input the way
    // the helper does. A picked file is a LOCAL draft: nothing is uploaded or
    // written until "Send for Review", which this never presses, so there is
    // nothing to undo. If the account already has a license on its row the
    // card is open and the field is already there.
    name: "credentials-business-name", url: "/profile?tab=credentials", as: "helper",
    prepare: async (page) => {
      const name = page.locator("#business-name");
      const add = page.locator('input[type="file"][data-credential-add="license"]');
      await page.waitForSelector('#business-name, input[type="file"][data-credential-add="license"]', {
        state: "attached",
        timeout: 20_000,
      });
      if (!(await name.isVisible())) {
        await add.setInputFiles({ name: "license.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
      }
      await name.waitFor({ timeout: 15_000 });
    },
    covers: ["src/components/profile/CredentialsTab.tsx"],
  },
  {
    // The AI builder opens from the first screen's "Describe it with AI" link (EntryChoice.tsx, JA-41).
    name: "ai-job-builder", url: "/post-job", as: "poster",
    prepare: async (page) => {
      const card = page.getByRole("button", { name: /^describe it with ai/i });
      await card.waitFor({ timeout: 20_000 });
      await card.click();
      await page.getByRole("textbox", { name: /^describe your job$/i }).waitFor({ timeout: 10_000 });
    },
    covers: ["src/components/postjob/AiJobBuilder.tsx"],
  },
  // Q100: the four forms that open only from a FUNDED open job of poster-e2e
  // with a PENDING applicant. messy-input.spec.ts's beforeAll mints that job
  // (fundedApplicantJob.ts: Stripe TEST checkout + helper-e2e's apply_to_job)
  // and its afterAll releases it through cancel_escrow. The sweep runs behind
  // the write firewall, so no Save / Confirm / Decline can reach prod.
  {
    name: "edit-job", url: "/posts", as: "poster",
    prepare: async (page) => {
      await pressMoreChip(page, EDIT_JOB_CHIP);
      await page.getByRole("textbox", { name: /^job title$/i }).waitFor({ timeout: 15_000 });
    },
    covers: ["src/pages/posts/EditJobDialog.tsx"],
  },
  {
    name: "cancel-job", url: "/posts", as: "poster",
    prepare: async (page) => {
      await pressMoreChip(page, CANCEL_JOB_CHIP);
      await page.locator("#cancel-reason").waitFor({ timeout: 15_000 });
    },
    covers: ["src/components/CancellationDialog.tsx"],
  },
  {
    // The panel's one text field is the private applicant note (localStorage
    // only), behind "Add Private Note" on the pending applicant's row. It lives
    // in ApplicantPrivateNote since board 170 (shared by the cards and the table).
    name: "applicants-note", url: "/posts", as: "poster",
    prepare: async (page) => {
      await openApplicantsPanel(page);
      await page.getByRole("button", { name: PRIVATE_NOTE_BUTTON }).first().click();
      await page.getByRole("textbox", { name: /^private note$/i }).waitFor({ timeout: 15_000 });
    },
    covers: ["src/pages/posts/postedJobs/applicantsPanel/ApplicantPrivateNote.tsx"],
  },
  {
    name: "decline-applicant", url: "/posts", as: "poster",
    prepare: async (page) => {
      await openApplicantsPanel(page);
      await page.getByRole("button", { name: DECLINE_BUTTON }).first().click();
      await page.locator("#decline-note").waitFor({ timeout: 15_000 });
    },
    covers: ["src/pages/posts/postedJobs/DeclineApplicantSheet.tsx"],
  },
  // Declutter (switch at testers on prod since 2026-10-15 05:14Z; every shared test account is a tester). Until then
  // these three were GAPS ("behind the OFF 'declutter' switch"). The item and review forms open only on a LIVE item
  // the viewer does not sell and on a listing WAITING for a review: messy-input.spec.ts's beforeAll mints both as the
  // shared helper (declutterFixture.ts) and its afterAll deletes them. The sweep never presses Save, Ask, Approve or
  // Reject (write firewall).
  {
    name: "declutter-sell", url: "/declutter/sell", as: "helper",
    // A NEW listing is ONE screen since 2026-10-29 (SellOneScreen): a held photo (never uploaded: only Post saves),
    // then the summary card's title row opens in place ("Add title" / "Edit title"), and the sweep fills the text
    // fields on the screen (title, and the ways' area and address while they are open). Post is never pressed.
    prepare: async (page) => {
      await page.locator("#sell-files").waitFor({ state: "attached", timeout: 20_000 });
      await page.setInputFiles("#sell-files", { name: "sweep.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
      await page.getByRole("button", { name: /^(Add|Edit) title$/ }).click();
      await page.locator("#sell-title").waitFor({ timeout: 20_000 });
    },
    covers: ["src/components/declutter/DeclutterSellView.tsx", "src/components/declutter/DeclutterSellPhotos.tsx", "src/components/declutter/DeclutterPickupTimes.tsx",
      "src/components/declutter/SellOneScreen.tsx", "src/components/declutter/SellSummaryCard.tsx", "src/components/declutter/SellFormParts.tsx"],
  },
  {
    name: "declutter-ask", url: "/declutter", as: "poster",
    prepare: async (page) => {
      const id = runtime.declutter.liveId;
      if (!id) throw new Error("declutter-ask needs the live Declutter fixture item (declutterFixture.ts); none was minted");
      await page.goto(`/declutter/item/${id}`);
      await settle(page);
      await page.locator("#declutter-question").waitFor({ timeout: 20_000 });
    },
    // Board 162 (builder3c): the Ask box moved from DeclutterItemView into DeclutterQuestions (same #declutter-question).
    covers: ["src/components/declutter/DeclutterQuestions.tsx"],
  },
  {
    // Board 158 (builder3b, 2026-10-20): the seller's Manage sheet on the same live fixture item (the helper sells
    // it). The sweep opens "Change price or lowest price" and types; it never presses Save price (write firewall).
    name: "declutter-manage-price", url: "/declutter", as: "helper",
    prepare: async (page) => {
      const id = runtime.declutter.liveId;
      if (!id) throw new Error("declutter-manage-price needs the live Declutter fixture item (declutterFixture.ts); none was minted");
      await page.goto(`/declutter/item/${id}`);
      await settle(page);
      await page.getByRole("button", { name: "Manage listing" }).click();
      await page.getByRole("button", { name: /Change price or lowest price/ }).click();
      await page.locator("#manage-price").waitFor({ timeout: 20_000 });
    },
    covers: ["src/components/declutter/DeclutterManageListing.tsx"],
  },
  {
    name: "declutter-review", url: "/admin?view=settings", as: "admin",
    prepare: async (page) => {
      await recoverAdminGate(page);
      const id = runtime.declutter.pendingId;
      if (!id) throw new Error("declutter-review needs the pending Declutter fixture item (declutterFixture.ts); none was minted");
      await page.locator(`#dcl-note-${id}`).waitFor({ timeout: 20_000 });
    },
    covers: ["src/components/admin/settings/DeclutterReviewCard.tsx"],
  },
];

/** Inventory files with no typed text (or scanner false positives), each with its reason. */
export const GAPS: Record<string, string> = {
  // LEAD-LIST-FOR-SELLER (20261101034159): not swept yet (new 11-01); its server checks are proven in
  // src/test/pglite/declutterListForSeller.pglite.mjs.
  "src/components/declutter/ListedForYouCard.tsx": "no typed text: Approve, Not this one and one checkbox; each approval goes through the normal publish path's checks.",
  "src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx": "Not swept yet (new 11-01): title, description, price and area go through declutter_helpr_create_listing's checks (the same price, area and length rules as a listing; contact-leak trigger on the table).",
  // CMP-4 instant book (20261101063725): Settings > Instant book.
  "src/pages/profile/InstantBookTab.tsx": "Not swept yet (new 11-01): one kind of work from a fixed list and one dollar box (CurrencyInput, min and max shown); rpc_set_instant_book_floor re-checks the category and the dollar range and refuses anything else.",
  // LEAD-PROFILE-LINK: Settings > Your profile link.
  "src/components/profile/ProfileLinkRow.tsx": "Not swept yet: one 30-character box (maxLength 30), normalised (trim, lowercase) and checked against HANDLE_PATTERN before Save is enabled; rpc_set_my_handle re-checks the format and refuses reserved words, 7+ digits and a taken link, and allows one change.",
  "src/components/declutter/SellerSetup.tsx": "Not swept yet: it shows only to a seller missing saved settings. Its address and area go through the same lookup and declutter_save_porch_place checks as the pickup places in Settings.",
  "src/components/declutter/declutterUi.tsx": "The four statements' one checkbox: no text to type, and the sell forms that mount it are swept themselves.",
  // LEAD-SHAKE-PROMPT: the shake switch, split out of SecurityTab (componentSizeRatchet).
  "src/components/profile/ShakeToReportCard.tsx": "no text input: one on/off switch, saved on the device only (no server write); it renders only in the native app (isShakeToReportSupported), never on the website the sweep drives.",
  // LEAD bundle dropdown (b4 1b53b4f42b): the bundle discount's on/off row became one dropdown.
  "src/components/declutter/BundleDiscountCard.tsx": "no text input: one native select whose options are Off and the fixed BUNDLE_PERCENTS list, saved the moment it changes; nothing can be typed.",
  "src/components/declutter/DeclutterListingDefaults.tsx": "no typed text: switches and choices only, saved as the seller's listing defaults.",
  // Message quiet time (Messages audit): the browser's own time picker.
  "src/components/notificationPreferences/QuietTimeInput.tsx": "no text input: one native type=time control, which only ever yields a valid HH:MM or empty.",
  // Live on post (20261030071816): the admin takes a live listing down from a report.
  "src/components/admin/adminReports/WantedReportPanel.tsx": "admin-only (Admin -> Reports, on a Wanted post report); a sweep account is not an admin. Its one text box is length-capped (maxLength 500) and trimmed before it is sent.",
  "src/components/admin/adminReports/DeclutterTakeDown.tsx": "admin-only (Admin -> Reports, on a Declutter listing report) and behind the declutter switch; a sweep account is not an admin. Its one text box is length-capped (maxLength 500) and trimmed before it is sent, and declutter_admin_take_down_item refuses an empty note (review_note_required) and one over 500 characters (review_note_too_long).",
  // Porch days (owner 2026-10-29): the sell screen's porch-only tick.
  "src/components/declutter/SellMeetupSpots.tsx": "Not swept yet (new 11-01, B110; lead 11-01: a GAP until a sweep can add and delete a spot on prod): the name is length-capped (maxLength 80) and trimmed, the address must be picked from the lookup (an exact point), and declutter_save_my_meetup_spot (20261101194608) refuses a name outside 2-80 characters, an address outside 5-200, an area outside 2-60, a point outside Louisiana (invalid_meetup_spot), a time under 30 minutes or with no day (invalid_meetup_times) and an 11th spot (too_many_meetup_spots); behind the declutter switch in Selling settings.",
  "src/components/declutter/SellPorchDays.tsx": "no text input: one checkbox and fixed weekday chips, saved as booleans/weekday numbers through declutter_set_porch_days, which refuses anything else (invalid_porch_days); behind the declutter switch on the sell screen.",
  // jobs-search-inline (owner 2026-10-27): the Posted / Working search that opens in place.
  "src/components/sections/InlineListSearch.tsx": "writes nothing: its one text box filters the tab's own already-loaded list (useActivityFilters' searchQuery, mirrored to ?q= by URLSearchParams) and is never sent to the server; X and Escape clear it (src/test/jobsSearchOpensInPlace.test.tsx)",
  // Q2419 (the Free section, 20261027170717): the free cart's pickup choice.
  "src/components/declutter/DeclutterFreeClaim.tsx": "its only field is a radio choice (porch pickup or the giver's door), no typed text; it shows only for a cart whose items are all free, and declutter_checkout_free refuses any other handover ('handover_unavailable') and porch where an item does not allow it (src/test/pglite/declutterFreeSection.pglite.mjs)",
  // Q2333 (seller delivery, 20261027153244, switch declutter_seller_delivery at testers): no sweep fixture has a seller with delivery on.
  "src/components/declutter/SellerDeliveryChoice.tsx": "shows only in a cart whose seller turned seller delivery on (switch declutter_seller_delivery, testers), which no sweep fixture seller has; its one text box is the drop-off address (maxLength 300, trimmed, 5+ characters before the button enables), sent only to the server's quote, which geocodes it and answers a fixed set of reasons (src/test/pglite/declutterSellerDelivery.pglite.mjs)",
  "src/components/declutter/SellerDeliveryOrder.tsx": "shows only on an order the seller delivers (switch declutter_seller_delivery, testers), which no sweep fixture has; its one field is a photo file input, no typed text",
  "src/components/admin/settings/DonationPartnersCard.tsx": "admin-only (Admin -> Settings) and shows only with the declutter switch on; a sweep account is not an admin. Its inputs are length-capped (maxLength) and the server refuses anything else (admin_declutter_save_donation_partner: donation_partner_invalid; 20261027222743, Q2428)",
  "src/components/declutter/DeclutterDonate.tsx": "shows only on the haul-away card (switch declutter_haul_away, testers) with a partner charity near unsold items; no sweep account has listings. Its only input is a radio choice among server rows (declutter_choose_donation refuses anything else; Q2428)",
  "src/components/declutter/SellerDeliverySettings.tsx": "shows only to a seller with the declutter_seller_delivery switch on (testers), which no sweep account has set up; its boxes are whole-dollar numbers (inputMode numeric) and a date, saved only through declutter_set_seller_delivery / declutter_set_delivery_schedule, which refuse anything outside the rules (src/test/pglite/declutterSellerDelivery.pglite.mjs)",
  // Owner 2026-10-25: a friend's referral code within 7 days of joining (Referrals tab).
  "src/components/referral/EnterReferralCodeCard.tsx": "shows only in an account's first 7 days, and the shared test accounts are older, so a sweep finds no field; its one text box is upper-cased and trimmed as typed, sent only through claim_my_referral_code, which upper-cases, trims and refuses anything over 32 characters ('invalid') and answers a fixed word set the card maps to copy (src/test/pglite/claimReferralCode.pglite.mjs)",
  // Lead 2026-10-25 (scanner-safe confirm links): the expired-link panel's email box.
  "src/pages/auth/signupPending/ConfirmLinkPanel.tsx": "shows only signed out, on a confirm link that has expired or was spent (/signup-pending with a dead token), and this sweep signs in; its one text box is an email address handed to the same resend SignupPending uses (supabase.auth.resend, which validates the address server-side and is rate-limited), trimmed and never stored by the app",
  // Builder 1j (2026-10-21, board 191): the admin funnel's filters.
  "src/components/admin/adminAnalytics/SectionFunnel.tsx": "no typed text: two fixed-option selects (7/30/90 days; a parish from the RPC's own list) and two section pills; it writes nothing (an admin-only read whose server refuses any other window)",
  "src/components/admin/adminAnalytics/SignupSources.tsx": "no typed text: one fixed-option select (7/30/90 days); it writes nothing (an admin-only read, admin_signup_source_report clamps the window to 1-365 days)",
  // Builder 1h (2026-10-21, board 91, Q2275): saved searches.
  "src/components/savedSearches/SaveSearchSheet.tsx": "no typed text: the sheet saves the search already on screen (its name is built from it, capped at 60) with one email switch and optional section chips; the write is the member's own saved_searches row (RLS) and the 10-search cap is the server's",
  "src/pages/profile/SavedSearchesTab.tsx": "no typed text: switches (alerts, email, pause all) and Delete on the member's own rows; nothing a member types reaches it",
  // Builder 2f (2026-10-21, boards 22/170): the applicant compare tick.
  "src/pages/posts/postedJobs/applicantsPanel/ApplicantCompare.tsx": "one checkbox per applicant card ('Compare', at most three); no typed text, and it writes nothing (local state that opens a side-by-side sheet)",
  // Landing redesign (2026-10-20): the hero search.
  "src/components/landing/HeroSection.tsx": "signed-out only (the landing sends a signed-in visitor to /home, and this sweep signs in); the search writes nothing: it navigates to /browse?q= or /jobs?q= with the text whitespace-collapsed, trimmed and capped at 80 characters, URL-encoded by URLSearchParams (src/components/landing/heroSearch.ts, pinned by src/test/landingRedesign.test.tsx)",
  // Builder 3 (2026-10-20, boards 25/39): the Declutter Browse filter panel (phone sheet + desktop column).
  "src/components/declutter/DeclutterOfferRules.tsx": "no text input: two on/off switches (Accept offers, Answer offers for me) sent as booleans to declutter_set_offer_rules, which refuses a null with invalid_offer_rules, plus a Use button that saves Claude's suggested whole-cent lowest price; nothing the seller types reaches the server here",
  "src/components/declutter/DeclutterFilterPanel.tsx": "behind the 'declutter' switch (testers only); its only text inputs are the two whole-dollar price bounds, which strip every non-digit and cap at 5 digits (DollarBox) and only filter rows already loaded, never sent to the server; the declutter-search sweep types in the search row but does not open the filter sheet, so a FORMS sweep of the panel is owed",
  // Q1929 (2026-10-21): the Declutter buyer's "Raise the pay" amount.
  "src/components/declutter/DeclutterNoShowAnswer.tsx": "shows only to a seller inside the 24 hours after a buyer's no-show report on a paid Declutter order (journeys never pay on live Stripe), so a sweep cannot reach it; its one textarea is capped at 1000 by the input and the server, and the note is trimmed. Proven in src/test/pglite/declutterHandoverBothConfirm.pglite.mjs.",
  "src/components/declutter/DeclutterProblemSides.tsx": "shows only on a Declutter order with an OPEN problem, to the side that did not report it (a paid order on live Stripe, which journeys never make); its one text box is 'Your side' (maxLength 1000), and declutter_problem_add_side refuses a blank or over-1000-character note (note_required), more than 3 photos (too_many_problem_photos) and the reporter adding a side (problem_side_is_yours), pinned by declutterProblemBothSides.pglite.mjs; a FORMS sweep is owed once a paid-and-handed-over fixture exists",
  "src/components/declutter/DeclutterRefundReturn.tsx": "shows only inside the refund panel on a full refund the seller agreed (needs a HANDED-OVER paid Declutter sale with a refund request; journeys never pay on live Stripe), behind the testers-only 'declutter_refund_requests' switch; its inputs are the seller's way (a RadioCardList), a day select or a datetime box, camera-only photo inputs, and the buyer's collect address (maxLength 300, trimmed, 5+ characters, geocoded first); declutter_accept_refund_with_return / declutter_set_return_address refuse anything outside the rules (invalid_return_way/day/time, address_required, address_not_found; src/test/pglite/declutterReturns.pglite.mjs)",
  "src/components/declutter/DeclutterRefundRequest.tsx":"needs a HANDED-OVER Declutter sale inside its 24 hours (journeys never pay on live Stripe), behind the testers-only 'declutter_refund_requests' switch; its inputs are a reason radio, a 1-1000 character note (server note_required) and the seller's offer box, which accepts only a dollar amount with up to 2 decimals (offerCentsFromInput) and keeps Send off until then, while the server refuses anything not above $0 and below the item price (invalid_amount, declutterRefundRequests.pglite.mjs); a FORMS sweep is owed once a paid-and-handed-over fixture exists",
  "src/components/declutter/DeliveryRaisePanel.tsx":"needs a PAID Declutter delivery order with no Helpr yet (journeys never pay on live Stripe); its one input is a whole-dollar amount that strips every non-digit and caps at 3 digits, the button stays off outside $5 to the room left, and the server re-checks min $5 / whole dollars / $150 / window in declutter_delivery_raise_start, so a FORMS sweep is owed once a paid delivery fixture exists",
  // You › Settings (board 52, 2026-10-20): switches and rows only, no typed input.
  "src/components/profile/SettingsTab.tsx": "no text input: two-state switches (bigger text, section on/off, refused when it would hide the last section) and navigation rows; nothing a messy string can reach",
  // Shops M3/M4 (2026-10-19, shops-m3): cancels, no-shows and the admin Shops orders screen.
  "src/components/admin/AdminShopsOrders.tsx": "admin-only, needs a charged Shops order (journeys never pay on live Stripe); the note (1-500), refund reason (four values), re_ id and amount are refused by shops_admin_* / shop-checkout admin_record_hand_refund as pinned by src/test/pglite/shopsRefunds.pglite.mjs and src/test/edge/shop-refunds.test.ts",
  "src/components/shops/ShopOrderCancel.tsx": "behind the 'shops' switch (testers only) and needs an accepted, charged order; the shop's cancel reason is contact-leak filtered and capped by shops_shop_cancel_order, the buyer's cancel takes no text, as pinned by src/test/pglite/shopsRefunds.pglite.mjs",
  // Train12 (2026-10-19, lander33): forms new in payout-readiness, Homes Buy/link/photos and Shops SH12.
  "src/components/admin/adminPayoutBatches/HeldForReview.tsx": "admin-only, needs a payout or refund HELD FOR REVIEW (none exist without a real stuck payout; journeys never pay on live Stripe); the note, amount and Stripe id are refused by admin_payout_release / admin_payout_settle_by_hand (invalid_note, invalid_amount, invalid_stripe_ref, ref_already_used, 20261019070737) as pinned by src/test/pglite/payoutWaitsForPayee.pglite.mjs",
  "src/components/admin/settings/HomesListingsCard.tsx": "admin-only; the listings search (bad_query, too_many) and the take-down / lift reason (5-500 characters, reason_required) are refused by rentals_admin_listings / rentals_admin_remove_listing / rentals_admin_lift_takedown as pinned by src/test/pglite/homesPublicLink.pglite.mjs; FORMS sweep owed once a live listing exists",
  "src/components/rentals/listings/editorParts.tsx": "behind the 'rentals' switch (testers only); shared listing-editor fields whose rules rentals_save_listing / rentals_save_sale_listing enforce, pinned by src/test/pglite/homesSaleListings.pglite.mjs; FORMS sweep owed at everyone",
  "src/components/rentals/listings/SaleListingEditor.tsx": "behind the 'rentals' switch (testers only) and needs an ownership-approved property; price, headline and description (sale-word filter) are refused by rentals_save_sale_listing as pinned by src/test/pglite/homesSaleListings.pglite.mjs; FORMS sweep owed at everyone",
  "src/components/notificationPreferences/SmsAlertsCard.tsx": "behind the 'sms_alerts' switch (created off); its one typed field, the mobile number, is read by normalizeUsPhone and refused by set_sms_consent / sms_normalize_phone unless it is a valid 10-digit US number, messy inputs pinned by src/test/smsAlerts.test.ts and src/test/pglite/smsAlerts.pglite.mjs; FORMS sweep owed once on for testers",
  "src/components/shops/ShopFaqsEditor.tsx": "behind the 'shops' switch (testers only); each question 3-140 and answer 1-600 characters, cleaned and contact-leak checked by the shop_faq_clean_and_check trigger (20261019072541) as pinned by src/test/shopFaqs.test.ts; FORMS sweep owed once on for testers",
  // Admin "Helpr at fault" (J4, 2026-10-19): a no-show/backed-out radio and one note, in the admin refund dialog and the dispute card.
  "src/components/admin/helprFault/HelprFaultFields.tsx": "admin-only, needs a paid job with a booked Helpr and a full refund (journeys never pay on live Stripe); the kind is a two-value radio (admin_rule_helpr_fault refuses anything else: invalid_kind) and the note is space-trimmed (btrim) and refused empty or over 1000 characters (note_required; job_helpr_fault_rulings CHECK); FORMS sweep owed with a seeded paid job",
  // Q2205 (2026-10-19): the feed's phone search left /home with the old Home feed.
  "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx": "desktop-only since Q2205 (the /jobs feed strip, >=900px); this sweep runs at 375, where the same filters.setSearchQuery is typed through the tabs row's InlineListSearch (a decided gap: it writes nothing); its field and ✕ are driven at 1440 by search-x-off-center-press and expanding-search-geometry",
  // The section dashboards (2026-10-19): Home's Customize sheet.
  "src/components/sections/CustomizeSheet.tsx": "holds no typed text: one show/hide switch per section and reorder buttons; nothing to type messy input into",
  // Admin "End series" (Q417 (c), 2026-10-17): one reason textarea on a recurring job in the admin job dialog.
  "src/components/admin/adminJobs/EndSeriesSection.tsx": "admin-only, needs a live recurring series; the reason is space-trimmed (btrim) and refused under 10 characters by rpc_admin_end_recurring_series (end_series_needs_reason, pinned by seriesEndByPlatform.pglite.mjs); the button stays off below 10; FORMS sweep owed with a seeded series",
  // Quotes on jobs (2026-10-15): behind the hidden 'quotes' switch, created OFF on prod; the server refuses each field
  // (price CHECK whole dollars 10-1000, note 1-500, when 1-120, contact-leak trigger) as pinned by
  // src/test/pglite/jobQuotes.pglite.mjs. A FORMS sweep is owed once the switch reaches testers.
  "src/components/quotes/QuotePriceStepper.tsx": "the Send a quote price (board 43), behind the 'quotes' switch (testers); the field strips every non-digit and caps at 5 digits, and submit_job_quote enforces the $10-$1,000 whole-dollar range (src/test/pglite/jobQuotes.pglite.mjs); FORMS sweep owed with SendQuotePage's",
  "src/pages/quotes/SendQuotePage.tsx": "behind the 'quotes' switch (off); price/note/when rules pinned by src/test/pglite/jobQuotes.pglite.mjs; FORMS sweep owed once on for testers",
  "src/components/quotes/QuoteAnswerControls.tsx": "behind the 'quotes' switch (off); the counter price/note are checked by respond_to_job_quote and the job_quotes CHECKs (jobQuotes.pglite.mjs); FORMS sweep owed once on for testers",
  "src/pages/quotes/QuoteRequestPage.tsx": "behind the 'quotes' switch (off); the own-price field is checked by switch_quote_request_to_set_price and jobs_budget_range (jobQuotes.pglite.mjs); FORMS sweep owed once on for testers",
  // Declutter slice 5, Helpr delivery (2026-10-16): the checkout drop-off address, the Helpr's vehicle form, the pickup
  // time and the 4-digit code render only behind the 'declutter' switch, for a PAID delivery order (LIVE Stripe: no
  // fixture can pay one) and after 20261017055505 is on prod. The address is checked server-side (5-300 chars with a
  // letter and a digit, then geocoded), the code is 4 digits with a 5-try lock, the slot inside the seller's windows,
  // all pinned by src/test/pglite/declutterDelivery.pglite.mjs. FORMS sweep owed with Q?delivery-visual-pass.
  // My route (2026-10-27): the Picked up / drop-off photo inputs of a stop, the same two steps as the delivery
  // card (useTaskSteps), shown only to the Helpr holding a delivery (behind 'declutter', a PAID order on LIVE Stripe).
  // Go online for deliveries (Q2440, 2026-10-27): two fixed <select>s (2/4/8 hours, 5/10/15/25 miles) and a switch; no free text.
  "src/components/declutter/GoOnlineCard.tsx": "behind the 'declutter' switch on Deliver for pay; its only inputs are two fixed <select> lists and a switch (no free text), and the server re-checks 1-12 hours, 1-50 miles and the location (helpr_go_online, src/test/pglite/helprGoOnline.pglite.mjs); FORMS sweep owed with Q?delivery-visual-pass",
  "src/components/declutter/StopActions.tsx": "behind the 'declutter' switch, only to the Helpr holding a paid delivery (LIVE Stripe: no fixture can pay one); its only inputs are photo files, cleaned and type-checked by cleanListingPhoto, and the server checks the path and the 200 m point (helpr_task_picked_up / helpr_task_delivered); FORMS sweep owed with Q?delivery-visual-pass",
  // Q2430 (2026-10-27): one on/off switch on the seller's own listing; no text.
  "src/components/declutter/AutoFreeRow.tsx": "behind the 'declutter' switch, in the seller's own Manage listing; its only input is an on/off switch (no text), and the server checks owner, status and not-already-free (declutter_set_auto_free, src/test/pglite/declutterAutoFree.pglite.mjs)",
  // Owner 2026-10-29 (keep it up until it sells): one on/off switch on the seller's own listing; no text.
  "src/components/declutter/KeepUpRow.tsx": "behind the 'declutter' switch, in the seller's own Manage listing and the sell flow's last step; its only input is an on/off switch (no text), and the server checks the item is the seller's own (declutter_set_keep_up, 20261029154323)",
  // Owner 2026-10-29 (sell a bunch, /declutter/sell?mode=bunch): FORMS sweep owed; no sweep visits ?mode=bunch yet.
  "src/components/declutter/DeclutterBunchView.tsx": "behind the 'declutter' switch at /declutter/sell?mode=bunch, which no FORMS sweep visits yet; its two text boxes are the area (maxLength 80, refused if it reads like a street address) and the pickup address (maxLength 300, geocoded before anything is saved), and the server's CHECKs refuse an area outside 2-80 characters and an address outside 5-300 (declutter_items / declutter_item_private); its photo input is image files only, cleaned by cleanListingPhoto before upload. FORMS sweep owed",
  "src/components/declutter/BunchChoices.tsx": "part of the bunch card list on /declutter/sell?mode=bunch, shown only after the photo tool has sorted real photos (a live declutter-ai-draft call), so no sweep reaches it; it has no free-text box, only two switches",
  "src/components/declutter/DeclutterBunchListStep.tsx": "the last step of Sell a bunch on /declutter/sell?mode=bunch, reached only after the photo tool has sorted real photos (a live declutter-ai-draft call), so no sweep reaches it; it has no free-text box of its own: switches, the handover choices, the tax tick and the shared pickup-times editor (DeclutterPickupTimes, swept with the sell screen), whose windows pickupWindowsProblem checks before List enables",
  "src/components/declutter/BunchDraftsSection.tsx": "shows only for a seller who has saved drafts, on /declutter/sell?mode=bunch; no sweep account keeps drafts; it has no free-text box, only the four confirmation ticks and the list button",
  "src/components/declutter/DeclutterBunchRow.tsx": "shows only after the photo tool has sorted real photos into items on /declutter/sell?mode=bunch (a live declutter-ai-draft call), so no sweep reaches it; its one box is the item's price, held to $1 to $1,000 by bunchItemProblem before listing and by declutter_create_item on the server",
  "src/components/declutter/DeclutterBunchBulk.tsx": "shows only with two or more sorted items on /declutter/sell?mode=bunch (a live declutter-ai-draft call), so no sweep reaches it; its boxes are a price and a percent, checked before Apply and held to the same item rules before listing",
  "src/components/declutter/DeclutterBunchPhotos.tsx": "shows only after the photo tool has sorted real photos into items on /declutter/sell?mode=bunch (a live declutter-ai-draft call), so no sweep reaches it; a file picker for photos, each cleaned before it joins the item, with no free text",
  "src/components/declutter/DeclutterBunchMovingSale.tsx": "behind the 'declutter' AND 'declutter_moving_out' switches at /declutter/sell?mode=moving, which no FORMS sweep visits yet; its only own input is the move-out date, checked by moveDateProblem and by declutter_move_out_date_problem on the server",
  "src/components/declutter/DeclutterBunchCard.tsx": "shows only after the photo tool has sorted real photos into items on /declutter/sell?mode=bunch (a live declutter-ai-draft call), so no sweep reaches a card; its boxes are the title (maxLength 80), the price and the description (maxLength 2000), and an item lists only when bunchItemProblem passes (name of 3+ characters, price $1 to $1,000) and then only through declutter_create_item, the same server path as the swept single-item form (declutter-sell)",
  // D-NEW14 porch places (2026-10-30). No sweep yet: the sweep never presses Save, and these boxes open only after Add a pickup place; the picker needs a cart with a seller who has places.
  "src/components/declutter/SellPorchPlaces.tsx": "behind the 'declutter' switch, on the sell form and Declutter settings, inside Add a pickup place; its boxes are the name (maxLength 40), address (maxLength 300) and area (maxLength 80); the server re-checks every field (declutter_save_porch_place, src/test/pglite/declutterPorchPlaces.pglite.mjs); FORMS sweep owed",
  "src/components/declutter/DeclutterPorchPlaces.tsx": "behind the 'declutter' switch, in a cart whose seller has saved places; its only input is a radio list of the seller's places (no free text), and the server re-checks the place is the seller's (declutter_set_porch_place, src/test/pglite/declutterPorchPlaces.pglite.mjs)",
  // Audit DD D1 (2026-10-30): the vehicle form moved out of DeclutterDeliveryViews.tsx unchanged (three checkboxes and a photo).
  "src/components/declutter/DeliverVehicleForm.tsx": "behind the 'declutter' switch on Deliver; three checkboxes and a truck photo, no free text; the server re-checks the answer (helpr_set_vehicle, src/test/pglite/helprVehicleMatch.pglite.mjs); FORMS sweep owed with Q?delivery-visual-pass",
  "src/components/declutter/DeclutterDeliveryViews.tsx": "behind the 'declutter' switch, for a paid delivery order only (LIVE Stripe); address / code / slot rules pinned by declutterDelivery.pglite.mjs; FORMS sweep owed with Q?delivery-visual-pass",
  // Shops slice 1 (2026-10-15): behind the hidden 'shops' switch, created OFF on prod; the server refuses each field
  // (name 2-60, about <= 2000, area 2-80 and not a street address, fixed category list, parishes, SoS number format,
  // contact-leak trigger on name/about/area) as pinned by src/test/pglite/shopsProfiles.pglite.mjs. A FORMS sweep is owed
  // once the switch reaches testers.
  "src/components/shops/ShopPickupAddressSection.tsx": "behind the 'shops' switch (testers only); field rules pinned by src/test/pglite/shopsPickupAddress.pglite.mjs (length, Louisiana ZIP, blank line 2) and src/components/shops/shopPickupAddressScreens.test.tsx; FORMS sweep owed once on for testers",
  "src/components/shops/ShopEditView.tsx": "behind the 'shops' switch (off); field rules pinned by src/test/pglite/shopsProfiles.pglite.mjs; FORMS sweep owed once on for testers",
  // Shops slice 2 (2026-10-16): items, behind the same switch (off). The server refuses each field (fixed kind/type
  // list, title 3-80, description <= 2000, price $1-$1,000, lead time 0-60, stock 0-9999, daily limit 1-200,
  // contact-leak trigger on title/description) as pinned by src/test/pglite/shopsItems.pglite.mjs.
  "src/components/shops/ShopItemEditor.tsx": "behind the 'shops' switch (off); field rules pinned by src/test/pglite/shopsItems.pglite.mjs; FORMS sweep owed once on for testers",
  "src/components/shops/ShopDailyCap.tsx": "behind the 'shops' switch (off); the daily order limit (1-200) is pinned by src/test/pglite/shopsItems.pglite.mjs; FORMS sweep owed once on for testers",
  "src/components/shops/ShopOrderSheet.tsx": "behind the 'shops' switch (off); the order lines, quantities, dates and the note's contact-leak filter are pinned by src/test/pglite/shopsOrders.pglite.mjs (shops_request_order); FORMS sweep owed once on for testers",
  "src/components/shops/ShopHandoverActions.tsx": "behind the 'shops' switch (testers); the \"I didn't get it\" note (1-500 characters, contact-leak filter) is pinned by src/test/pglite/shopsHandoverPayout.pglite.mjs (shops_report_not_received); FORMS sweep owed once on for testers (Q2154)",
  "src/components/shops/ShopDashboardView.tsx": "behind the 'shops' switch (off); the decline reason is checked by shops_decline_order (invalid_reason over 200 characters, 20261018164442; not yet in a PGlite proof); FORMS sweep owed once on for testers",
  "src/components/admin/settings/ShopItemsReviewCard.tsx": "admin-only, behind the 'shops' switch (off); the reject reason (required, <= 500) is pinned by src/test/pglite/shopsItems.pglite.mjs; FORMS sweep owed once on for testers",
  // Suggest a category (2026-10-15, trades): behind the hidden 'suggest_category' switch (testers only on prod); the
  // text rules (2-40 chars, letters, contact-leak scan, 5 per 24h, ban gate, unconfirmed-email gate) are pinned by
  // src/test/categorySuggestions.test.tsx and the migration 20261015051141. A FORMS sweep is owed once the switch is past testers.
  "src/components/SuggestCategory.tsx": "behind the 'suggest_category' switch (testers only); text rules pinned by categorySuggestions.test.tsx and 20261015051141; FORMS sweep owed past testers",
  "src/components/admin/settings/CategorySuggestionsCard.tsx": "admin-only, behind the 'suggest_category' switch; the decline note is length-capped server-side (20261015051141); FORMS sweep owed past testers",
  // Declutter slice 4 (2026-10-15): the paid-order cards and the admin problems card render only behind the OFF
  // 'declutter' switch AND only for a PAID Declutter order (LIVE Stripe: no fixture can pay one). Every field is
  // length-capped client-side and validated server-side (slot inside the seller's windows, 4-digit code with 5-try
  // lock, porch photo path + 200 m, problem reason/note 1-1000, review stars 1-5 + contact-leak scan, admin
  // decision/fault/strike), pinned by src/test/pglite/declutterSlice4.pglite.mjs. FORMS sweep owed at testers.
  // Declutter slice 3/3b (2026-10-14): the offer, buy-now and cart screens (DeclutterTradeViews) are behind the same
  // OFF switch; offer amounts, floor/price bounds and the one-open-offer rule are pinned by declutterSlice3.pglite.mjs.
  "src/components/declutter/DeclutterTradeViews.tsx": "behind the OFF 'declutter' switch (404 on prod); offer/buy-now rules pinned by declutterSlice3.pglite.mjs; FORMS sweep owed at testers",
  // The offer form moved out of DeclutterTradeViews into DeclutterOfferPanel (reds-1019-18, a pure move); same switch, same pins.
  "src/components/declutter/DeclutterOfferPanel.tsx": "behind the OFF 'declutter' switch (404 on prod); offer/buy-now rules pinned by declutterSlice3.pglite.mjs; FORMS sweep owed at testers",
  // The offers list and its counter field moved out of DeclutterTradeViews into DeclutterOffersSection (L20 6025a35300, a pure move); same switch, same pins.
  "src/components/declutter/DeclutterOffersSection.tsx": "behind the OFF 'declutter' switch (404 on prod); offer/buy-now rules pinned by declutterSlice3.pglite.mjs; FORMS sweep owed at testers",
  // Declutter wanted posts (2026-10-16): behind the 'declutter' AND 'declutter_wanted' switches; the post form's
  // text (3-60 ASCII, no link or phone, contact-leak scan), whole-dollar price, radius and caps are pinned by
  // src/test/pglite/declutterWantedPriceHint.pglite.mjs and src/lib/declutter/wanted.test.ts. FORMS sweep owed at testers.
  "src/components/declutter/DeclutterWantedViews.tsx": "behind the 'declutter' + 'declutter_wanted' switches; text, price, radius and caps pinned by declutterWantedPriceHint.pglite.mjs and wanted.test.ts; FORMS sweep owed at testers",
  "src/components/declutter/DeclutterPickupWindows.tsx": "the seller's pickup-time chips (#2/#58 and the Helpr picker, 2026-10-28): chips only, no free text; its fallback is the shared DateTimeField; behind the OFF 'declutter' switch and a PAID order",
  "src/components/declutter/DeclutterFoldedTime.tsx": "the porch card's folded time pickers (#32, 2026-10-28), split out of DeclutterHandoverViews: same gap, behind the OFF 'declutter' switch and a PAID order",
  "src/components/declutter/DeclutterHandoverTalk.tsx": "the handover chat (Q2462, 2026-10-28): behind the OFF 'declutter' switch and only between a buyer and seller with an item waiting in the cart whose ways leave out every sure one; its one field is the message, capped at 1,000 by the box and server-side (declutter_send_handover_message: invalid_message, the contact-leak trigger, 30 an hour), pinned by declutterHandoverChoices.pglite.mjs; FORMS sweep owed at testers",
  "src/components/declutter/DeliveryTalk.tsx": "the delivery chat (BUY-36, 2026-10-31): only between the Helpr, buyer and seller of a PAID Helpr delivery the Helpr has taken, and Stripe is live (no test order can be paid on prod), so no sweep can reach it; its one field is the message, capped at 1,000 by the box and server-side (helpr_task_send_message: invalid_message, the body CHECK, the contact-leak trigger, 30 an hour), pinned by helprDeliveryCantFinish.pglite.mjs section 10",
  "src/components/declutter/DeliveryCantFinish.tsx": "a Helpr delivery the Helpr can't finish (BUY-36, 2026-10-31): only on a PAID delivery a Helpr has picked up, and Stripe is live (no test order can be paid on prod), so no sweep can reach it; its fields are the reason, a note (1,000, stuck_note CHECK), the buyer's one corrected address (the shared address lookup, 25 miles: fix_too_far) and the where-and-when to collect (note_required), each refused server-side and pinned by helprDeliveryCantFinish.pglite.mjs",
  "src/components/declutter/DeclutterOrderTalk.tsx": "the paid-order chat (D2-1, 2026-10-30): only between the buyer and seller of a PAID Declutter order, and Stripe is live (no test order can be paid on prod), so no sweep can reach it; its one field is the message, capped at 1,000 by the box and server-side (declutter_send_order_message: invalid_message, the body CHECK, the contact-leak trigger, 30 an hour), pinned by declutterOrderTalk.pglite.mjs",
  "src/components/declutter/DeclutterEditListing.tsx": "Edit listing in Manage (audit 1028 D1-1): a live listing's title (maxLength 80), description (2000), category, condition and size selects, the ways ticks and the tax box, behind the OFF 'declutter' switch; the title length, the ways and the four confirmations are refused server-side by declutter_edit_listing and the table's own checks (declutterHandoverChoices.pglite.mjs T11); FORMS sweep owed at testers",
  "src/components/declutter/SellHandoverChoices.tsx": "step 4's ticks for the ways buyers get it (owner 2026-10-28), split out of DeclutterSellView: same gap, behind the OFF 'declutter' switch; at least one tick and the free-item rule pinned server-side in declutter_set_handovers (declutterHandoverChoices.pglite.mjs); FORMS sweep owed at testers",
  "src/components/declutter/DeclutterHandoverViews.tsx": "behind the OFF 'declutter' switch and a PAID order (live Stripe); server rules pinned by declutterSlice4.pglite.mjs; FORMS sweep owed at testers",
  "src/components/declutter/paidOrders.ts": "the paid-order helpers and their pickup-time input, split out of DeclutterHandoverViews (L20 6025a35300, a pure move): same gap, behind the OFF 'declutter' switch and a PAID order (live Stripe)",
  "src/components/declutter/DeclutterProblemForm.tsx": "the Report a problem form, split out of DeclutterHandoverViews (b74 d8a09b7f87, a move to keep it under 600 lines): same gap, behind a PAID order (live Stripe); reason and note checked server-side in declutter_report_problem (declutterSlice4.pglite.mjs); FORMS sweep owed at testers",
  "src/components/declutter/DeclutterProblemPhotos.tsx": "audit 1b D2-7: the problem/refund forms' photo picker (no text; images only, at most 3), split out of DeclutterHandoverViews: same gap, behind a HANDED-OVER order (live Stripe) and hidden until the server takes the photos (problemPhotosWaitForServer.test.ts); paths and count checked server-side in declutter_report_problem; FORMS sweep owed at testers",
  "src/components/declutter/DeclutterWantedReplies.tsx": "behind the 'declutter' + 'declutter_wanted' switches and only with a public Wanted post near you; its one text field is the reply price, capped client-side and server-side at the lower of the Wanted max and the listing's price (declutter_wanted_reply; b3c-wanted-replies PGlite proof); FORMS sweep owed at testers",
  "src/components/declutter/DeclutterMovingSaleDetails.tsx": "behind the 'declutter' AND 'declutter_moving_out' switches, shown only once the seller has a moving sale; name 3-60 letters + contact-leak filter and the start-date window pinned server-side in declutter_set_moving_sale (b3c-moving-sale-name PGlite proof); FORMS sweep owed at testers",
  "src/components/declutter/DeclutterHandoverSheets.tsx": "behind the 'declutter' switch and a PAID porch order (live Stripe, none on the test accounts); its one text field is the optional porch note, capped at 200 letters by the input and server-side in declutter_porch_note (b3c-porch-note PGlite proof); FORMS sweep owed at testers",
  "src/components/declutter/DeclutterNoHelpr.tsx": "soldstates-5 (b83): the Helpr's answer to a seller's \"The Helpr didn't come\", shown only on a booked Helpr delivery a seller reported (a PAID order, live Stripe, none on the test accounts); its one text field is the answer, 1-1000 letters by the input and server-side in declutter_helpr_answer_no_show (helprDeliverySellerReportsNoShow.pglite.mjs); FORMS sweep owed at testers",
  "src/components/declutter/DeclutterReviewForm.tsx": "behind the 'declutter' switch and a HANDED-OVER order (live Stripe, none on the test accounts); stars 1-5, 1000-letter cap and the contact-leak refusal pinned server-side in declutter_leave_review (declutterSlice4.pglite.mjs); FORMS sweep owed at testers",
  "src/components/admin/settings/DeclutterProblemsCard.tsx": "admin-only, behind the OFF 'declutter' switch, needs an open problem on a PAID order; decide rules pinned by declutterSlice4.pglite.mjs; FORMS sweep owed at testers",
  // Rentals S1 (2026-10-15): every Rentals form renders the 404 until the hidden 'rentals' switch is on for the member,
  // and the switch is created OFF (20261017205605), so no URL sweep can reach them yet. Their server-side input rules
  // live in that migration: property name 2-60, street 5-200, city 2-80, ZIP exactly 5 digits, unit label 1-40 (CHECKs);
  // request description 10-2000, access windows <= 300 and notes <= 500, <= 10 photos, contact-leak scan; decline
  // reason required ('other' needs >= 5 chars, <= 500, contact scan); "Was it fixed?" note <= 500 with contact scan;
  // auto-approve limit $1-$10,000; admin rejection needs a >= 5-char reason. src/test/pglite/rentalsMaintenance.pglite.mjs
  // proves the contact-leak refusal, both reason_required paths, bad_limit and the admin reason (97 PASS, 0/97 with the
  // migration skipped). A FORMS sweep is OWED once the switch is on for testers (the Rentals S1 visual item in docs/OPEN.md).
  "src/components/rentals/RentalsHomeView.tsx": "behind the OFF 'rentals' switch (404 on prod); property/unit/limit rules are CHECKs and RAISEs in 20261017205605, bad_limit pinned by rentalsMaintenance.pglite.mjs; FORMS sweep owed at testers",
  "src/components/rentals/MaintenanceRequestForm.tsx": "behind the OFF 'rentals' switch (404 on prod); description/access lengths and the contact-leak scan in rentals_file_request (20261017205605), contact refusal pinned by rentalsMaintenance.pglite.mjs; FORMS sweep owed at testers",
  "src/components/rentals/MaintenanceRequestView.tsx": "behind the OFF 'rentals' switch (404 on prod); decline reason and fixed-note rules in 20261017205605, reason_required pinned by rentalsMaintenance.pglite.mjs; FORMS sweep owed at testers",
  "src/components/rentals/RentalVisitHelpr.tsx": "behind the OFF 'rentals' switch (404 on prod); the one datetime-local field is bounded server-side in rentals_propose_visit (20261017221621: NULL, past or > 90 days out RAISEs visit_time_invalid), the past case pinned by rentalsMaintenance.pglite.mjs; FORMS sweep owed at testers",
  // Homes listings (2026-10-18, 20261019043000): behind the same switch; every field is bounded server-side
  // (CHECKs + rentals_save_listing refuses unknown keys and maps bad values to bad_listing), pinned by
  // src/test/pglite/rentalsListings.pglite.mjs. A FORMS sweep is owed with the Rentals one once testers can reach it.
  "src/components/rentals/listings/ListingEditor.tsx": "behind the 'rentals' switch (testers only); headline 5-80, description <= 4000, rent $50-$50,000, beds/baths in halves, lease 1-36 months min<=max, fixed lists, all CHECKs in 20261019043000 mapped to bad_listing, pinned by rentalsListings.pglite.mjs; FORMS sweep owed at testers",
  "src/components/rentals/LandlordIdReview.tsx": "behind the 'rentals' switch (testers only); file pickers only (ID front/back, ownership proof) with no typed field, so messy text does not apply; the upload rules (type, size, own folder) are RAISEs in rentals_submit_landlord_id / rentals_submit_ownership_proof, pinned by landlordIdReview.pglite.mjs and uploadMimeParity; FORMS sweep owed at testers",
  "src/components/rentals/listings/RentBrowse.tsx": "behind the 'rentals' switch (testers only); the search box, bedrooms and max rent only filter a read (rentals_browse_listings, 20261019043000), nothing is written; FORMS sweep owed at testers",
  "src/components/admin/settings/RentalsOwnershipCard.tsx": "admin-only and behind the OFF 'rentals' switch; a rejection needs a >= 5-char note (rentals_admin_review_property), pinned by rentalsMaintenance.pglite.mjs; FORMS sweep owed at testers",
  // Homes rent/deposit (2026-10-19; buy/link/photos are listed above): behind the 'rentals' switch (testers only); every rule is a CHECK or RAISE, pinned by PGlite.
  "src/components/rentals/RentPanel.tsx": "behind the 'rentals' switch (testers only); amounts, dates (no future, Louisiana date), methods and reasons are RAISEs in 20261019073106 (bad_rent_plan, bad_rent_payment, reason_required), pinned by homesRentTracker.pglite.mjs; FORMS sweep owed at testers",
  "src/components/rentals/DepositPanel.tsx": "behind the 'rentals' switch (testers only); amount, dates, the forwarding address and each kept amount's reason are RAISEs in 20261019082216 (bad_deposit, bad_address, bad_settlement), pinned by homesDepositTracker.pglite.mjs; FORMS sweep owed at testers",
  "src/components/rentals/LeasePanel.tsx": "behind the 'rentals' switch (testers only); every blank is printable ASCII text <= 4000 or yes/no (rentals_lease_save, bad_lease_fields), every required blank is checked before sending (rentals_lease_missing, lease_incomplete), names and notes are RAISEs, pinned by homesLease.pglite.mjs; FORMS sweep owed at testers",
  // Q1254 (2026-10-07): the ask dialog opens only on a BOOKED, funded job's card; the test accounts have none
  // (LIVE Stripe forbids funding a fixture), and its four fields are length-capped on the client and validated
  // by request_job_detail_change (blank, length, contact scan, map point) — pinned by src/test/pglite/jobDetailChange.pglite.mjs.
  // Scanner false positives: the regex matched a string/comment, not a rendered control.
  "src/lib/sentry.ts": "false positive — '<input' in a PII-scrubbing comment/regex, no control",
  "src/lib/nativeCamera.ts": "false positive — creates a hidden file <input> for the camera fallback; file inputs take no typed text",
  "src/lib/offerResponseWindow.ts": "false positive — option list for a Select, rendered by DirectOfferBanner",
  "src/components/admin/marketing/marketingTypes.ts": "false positive — type/constant module",
  "src/components/notificationPreferences/constants.tsx": "false positive — constants module",
  "src/components/job-card/JobCardMetaRow.tsx": "false positive — displays a date, no control",
  "src/components/dashboard/JobCard.tsx": "false positive — displays a date, no control",
  "src/hooks/useComboboxKeyboard.ts": "false positive — a keyboard hook; the scanner matched `<input type=\"search\">` in a comment, it renders nothing",
  "src/components/postjob/CheckoutStep.tsx": "checkboxes only (save-card, confirm-details) — the 'input×1' is a comment naming the raw `<input type=\"checkbox\">` it replaced; no typed text",
  "src/components/DisputeTimelineDialog.tsx": "file input only (evidence upload) — no typed text",
  "src/components/series/SeriesDatesPanel.tsx": "checkboxes only (visit dates to pick up or give up, Q407 5/6) — no typed text",
  "src/components/guarantee/HelprGuaranteePanel.tsx": "Helpr Guarantee (owner 2026-10-27): shown only on a COMPLETED job with its payout waiting (payout_pending, a paid live Stripe checkout, none on the test accounts), within 48 h of done; the note (15 to 1000 letters), the photos (own uploads, at most 6) and the fix day (today to 3 days out) are checked server-side in rpc_guarantee_open / rpc_guarantee_helpr_answer / rpc_guarantee_poster_answer, helprGuarantee.pglite.mjs; FORMS sweep owed once a test job can be funded",
  "src/components/declutter/DeclutterMeetup.tsx": "Q2425 safe meetup spots: one radio list of admin-curated spots (no free text) shown only at checkout of a cart with a spot within 25 miles; no spot is seeded, so none exists on prod until an admin adds one; the choice is checked server-side (declutter_set_meetup_spot, declutterSafeMeetup.pglite.mjs M2); FORMS sweep owed once a spot exists",
  "src/components/admin/settings/MeetupSpotsCard.tsx": "Q2425 admin-only card (AdminRoute); parish/name/address/latitude/longitude/type/note are checked server-side in admin_declutter_save_meetup_spot (lengths, Louisiana bounds, type), declutterSafeMeetup.pglite.mjs M1; the admin sweep runs as the test admin, FORMS sweep owed once the card is on prod",
  "src/components/refund/RefundRequestDialog.tsx": "board 141, behind the 'refund_requests' switch and a hired job whose money is HELD in escrow (a paid live Stripe checkout, none on the test accounts); the amount and the reason are checked server-side in rpc_open_refund_request (at least $1, below the job's own price; 15 to 1000 letters), refundRequests.pglite.mjs O4-O6; FORMS sweep owed once a test job can be funded",
  "src/components/refund/RefundAnswerDialog.tsx": "board 141, behind the 'refund_requests' switch and an open refund request on an escrow-funded job (a paid live Stripe checkout, none on the test accounts); only a radio choice plus, for Come back and finish, a native date and time picker that request_job_schedule_change checks (no typed text)",
  "src/components/admin/SupportReply.tsx": "admin-only support reply composer (one textarea); a submit emails a real member, so no sweep may send one. admin-support-reply trims the text, refuses an empty one and caps it at 4000 chars (MAX_REPLY_CHARS, same as the support_replies_body_length CHECK)",
  "src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx":"Q2366: two choice buttons plus a native date picker and time picker (type=date / type=time) for a suggested time, no typed text; apply_to_job_with_time refuses a past, >90-day or same-as-the-job suggestion",
  "src/components/schedule/ScheduleChangeControl.tsx": "a native date picker and time picker only (type=date / type=time, Q407 8), on a BOOKED one-time job the explore does not create — no typed text; the RPC refuses a past or unchanged date/time",
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
  // A3-I5 (owner 2026-10-29): DeleteAccountDialog's "is it really you?" step, rendered only inside that dialog.
  "src/components/profile/DeleteAccountReauth.tsx":
    "rendered only inside DeleteAccountDialog, which only a control NEVER_PRESS refuses (/delete (my )?account/) opens; its password box goes only to Supabase sign-in, and its code box (maxLength 10) only to the emailed-code check, both answered by the server",
  // Non-text controls: no typed value to be messy. Checked by press-every-control (npm run audit:press).
  "src/components/dashboard/FilterSheet.tsx": "switch only — no typed input",
  "src/components/dashboard/filterSheet/FilterSheetRows.tsx": "switch only — no typed input (the Show-only rows extracted from FilterSheet.tsx, Q184)",
  "src/components/admin/AdminNotifications.tsx": "switches only",
  "src/components/admin/adminPayoutBatches/BatchRow.tsx": "checkbox only",
  "src/components/admin/AdminFraudDashboard.tsx": "select only",
  "src/components/admin/userDetail/JobsTab.tsx": "select only",
  "src/components/HelperAvailability.tsx": "switches only",
  "src/components/profile/AvailabilityTab.tsx": "switch only",
  "src/components/postjob/SellForMeBlanks.tsx": "POST-H15: its one box (max 40, line breaks dropped) only writes a line of the job description (fillSellForMeBlank, sellForMeBlanks.test.tsx), which the post-job sweep's DescriptionField covers; it sends nothing itself",
  "src/components/postjob/JobCategoryGroups.tsx": "category search only: filters the chips in the browser; the text is never stored or sent (board 23)",
  "src/components/postjob/detailsSection/PhotoProofToggle.tsx": "switch only",
  "src/components/TimePickerWheel.tsx": "wheel picker — constrained options",
  "src/components/DatePickerField.tsx": "calendar/wheel picker — its only typed text is TypedDateInput (below), inside the wheel",
  "src/components/TypedDateInput.tsx": "typed DOB box inside the DateWheelPicker popover, digits only (non-digits stripped) — parse + both bounds asserted in DateWheelPicker.typed.test.tsx",
  "src/components/profile/ScheduleTab.tsx": "calendar only",
  "src/pages/profile/HomeHistory.tsx": "date picker only",
  "src/pages/profile/WorkRecord.tsx": "date picker only",
  "src/components/admin/adminJobs/JobDetailDialog.tsx": "calendar display only",
  "src/components/EarningsExport.tsx": "selects + date pickers, constrained",
  "src/pages/post-job/DirectOfferBanner.tsx": "select only",
  "src/components/TimeRangeField.tsx": "time input, constrained by the browser",
  "src/components/profile/AvatarCropDialog.tsx": "file input / zoom slider — no typed text",
  "src/components/dashboard/filterSheet/PayRangeSlider.tsx": "two range inputs (0-300, step 5), clamped in the browser and in onChange — no typed text",
  "src/components/PhotoProof.tsx": "file input only",
  "src/components/postjob/detailsSection/PhotoUpload.tsx": "file inputs only",
  "src/components/postjob/detailsSection/PhotoReorderGrid.tsx": "file input only (PhotoUpload's drag-to-reorder grid, Q1299)",
  "src/components/postjob/detailsSection/VideoScope.tsx": "file input only",
  "src/components/profile/profileEditForm/RecentWorkSection.tsx": "file input only",
  "src/components/NotificationPreferences.tsx": "switches only",
  "src/components/notificationPreferences/SwitchSlot.tsx": "switches only (the Notifications screen's switch cell, moved out of NotificationPreferences.tsx)",
  "src/components/profile/TwoFactorCard.tsx": "6-digit code field appears only after a real authenticator enrolment; not swept on the shared accounts (would enrol 2FA on them)",
  "src/components/feedback/NpsPrompt.tsx": "appears on a 30-day cadence after a completed job; not reachable on demand",
  "src/components/ResponseDeadlineDialog.tsx": "select only (response window)",
  "src/components/CompletionPrompts.tsx": "yes/no prompts, no typed text",
  "src/pages/posts/CompletionChoiceSheet.tsx": "choice sheet, no typed text",
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
  // Read-only by decision, not by reachability.
  "src/components/admin/EditEmailDialog.tsx": "reachable (user detail → Edit email) but deliberately NOT swept: it rewrites an account's login address, and every shared test account is a sign-in dependency for this whole suite. One stray submit slipping the write firewall would lock every lane out of that account",
  "src/components/admin/DeleteUserDialog.tsx": "reachable (user detail → Actions → Delete account) but deliberately NOT swept: NEVER_PRESS (harness.ts) refuses \"Delete account\", because the account it would delete is a real member or one of the shared test accounts every lane signs in as. Its one field is the typed DELETE confirm",
};

/**
 * The inventory files no FORMS entry covers and no GAP excuses: the explore
 * presser reaches each one and credits it at run time. With FORMS and GAPS
 * this is the whole inventory, decided in the commit that changes it:
 * src/test/messyInputCoverageDecided.test.ts holds `inventory − FORMS − GAPS`
 * equal to this list, both ways, and the coverage test in messy-input.spec.ts
 * fails when explore did not credit one of them.
 */
export const EXPLORE_CREDITED: readonly string[] = [
  "src/components/admin/AdminMarketing.tsx",
  "src/components/admin/dashboard/DateRangeBar.tsx",
  "src/components/admin/marketing/MarketingComposerDialog.tsx",
  "src/components/admin/marketing/MarketingSettingsCard.tsx",
  "src/components/dashboard/applyConfirmDialog/ApplyBody.tsx",
  "src/components/reviewPanel/ReviewForm.tsx",
  "src/components/reviewPanel/ReviewQuestionCard.tsx",
  "src/components/postjob/AddressAutocomplete.tsx",
  // Split out of LogisticsSection (Builder 2f s8, friction 4): the same screen-4 address box, reached by the same explore pass.
  "src/components/postjob/AddressBlock.tsx",
  "src/components/postjob/BudgetSection.tsx",
  "src/components/postjob/LogisticsSection.tsx",
  "src/components/profile/SecurityTab.tsx",
  "src/pages/profile/giftCards/RecipientPicker.tsx",
];
