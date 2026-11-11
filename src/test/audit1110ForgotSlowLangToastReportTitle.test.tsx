/**
 * Whole-app audit 11-10 (Builder 2), four one-screen fixes:
 *
 *  F260b /forgot-password: "Sending..." sat alone for 4-10 s. After SLOW_SEND_MS the screen says the send is still
 *        going, so a person does not press again or leave.
 *  F410d Settings > Language: tapping Español showed no confirmation, so people tapped twice. The chosen language now
 *        carries a check mark and the switch confirms with a toast in the new language.
 *  F260h Report user sheet: the title said only "Report user"; now it names the person ("Report Hallie H.") and the
 *        Cancel / Send report row sticks to the sheet's bottom instead of sitting below the fold.
 *  F412a Money: the payout button says what it does in the member's words, "Add your bank (with Stripe)", matching the
 *        "Add a bank once" line beside it. "Stripe" stays in the label so the live press gate (PAYMENT_RX) still skips it.
 *
 * @mutate src/pages/auth/ForgotPassword.tsx | const SLOW_SEND_MS = 3000; | const SLOW_SEND_MS = 300000;
 * @mutate src/components/LanguageToggle.tsx | toast(t("lang.saved")) | void t("lang.saved")
 * @mutate src/components/LanguageToggle.tsx | {lang === l && <Check | {false && <Check
 * @mutate src/components/ReportDialog.tsx | ? `Report ${alsoBlock.name}` | ? `Report ${noun.toLowerCase()}`
 * @mutate src/components/ReportDialog.tsx | <DialogFooter className={REPORT_FOOTER_PINNED} | <DialogFooter
 * @mutate src/components/PayoutSetupForm.tsx | Add your bank (with Stripe) | Set up payouts with Stripe
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { __resetLangForTests } from "@/lib/i18n/language";

const resetMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetMock(...args),
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));

const { toast } = await import("sonner");
const { default: ForgotPassword } = await import("@/pages/auth/ForgotPassword");
const { LanguageToggle } = await import("@/components/LanguageToggle");
const { default: ReportDialog } = await import("@/components/ReportDialog");

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("F260b: a slow reset-link send says it is still going", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMock.mockReset().mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("after 3 s of Sending… a status line appears under the button", async () => {
    render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "jane.doe@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/email/i).closest("form") as HTMLFormElement);
    });
    expect(screen.getByText(/sending…/i)).toBeInTheDocument();
    expect(screen.queryByText(/still sending/i)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    const status = screen.getByText(/still sending/i);
    expect(status.getAttribute("role")).toBe("status");
  });
});

describe("F410d: choosing a language confirms the choice", () => {
  beforeEach(() => {
    __resetLangForTests();
    vi.mocked(toast).mockClear();
  });
  afterEach(() => {
    __resetLangForTests();
  });

  it("the chosen language carries a check mark and the switch toasts in the new language", async () => {
    render(<LanguageToggle />);
    const english = screen.getByRole("button", { name: /English/ });
    const spanish = screen.getByRole("button", { name: /Español/ });
    expect(english.querySelector("[data-lang-check]"), "English chosen: check on English").not.toBeNull();
    expect(spanish.querySelector("[data-lang-check]"), "Español not chosen: no check").toBeNull();

    fireEvent.click(spanish);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Español/)));
    const toasted = vi.mocked(toast).mock.calls[0][0] as string;
    expect(toasted, "toast is in the new language").toMatch(/Idioma/);
    expect(screen.getByRole("button", { name: /Español/ }).querySelector("[data-lang-check]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /English/ }).querySelector("[data-lang-check]")).toBeNull();
  });
});

describe("F260h: the report-user sheet names the person and keeps its buttons in reach", () => {
  it("title is Report <name> on a person, and the footer row is pinned", () => {
    render(
      <ReportDialog open onClose={() => {}} reportedType="user" reportedId="u-1" alsoBlock={{ name: "Hallie H.", onBlock: () => {} }} />,
    );
    expect(screen.getByRole("heading", { name: "Report Hallie H." })).toBeInTheDocument();
    const send = screen.getByRole("button", { name: /send report/i });
    const row = send.parentElement as HTMLElement;
    expect(row.className, "footer row sticks to the sheet bottom").toMatch(/\bsticky\b/);
    expect(row.className).toMatch(/\bbottom-0\b/);
  });

  it("a job report keeps the generic title", () => {
    render(<ReportDialog open onClose={() => {}} reportedType="job" reportedId="j-1" />);
    expect(screen.getByRole("heading", { name: /^Report job$/i })).toBeInTheDocument();
  });
});

describe("F412a: the payout button says Add your bank (with Stripe)", () => {
  it("PayoutSetupForm renders the new label and the old one is gone", () => {
    const form = src("src/components/PayoutSetupForm.tsx");
    expect(form).toContain("Add your bank (with Stripe)");
    expect(form).not.toContain("Set up payouts with Stripe");
  });
});
