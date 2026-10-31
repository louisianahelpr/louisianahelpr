/**
 * CLASS GUARD (LEAD-TOASTMOCK, 2026-10-31): a test's mock of "sonner" keeps `toast` callable.
 *
 * Member confirmations are bare `toast(...)` (toast.success/info render nothing under toastPolicy). A mock written
 * `vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))` makes `toast` a plain object, so the
 * code under test throws "toast is not a function" at its bare toast() and the throw is swallowed by an onSuccess
 * or a catch: deliveryRoute.test.tsx hid a real defect that way (b81, 71dc06111a). The shared mock is
 * src/test/helpers/sonnerMock.ts (`vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock())`).
 *
 * Inventory: every tracked test file under src/ that mocks "sonner", comments blanked; an offender's factory gives
 * `toast` an object literal (`toast: {`). LEGACY is the exact list still to move (shrink-only, exact both ways).
 * Not seen by this scan: a factory that passes a variable (`toast: toasts`) declared as a plain object elsewhere.
 *
 * @mutate src/components/quotes/quoteScreens.test.tsx | vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) })); | vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { callableToast } from "./helpers/sonnerMock";

const ROOT = resolve(__dirname, "../..");

/** The factory text of each `vi.mock("sonner", ...)` in `code`. */
export function sonnerFactories(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/vi\.mock\(\s*["']sonner["']/g)) {
    const rest = code.slice(m.index!, m.index! + 2000);
    // The call ends at the first `);` that closes it at line end.
    const end = rest.search(/\)\);?\s*(?:\n|$)|\n\}\);/);
    out.push(end < 0 ? rest : rest.slice(0, end + 3));
  }
  return out;
}

export const nonCallable = (factory: string): boolean => /\btoast\s*:\s*\{/.test(factory);

const tests = trackedFiles("src").filter((f) => /\.test\.(ts|tsx)$/.test(f) && f !== "src/test/sonnerMocksAreCallable.test.ts");
const mocking = tests
  .map((f) => [f, blankComments(readFileSync(resolve(ROOT, f), "utf8"))] as const)
  .filter(([, code]) => /vi\.mock\(\s*["']sonner["']/.test(code));
const offenders = mocking.filter(([, code]) => sonnerFactories(code).some(nonCallable)).map(([f]) => f).sort();

/** Still to move onto sonnerMock (2026-10-31). Shrink only: a file that moves leaves this list in the same commit. */
// @two-way src/test/sonnerMocksAreCallable.test.ts:stale baseline entry in LEGACY
const LEGACY: readonly string[] = [
  "src/components/BrowseMap.test.tsx",
  "src/components/CancellationDialog.doneRefusal.test.tsx",
  "src/components/CancellationDialog.giftToast.test.tsx",
  "src/components/InstantPayoutDialog.test.tsx",
  "src/components/JobTracking.onTheWayGate.test.tsx",
  "src/components/PayoutSetupForm.test.tsx",
  "src/components/ReferralSection.test.tsx",
  "src/components/__tests__/TipDialogBounds.test.tsx",
  "src/components/admin/AdminBanEvasionReview.test.tsx",
  "src/components/admin/AdminDisputes.biometricGate.test.tsx",
  "src/components/admin/AdminDisputes.clearTestMode.test.tsx",
  "src/components/admin/AdminDisputes.settleWithoutPayment.test.tsx",
  "src/components/admin/AdminJobs.test.tsx",
  "src/components/admin/AdminPayoutBatches.test.tsx",
  "src/components/admin/AdminSettings.test.tsx",
  "src/components/admin/AdminUserDetailDialog.test.tsx",
  "src/components/admin/BanDialog.test.tsx",
  "src/components/admin/DeleteUserDialog.test.tsx",
  "src/components/admin/EditEmailDialog.test.tsx",
  "src/components/admin/FormalWarningDialog.test.tsx",
  "src/components/admin/ManualVerifyDialog.test.tsx",
  "src/components/admin/ResetPasswordDialog.test.tsx",
  "src/components/admin/adminJobs/EndSeriesSection.test.tsx",
  "src/components/admin/adminJobs/adminJobsNotifications.test.tsx",
  "src/components/admin/helprFault/helprFaultAdminButtons.test.tsx",
  "src/components/admin/settings/FeatureSwitchesCard.test.tsx",
  "src/components/dashboard/jobDetailDialog/JobDetailFooter.ageGate.test.tsx",
  "src/components/declutter/declutterPickupDayCard.test.tsx",
  "src/components/declutter/declutterQuestions.test.tsx",
  "src/components/declutter/declutterTaskDelivered.test.tsx",
  "src/components/declutter/deliverAcceptConfirms.test.tsx",
  "src/components/payouts/payoutSetupPaused.test.tsx",
  "src/components/postjob/AiJobBuilder.test.tsx",
  "src/components/postjob/CurrentLocationPill.test.tsx",
  "src/components/profile/SecurityTab.appLockGate.test.tsx",
  "src/hooks/useSessionTimeout.test.tsx",
  "src/lib/recipientGate.test.tsx",
  "src/lib/requireOnline.test.ts",
  "src/pages/auth/SignupPending.test.tsx",
  "src/pages/home/useBoostReturn.test.tsx",
  "src/pages/post-job/useJobMediaUpload.video.test.tsx",
  "src/pages/posts/EditJobDialog.flexibleSchedule.test.tsx",
  "src/test/heicProofPhotos.test.tsx",
  "src/test/posterCancelQuoteGuard.test.tsx",
];

describe("every sonner mock keeps toast callable", () => {
  it("reads a real inventory", () => {
    expect(mocking.length).toBeGreaterThan(200);
  });

  it("no test file outside LEGACY mocks toast as a plain object", () => {
    expect(offenders.filter((f) => !LEGACY.includes(f))).toEqual([]);
  });

  it("LEGACY is exact: each entry is still an offender", () => {
    expect(LEGACY.filter((f) => !offenders.includes(f)), "stale baseline entry in LEGACY — remove it (lower the baseline)").toEqual([]);
  });

  it("the scan sees a planted plain-object mock, and passes the shared and Object.assign ones (self-test)", () => {
    expect(sonnerFactories('vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));\n').some(nonCallable)).toBe(true);
    expect(sonnerFactories('vi.mock("sonner", () => ({\n  toast: {\n    error: vi.fn(),\n  },\n}));\n').some(nonCallable)).toBe(true);
    expect(sonnerFactories('vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));\n').some(nonCallable)).toBe(false);
    expect(sonnerFactories('vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());\n').some(nonCallable)).toBe(false);
  });

  it("the shared mock catches a plain toast() call", () => {
    const toast = callableToast();
    const confirm = () => toast("Saved.");
    expect(confirm).not.toThrow();
    expect(toast).toHaveBeenCalledWith("Saved.");
    for (const k of ["success", "error", "info", "warning", "message", "loading", "dismiss", "promise", "custom"] as const) {
      expect(typeof toast[k]).toBe("function");
    }
  });
});
