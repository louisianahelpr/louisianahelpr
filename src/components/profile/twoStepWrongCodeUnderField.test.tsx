/**
 * AUD31-71 (Auditor 7, 10-31, Account leftovers): two-step setup. A wrong code
 * raised a red "That code didn't match" toast that sat on top of "Verify and
 * turn on" at 375, and a right code after it turned two-step ON while that red
 * toast stayed beside the ON badge, with no success message. The Turn off sheet
 * had no line saying which code, and read "Keep It On" (Title Case).
 *
 * Renders the real card with the supabase client faked (no network): a wrong
 * code shows the message UNDER the field and no error toast; typing clears it;
 * the right code says "Two-step is on."; the Turn off sheet names the code and
 * says "Keep it on", and its wrong code also lands under the field.
 *
 * @mutate src/components/profile/TwoFactorCard.tsx |       // AUD31-71: under the field, not a toast over "Verify and turn on" that outlives a right code.\n      setCodeError(WRONG_CODE); |       toast.error(WRONG_CODE);
 * @mutate src/components/profile/TwoFactorCard.tsx |             toast("Two-step is on."); |             void 0;
 * @mutate src/components/profile/TwoFactorCard.tsx |       setWorking(false);\n      setCodeError(WRONG_CODE); |       setWorking(false);\n      toast.error(WRONG_CODE);
 * @mutate src/components/profile/TwoFactorCard.tsx |           Enter the code from your authenticator app. |
 * @mutate src/components/profile/TwoFactorCard.tsx |             Keep it on | Keep It On
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { TwoFactorCard } from "./TwoFactorCard";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

let factors: Array<{ id: string; factor_type: string; status: string; friendly_name: string }> = [];
const challengeAndVerify = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "u-1", email: "a@example.com", factors } }, error: null }),
      mfa: {
        listFactors: async () => ({ data: { totp: [], all: [] }, error: null }),
        unenroll: vi.fn(async () => ({ data: {}, error: null })),
        enroll: async () => ({ data: { id: "f-new", totp: { secret: "SECRETKEY" } }, error: null }),
        challengeAndVerify: (...a: unknown[]) => challengeAndVerify(...a),
      },
    },
  },
}));

const WRONG = "That code didn't match. Check your app and try again.";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TwoFactorCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  factors = [];
  challengeAndVerify.mockReset();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("two-step: a wrong code is said under the field, a right one says it's on (AUD31-71)", () => {
  it("setup: wrong code under the field, no error toast; right code confirms", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on two-step verification" }));
    const input = await screen.findByLabelText("6-digit code");

    challengeAndVerify.mockResolvedValueOnce({ data: null, error: { message: "mfa_verification_failed" } });
    fireEvent.change(input, { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and turn on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(WRONG);
    expect(input).toHaveAttribute("aria-describedby", "mfa-code-error");
    expect(toast.error).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "22222" } });
    expect(screen.queryByRole("alert")).toBeNull();

    challengeAndVerify.mockResolvedValueOnce({ data: {}, error: null });
    fireEvent.change(input, { target: { value: "222222" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and turn on" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Two-step is on."));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("turn off: says which code, 'Keep it on', and a wrong code lands under the field", async () => {
    factors = [{ id: "f-1", factor_type: "totp", status: "verified", friendly_name: "Phone" }];
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off two-step verification" }));
    expect(await screen.findByText("Enter the code from your authenticator app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it on" })).toBeInTheDocument();

    challengeAndVerify.mockResolvedValueOnce({ data: null, error: { message: "mfa_verification_failed" } });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "333333" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(WRONG);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
