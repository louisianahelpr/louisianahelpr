/**
 * Spanish language option (Builder 71, 2026-10-29): the shared helpers that
 * converted screens (Sign up, Finish your profile) call for their words
 * follow the member's language too. Before this, a Spanish member on the
 * Spanish Sign up screen still met English from passwordProblem(), the
 * photo-file toasts, the "timed out" message, the notify subtitle and the
 * unknown-ZIP warning, and the whole Delete account dialog.
 *
 * English stays word for word (signupHelpers.test.ts, notifyButtonsArePushOnly
 * and unknownZipIsNeverSilent pin it); this file pins the Spanish.
 *
 * @mutate src/pages/auth/signup/signupHelpers.ts | return t("pw.stillNeeds", { needs: joined }); | return `Your password still needs ${joined}.`;
 * @mutate src/pages/auth/signup/signupHelpers.ts | toast.error(t("upload.fileType", { label })); | toast.error(`${label}: that file type isn't supported — try JPG, PNG, or WEBP.`);
 * @mutate src/pages/auth/completeProfile/constants.ts | reject(new Error(t("common.timedOut", { label }))) | reject(new Error(`${label} timed out.`))
 * @mutate src/lib/jobIntent.ts | return reason === "notify" ? t("signup.notifySubtitle") : undefined; | return reason === "notify" ? NOTIFY_SIGNUP_SUBTITLE : undefined;
 * @mutate src/components/profile/DeleteAccountDialog.tsx | title={t("deleteAccount.beforeYouGo")} | title="Before you go"
 * @mutate src/components/profile/DeleteAccountDialog.tsx | {deletingAccount ? t("deleteAccount.deleting") : t("deleteAccount.deleteMine")} | {deletingAccount ? "Deleting…" : "Delete my account"}
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (m: string) => toastError(m), info: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() }) }));
vi.mock("@/components/profile/DeleteAccountReauth", () => ({
  useDeleteReauth: () => ({ fields: null, ready: true, confirm: async () => true }),
}));

import { setLang, ensureLangLoaded, __resetLangForTests, t } from "@/lib/i18n/language";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { passwordProblem, validateFile } from "@/pages/auth/signup/signupHelpers";
import { withTimeout } from "@/pages/auth/completeProfile/constants";
import { notifySignupSubtitle } from "@/lib/jobIntent";
import { UNKNOWN_ZIP_MESSAGE } from "@/hooks/useParishForZip";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

const dialogProps = {
  open: true,
  onOpenChange: () => {},
  setDeleteStep: () => {},
  deleteConfirmText: "",
  setDeleteConfirmText: () => {},
  deletingAccount: false,
  onDelete: () => {},
  accountDeleted: false,
  onAcknowledgeDeleted: () => {},
};

describe("shared helpers on converted screens speak Spanish", () => {
  beforeEach(async () => {
    __resetLangForTests();
    toastError.mockReset();
    setLang("es");
    await ensureLangLoaded();
  });
  afterEach(() => {
    __resetLangForTests();
  });

  it("passwordProblem names what is missing in Spanish", () => {
    expect(passwordProblem("PASSWORD12345")).toBe("Su contraseña todavía necesita una letra minúscula y un símbolo como ! ? # o $.");
    expect(passwordProblem("Ab1!")).toBe("Su contraseña todavía necesita 12 caracteres o más.");
    expect(passwordProblem("Abcdefghijk1!")).toBeNull();
  });

  it("the photo-file toasts are Spanish", () => {
    validateFile(new File(["x"], "a.txt", { type: "text/plain" }), ["image/png"], "Foto de perfil");
    expect(toastError).toHaveBeenCalledWith(es["upload.fileType"].replace("{label}", "Foto de perfil"));
    expect(es["upload.fileType"]).not.toBe(en["upload.fileType"]);
  });

  it("the timeout message is Spanish", async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, t("signup.finishingLabel"), 1)).rejects.toThrow(
      es["common.timedOut"].replace("{label}", es["signup.finishingLabel"]),
    );
  });

  it("the notify subtitle and the unknown-ZIP warning are Spanish", () => {
    expect(notifySignupSubtitle("notify")).toBe(es["signup.notifySubtitle"]);
    expect(t(UNKNOWN_ZIP_MESSAGE)).toBe(es["zip.unknown"]);
    expect(es["zip.unknown"]).toMatch(/Louisiana/);
    expect(es["zip.unknown"]).not.toMatch(/inválid|incorrect/i);
  });

  it("the Delete account dialog is Spanish, both steps", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/profile"]}>
        <DeleteAccountDialog {...dialogProps} deleteStep={1} />
      </MemoryRouter>,
    );
    expect(screen.getByText(es["deleteAccount.beforeYouGo"])).toBeTruthy();
    expect(screen.getByText(es["deleteAccount.erasedHeading"])).toBeTruthy();
    expect(screen.getByText(es["deleteAccount.downloadFirst"])).toBeTruthy();
    expect(screen.queryByText("Before you go")).toBeNull();
    unmount();
    render(
      <MemoryRouter>
        <DeleteAccountDialog {...dialogProps} deleteStep={2} />
      </MemoryRouter>,
    );
    expect(screen.getByText(es["deleteAccount.deleteMine"])).toBeTruthy();
    expect(screen.queryByText("Delete my account")).toBeNull();
  });
});
