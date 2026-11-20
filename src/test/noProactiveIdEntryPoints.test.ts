/**
 * CLASS GUARD: nothing starts the ID check early or voluntarily (owner rule, repeated many times; 11-20 again,
 * after real members opened Stripe Identity 1-10 minutes after sign-up from /home and /complete-profile with no job
 * posted or offered, as late as 11-03 and 11-06).
 *
 * The ID check is asked ONLY at a required moment: a poster when sending an offer, a Helpr when hired / heading out /
 * at the first payout, a delivery Helpr when taking a delivery. Never at sign-up, on Home, on /complete-profile, in
 * Settings or the profile, on the apply step, or from any "Verify your ID" button a member can press early.
 *
 * Built from the tree, not a list typed here: every tracked src/ module and every edge function is read (comments
 * blanked, blankComments) for the things that START the check:
 *   - openIdentityCheck( / openIdentityCheckOrSay( / offerIdentityCheckAfterConfirm(  (open the one ID sheet)
 *   - <IdentityPromptCard                                                             (the card whose button opens it)
 *   - an import of @/components/identity/IdentityCheckSheet                           (the sheet itself)
 *   - "stripe-idv-start"                                                              (the edge function that starts Stripe)
 *   - verify_id=1                                                                     (the entry link that opens the sheet on arrival)
 * Each file that holds one must be a required-moment file below, with why. EXACT both ways: a new entry point fails,
 * and an entry whose file no longer starts the check fails too ("remove it").
 *
 * @mutate src/components/profile/SettingsTab.tsx | sub={ID_ROW_SUB[identityView(profile.idv_status)]} right= | sub={ID_ROW_SUB[identityView(profile.idv_status)]} onClick={() => openIdentityCheckOrSay("general")} right=
 * @mutate src/lib/awardGate.ts |         href: "/profile?tab=payment", |         href: "/home?verify_id=1",
 * @mutate src/components/profile/profileEditForm/TrustMarksCard.tsx |       : { key: "id", label: "Photo ID", done: false, state: "Checking" }, |       : { key: "id", label: "Photo ID", done: false, state: "Verify now", onClick: () => openIdentityCheckOrSay("general") },
 * @mutate src/pages/auth/CompleteProfile.tsx | export default CompleteProfile; | export const startId = () => openIdentityCheck("general");\nexport default CompleteProfile;
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx |     awardBlockReason === "helper_payout_setup_incomplete" && !payoutSetupPausedHere | awardBlockReason && awardBlockReason !== "helper_unknown" && !payoutSetupPausedHere
 * @mutate src/lib/helprTasks/errorCopy.ts | take this delivery. It takes about 2 minutes, and you only do it once.",\n    identity_required_to_deliver | take this delivery. You only do it once: You, then Settings, then ID.",\n    identity_required_to_deliver
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) => blankComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** Anything that starts (or opens the sheet that starts) the ID check. */
const STARTS_ID =
  /\bopenIdentityCheck(?:OrSay)?\s*\(|\bofferIdentityCheckAfterConfirm\s*\(|<IdentityPromptCard\b|["']@\/components\/identity\/IdentityCheckSheet["']|["']stripe-idv-start["']|verify_id=1/;

/** src/ modules that may start the check: each is a required moment (or the check's own machinery). EXACT. */
const REQUIRED_MOMENTS: Readonly<Record<string, string>> = {
  // The machinery: defines the opener, the sheet, and the always-mounted host (opens only when asked or by link).
  "src/lib/identityCheck.ts": "defines openIdentityCheck / OrSay / offerIdentityCheckAfterConfirm",
  "src/components/identity/IdentityCheckSheet.tsx": "the sheet: the only caller of stripe-idv-start",
  "src/components/identity/IdentityCheckMount.tsx": "the host beside the routes: loads the sheet only once it is opened",
  "src/components/identity/IdentityPromptCard.tsx": "the card's button; drawn only by HelperTrackerPanel (a hired Helpr)",
  // Poster, when SENDING AN OFFER (owner 2026-11-20; never when posting): the one opener every offer path calls
  // (useJobSubmit's direct offer, quotes, useOfferHandlers, InstantBookPanel, seriesDates) on identity_required_to_offer.
  "src/lib/posterIdAtOffer.ts": "poster: the server's refusal of an unverified poster's offer (20261120205350)",
  // Helpr, when hired / heading out / at the first payout.
  "src/components/AwardGateDialog.tsx": "Helpr: the accept/hire gate",
  "src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx": "Helpr: the hired job's tracker card",
  "src/components/statusUpdate.ts": "Helpr: On the way / arrived refused (identity_required_to_start)",
  "src/lib/crewLifecycle.ts": "Helpr on a crew: heading out refused (identity_required_to_start)",
  "src/components/JobConfirmation.tsx": "Helpr: right after the hired Helpr's day-of confirm (never the poster)",
  // Delivery Helpr, when taking a delivery.
  "src/lib/helprTasks/api.ts": "delivery Helpr: taking a delivery (identity_required_to_deliver)",
  // Declutter as it stands on main; PR #4820 removes all Declutter ID. When it lands these four go RED here as
  // stale: delete them then.
  "src/lib/declutter/api.ts": "Declutter (until #4820): opened on the server's buy/list/claim refusal",
  "src/components/identity/FreeClaimFirstTime.tsx": "Declutter (until #4820): a first free claim",
  "src/components/declutter/SellerPayoutPrompt.tsx": "Declutter (until #4820): the seller's first payout",
  "src/pages/home/homeDashboard/needsYouTodos.ts": "Declutter (until #4820): the seller's first-payout to-do",
};

/** Edge functions that link to the ID step (verify_id=1) or start it. EXACT. */
const FUNCTION_MOMENTS: Readonly<Record<string, string>> = {
  "_shared/payoutSetupReminder.ts": "a HIRED Helpr's payout reminder (payout-setup-reminders claims only hires)",
  "admin-user-actions/index.ts": "an admin's request to re-upload an ID already submitted (request_id_reupload)",
  "pay-onboarding-fee/index.ts": "Declutter first free claim's return link (#4820's area)",
  "stripe-idv-start/index.ts": "the function itself (its rate-limit key)",
};

/** Surfaces a member meets early. Nothing in them may start the check (a stricter restatement of the list above). */
const EARLY_SURFACES = ["src/pages/auth/", "src/components/profile/", "src/pages/profile/", "src/components/home/", "src/pages/home/HomeDashboard.tsx"];

describe("nothing starts the ID check early or voluntarily", () => {
  const srcFiles = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
  const srcHits = srcFiles.filter((f) => STARTS_ID.test(code(f))).sort();

  const FN_DIR = path.join(ROOT, "supabase/functions");
  const fnFiles = walkSource([FN_DIR]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  const fnHits = fnFiles
    .filter((f) => STARTS_ID.test(blankComments(readSource(f) ?? "")))
    .map((f) => path.relative(FN_DIR, f).split(path.sep).join("/"))
    .sort();

  it("reads a real inventory (floor)", () => {
    expect(srcFiles.length).toBeGreaterThan(1500);
    expect(fnFiles.length).toBeGreaterThan(100);
    expect(srcHits.length).toBeGreaterThan(10);
  });

  it("only required-moment modules start the check (exact both ways)", () => {
    expect(srcHits).toEqual(Object.keys(REQUIRED_MOMENTS).sort());
  });

  it("only required-moment edge functions link to the ID step (exact both ways)", () => {
    expect(fnHits).toEqual(Object.keys(FUNCTION_MOMENTS).sort());
  });

  it("sign-up, /complete-profile, Settings, the profile and Home never start it", () => {
    const early = srcFiles.filter((f) => EARLY_SURFACES.some((s) => f === s || (s.endsWith("/") && f.startsWith(s))));
    expect(early.length).toBeGreaterThan(50);
    expect(early.filter((f) => STARTS_ID.test(code(f)))).toEqual([]);
  });

  it("the Settings ID row and the trust marks are read-only", () => {
    const settings = code("src/components/profile/SettingsTab.tsx");
    const idRow = settings.match(/<Row testId="id"[\s\S]*?\/>\n/)?.[0] ?? "";
    expect(idRow).toContain("ID_ROW_SUB");
    expect(idRow).not.toMatch(/onClick/);
    const trust = code("src/components/profile/profileEditForm/TrustMarksCard.tsx");
    expect(trust).toMatch(/\{ key: "id", label: "Photo ID", done: true, state: "Verified" \}/);
    expect(trust.match(/\{ key: "id"[^}]*\}/g)?.join("\n") ?? "").not.toMatch(/onClick/);
  });

  it("the apply step asks for payout setup only, never the ID", () => {
    const apply = code("src/components/dashboard/applyConfirmDialog/ApplyBody.tsx");
    expect(apply).toMatch(/awardBlockReason === "helper_payout_setup_incomplete" && !payoutSetupPausedHere/);
    const notice = code("src/lib/awardGate.ts").match(/export function helperApplyBlockNotice[\s\S]*?\n}\n/)?.[0] ?? "";
    expect(notice).toContain("Set up payouts");
    expect(notice).not.toMatch(/[Ii]dentity|[Vv]erify|\bID\b|verify_id/);
  });

  it("no copy sends a member to Settings to verify their ID (Settings cannot start it)", () => {
    const hits = srcFiles.filter((f) => /Settings, then ID|Verify your ID in Settings/.test(code(f)));
    expect(hits).toEqual([]);
  });
});
