// @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx |   const single = !confirmApplyJob?.is_group_job; |   const single = true;
// @mutate src/components/dashboard/ApplyConfirmDialog.tsx |           event.preventDefault(); |           void event;
// @mutate src/components/dashboard/ApplyConfirmDialog.tsx |           {confirmApplyJob && <ApplyJobSummary job={confirmApplyJob} />} |
// @mutate src/components/dashboard/ApplyConfirmDialog.tsx | ${applySheetPrice(job)}</span> | ${job.budget}</span>
// @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | `Apply at $${applySheetPrice(confirmApplyJob)}` | `Apply at $${confirmApplyJob.budget}`
// @mutate src/components/dashboard/applyConfirmDialog/applyTakeHome.ts |   if (!isGiveawayFixedPayJob(job)) return formatPrice(job.budget); |   if (false) return formatPrice(job.budget);
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApplyConfirmDialog } from "./ApplyConfirmDialog";
import type { EnrichedJob } from "@/components/dashboard/types";
import { scanMessage } from "@/lib/messageScanner";
import { POPUP_DIALOG_CLS, POPUP_SHEET_CLS } from "@/components/ui/popupFooter";

// `toast` is a thin stub. `dismiss` is real to these tests: ApplyBody takes
// down its own "You're offline" toast when the network returns (Q131).
const toastDismiss = vi.fn();
// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: (...a: unknown[]) => toastDismiss(...a) }),
}));

// ApplyBody now asks whether the CURRENT user can actually be awarded a job,
// so it can say so above the submit button (see useAwardBlockReason). That
// hook reads `useCurrentUser`, which is a React Query consumer — and these
// tests render the dialog bare, with no QueryClientProvider and no Router.
// Stubbing the hook keeps each test on the subject it was written for (the
// earnings math and the pitch field) instead of dragging two providers into
// all sixteen. `null` = nothing blocks this helper, which is the state every
// pre-existing test assumed. The notice's own behaviour is covered by its
// dedicated block at the bottom of this file.
const mockAwardBlockReason = vi.fn<() => string | null>(() => null);
vi.mock("@/hooks/useAwardBlockReason", () => ({
  useAwardBlockReason: () => mockAwardBlockReason(),
}));
// The earnings block also reads the viewer's first-payout fee (ME-008), which
// needs the profile and a platform_settings query. 0 = fee already paid, the
// state every test here assumed; the fee line itself is covered by
// ApplyEarningsBreakdown.test.tsx.
const owedFee = vi.hoisted(() => ({ cents: 0 }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({
  useFirstPayoutFeeCents: () => owedFee.cents,
}));

function makeJob(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-1",
    title: "Fix the fence",
    budget: 100,
    is_group_job: false,
    helpers_needed: 1,
    urgent_fee: 0,
    ...overrides,
  } as unknown as EnrichedJob;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    confirmApplyJob: makeJob(),
    platformFee: 10,
    applyMessage: "",
    setApplyMessage: vi.fn(),
    applyFiles: [] as File[],
    setApplyFiles: vi.fn(),
    applyLoading: false,
    handleApplyConfirm: vi.fn(),
    ...overrides,
  };
}

describe("ApplyConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    render(<ApplyConfirmDialog {...makeProps({ open: false })} />);
    expect(screen.queryByText("Apply at $100")).not.toBeInTheDocument();
  });

  it("leads with the take-home number and names no fee (owner 2026-10-25)", () => {
    // budget 100, 10% fee, solo job -> $90 take-home. The take-home is all the
    // sheet shows: no fee name, rate or subtraction.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.getByText(/Fix the fence/)).toBeInTheDocument();
    expect(screen.getByText("You take home")).toBeInTheDocument();
    expect(screen.getByText("$90")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/platform fee|helpr fee|10%|budget −/i);
  });

  it("divides the budget across helpers for a group job", () => {
    // budget 200 split 4 ways -> $50 each, 10% fee -> $45 take-home.
    render(
      <ApplyConfirmDialog
        {...makeProps({
          confirmApplyJob: makeJob({ budget: 200, is_group_job: true, helpers_needed: 4 }),
        })}
      />,
    );
    expect(screen.getByText("$45")).toBeInTheDocument();
  });

  it("adds the whole urgent bonus into take-home (Q362)", () => {
    // budget 100, 10% fee, +$15 urgent paid in FULL (Q362) -> 100 - 10 + 15
    // = $105; the HEADLINE take-home floors to whole dollars (matching JobPrice).
    render(
      <ApplyConfirmDialog
        {...makeProps({ confirmApplyJob: makeJob({ urgent_fee: 15 }) })}
      />,
    );
    expect(screen.getByText("$105")).toBeInTheDocument();
  });

  it("shows a generic prompt when no job is resolved", () => {
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: null })} />);
    expect(screen.getByText("Apply for this job")).toBeInTheDocument();
  });

  it("calls setApplyMessage as the pitch is typed", () => {
    const props = makeProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.change(screen.getByLabelText(/note to the person who posted this job/i), {
      target: { value: "I have done this before." },
    });
    expect(props.setApplyMessage).toHaveBeenCalledWith("I have done this before.");
  });

  it("submits via handleApplyConfirm when Apply now is clicked", () => {
    const props = makeProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply at $100" }));
    expect(props.handleApplyConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a loading label and disables the action while submitting", () => {
    render(<ApplyConfirmDialog {...makeProps({ applyLoading: true })} />);
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
  });

  it("is the shared popup shell: a bottom sheet on the phone, centred from 640px, like every other popup", () => {
    // Spec v2 §3 "Sheets and menus" (lead 2026-10-20, dd0dfdacf9): the one
    // DialogContent is a bottom sheet on the phone (POPUP_SHEET_CLS) and a
    // centred 480px dialog from sm (POPUP_DIALOG_CLS). Superseded the
    // 2026-08-30 centred-at-every-width sheet this used to assert. It tracks
    // the shared strings rather than a literal copy, so the next change to the
    // shell moves this test with it.
    render(<ApplyConfirmDialog {...makeProps()} />);
    const sheet = screen.getByRole("dialog");
    for (const cls of POPUP_SHEET_CLS.split(/\s+/).filter((c) => /^(fixed|bottom-0|inset-x-0)$/.test(c))) {
      expect(sheet.className.split(/\s+/)).toContain(cls);
    }
    for (const cls of ["sm:top-1/2", "sm:left-1/2", "sm:bottom-auto"]) {
      expect(POPUP_DIALOG_CLS).toContain(cls);
      expect(sheet.className.split(/\s+/)).toContain(cls);
    }
  });

  it("dismisses from the TOP-RIGHT, like every other sheet", () => {
    render(<ApplyConfirmDialog {...makeProps()} />);
    const close = screen.getByRole("button", { name: "Close" });
    // Icon-only: the name comes from the sr-only span, not visible text.
    expect(close.textContent?.trim()).toBe("Close");
    expect(close.style.top).toBe("1rem");
  });

  it("offers the pitch ONCE — no chips, no bullets, no character coaching", () => {
    // This block used to stack three invitations to write the same optional
    // sentence: two hint bullets, three suggestion chips, and the field's own
    // placeholder — plus a "30+ characters feels personal" line that coached
    // against a threshold nothing enforces.
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ is_urgent: true }) })} />);
    expect(screen.queryByRole("group", { name: /suggested openers/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/characters feels personal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reads personal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your pitch/i)).not.toBeInTheDocument();
    // The last coaching surface — the placeholder tip — is gone too (owner,
    // 2026-08-29). The field opens empty; the label carries the only prompt.
    expect(screen.getByLabelText(/note to the person who posted this job/i)).not.toHaveAttribute("placeholder");
  });

  it("tells the helpr the poster reads the note, in the label itself", () => {
    // One title, not a title plus a subtitle repeating it. "Add a note" alone
    // read like a private memo, so people left it blank or wrote carelessly.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.getByLabelText(/note to the person who posted this job/i)).toBeInTheDocument();
  });

  it("hides the character counter until the cap is in sight", () => {
    // The counter is information near the limit and pressure everywhere else.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.queryByText(/\/500$/)).not.toBeInTheDocument();
    render(<ApplyConfirmDialog {...makeProps({ applyMessage: "x".repeat(450) })} />);
    expect(screen.getByText("450/500")).toBeInTheDocument();
  });

  it("shows the default-pitch option from the start, inert until there is one to save", () => {
    // It used to MOUNT on the first keystroke, which fixed "offering to save
    // nothing" by making an option appear out of nowhere mid-typing and shove
    // the submit button 25px down at 375 (50px at 1440) — under a thumb already
    // travelling toward it. Present-but-disabled says the same thing and moves
    // nothing, so the row is here on an empty field too.
    render(<ApplyConfirmDialog {...makeProps()} />);
    const empty = screen.getByRole("checkbox", { name: /save as my default pitch/i });
    expect(empty).toHaveAttribute("data-state", "unchecked");
    expect(empty).toBeDisabled();
    cleanup();

    render(<ApplyConfirmDialog {...makeProps({ applyMessage: "I have done this before." })} />);
    const box = screen.getByRole("checkbox", { name: /save as my default pitch/i });
    // Shared Radix control, not a native input: index.css forces
    // `input[type="checkbox"] { min-width/height: 44px }` for the HIG touch
    // minimum, which would override the designed 20px box and draw a 44px
    // empty square. That rule excludes `[role="checkbox"]`.
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    // The label both wraps the control and points at it with htmlFor; a
    // double-forwarded click would toggle twice and land back on unchecked.
    expect(box).toHaveAttribute("data-state", "unchecked");
    expect(box).toBeEnabled();
    fireEvent.click(screen.getByText("Save as my default pitch"));
    expect(box).toHaveAttribute("data-state", "checked");
  });

  it("has no per-application file picker", () => {
    // Certs and work photos are uploaded ONCE on the profile (Edit Profile →
    // Recent work) and posters see them there via HelperWorkPhotos, so
    // re-attaching the same file on every application was repeated work.
    const file = new File(["resume contents"], "resume.pdf", { type: "application/pdf" });
    const { container } = render(<ApplyConfirmDialog {...makeProps({ applyFiles: [file] })} />);
    expect(screen.queryByText("resume.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText(/add attachments/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  /**
   * The award gate, told to the person it acts on.
   *
   * `helper_award_block_reason()` decides who may be handed a job. Both other
   * audiences were already served — the poster gets a message on a disabled
   * Hire button, and a helper who reaches the ACCEPT step gets
   * `AwardGateDialog`. The helper doing the APPLYING was told nothing, and
   * measured against prod on 2026-09-06 that was seven of eight non-seed
   * profiles: every one of them free to apply, none of them hireable, no
   * explanation anywhere. The silence reads as posters passing you over.
   *
   * Applying stays UNGATED on purpose (owner's decision, documented in
   * src/lib/awardGate.ts), so these assert an explanation that never becomes
   * a barrier: the submit button must survive.
   */
  describe("award-block notice", () => {
    it("says nothing when the helper can be hired", () => {
      mockAwardBlockReason.mockReturnValue(null);
      render(<ApplyConfirmDialog {...makeProps()} />);
      expect(screen.queryByText(/Set up payouts to get paid/i)).not.toBeInTheDocument();
    });

    it("explains an unfinished payout account without blocking the apply", () => {
      mockAwardBlockReason.mockReturnValue("helper_payout_setup_incomplete");
      render(
        <MemoryRouter>
          <ApplyConfirmDialog {...makeProps()} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/Set up payouts to get paid/i)).toBeInTheDocument();
      expect(screen.getByText(/the job becomes yours as soon as your payout account is set up/i)).toBeInTheDocument();
      // The fix is one tap away and points at the tab that actually holds it.
      expect(screen.getByRole("link", { name: /set up payouts/i })).toHaveAttribute(
        "href",
        "/profile?tab=payment",
      );
      // THE POINT: still applyable. A notice that disabled this would be the
      // opposite of the owner's decision.
      expect(screen.getByRole("button", { name: "Apply at $100" })).toBeEnabled();
    });

    it("stays silent on helper_unknown — a failed profile read is not news for this screen", () => {
      // That verdict means we could not read the profile at all. Reporting an
      // internal read failure to somebody mid-application helps nobody, and
      // the accept-step dialog still covers it if it persists.
      mockAwardBlockReason.mockReturnValue("helper_unknown");
      render(<ApplyConfirmDialog {...makeProps()} />);
      expect(screen.queryByText(/Set up payouts to get paid/i)).not.toBeInTheDocument();
    });
  });
});

/**
 * THE CONTACT FILTER TOLD THE SENDER NOTHING.
 *
 * A helper's apply note goes through the same server-side contact scan as a
 * chat message. When it fires, the application is stored with
 * `flagged_hidden = true` and the poster never sees the note — but the helper
 * was shown "Application sent!" and nothing else, so they waited on a reply to
 * a sentence nobody had read. Reproduced against prod on 2026-09-07: two rows
 * landed with flagged_hidden = true while the UI reported plain success.
 *
 * Messages has always blocked the same content BEFORE sending, with a dialog
 * naming the exact words. Apply now uses that same scanner and that same
 * dialog. The server-side scan stays where it is — this is the UI half of a
 * defence in depth, not a replacement for it.
 */
describe("ApplyConfirmDialog contact filter", () => {
  const PHONE_NOTE = "Sure, just call me at 504-555-0100 and we'll sort it out.";

  it("catches the exact note prod stored as flagged_hidden", () => {
    const found = scanMessage(PHONE_NOTE);
    expect(found.map((v) => v.type)).toContain("phone_number");
  });

  it("blocks before sending and quotes the offending text", () => {
    const handleApplyConfirm = vi.fn();
    render(<ApplyConfirmDialog {...makeProps({ applyMessage: PHONE_NOTE, handleApplyConfirm })} />);
    fireEvent.click(screen.getByRole("button", { name: /^apply (now|at \$)/i }));
    expect(handleApplyConfirm).not.toHaveBeenCalled();
    // Board 85 copy (2026-10-20): a phone number reads "Kept private for now".
    expect(screen.getByText(/Kept private for now/i)).toBeInTheDocument();
    // The dialog wraps the match in typographic quotes, so match on content.
    expect(document.body.textContent).toContain("504-555-0100");
  });

  it("lets a clean note through untouched", () => {
    const handleApplyConfirm = vi.fn();
    render(
      <ApplyConfirmDialog
        {...makeProps({
          applyMessage: "I have moved furniture for three years and can bring a dolly.",
          handleApplyConfirm,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^apply (now|at \$)/i }));
    expect(handleApplyConfirm).toHaveBeenCalled();
  });
});

// ── VACUITY ─────────────────────────────────────────────────────────────────
// PROVEN RED 2026-09-21. Raising the contact-scan threshold out of reach —
// i.e. letting a note with a phone number through to `handleApplyConfirm` —
// turns "blocks before sending and quotes the offending text" red. That branch
// is the whole point of the block: without it the server stores the
// application `flagged_hidden`, the poster never reads the note, and the helpr
// is told "Application sent!".
// BLIND TO: the server-side scan (the other half of the defence in depth), and
// to the two CLASS-NAME assertions in this file — "is centered" and "dismisses
// from the TOP-RIGHT" grade `className`/`style`, not rendered geometry, which
// jsdom cannot measure.
// @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | if (violations.length > 0) { | if (violations.length > 99) {

/**
 * Q131 — the offline toast must not outlive the offline state.
 *
 * Measured on prod 2026-09-23 (e2e/prod-audit/interruptions.spec.ts "offline
 * mid-apply"): the "You're offline … Retry" toast is `critical` (stays until
 * dismissed) and was still on screen, beside the closed sheet, after the
 * helper came back online and apply_to_job had answered 200 — a false
 * sentence next to the confirmation, whose Retry offered to send the landed
 * application again.
 */
// @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | if (online) toast.dismiss(OFFLINE_TOAST_ID); | if (online) void OFFLINE_TOAST_ID;
describe("ApplyConfirmDialog offline toast (Q131)", () => {
  // The event is a hint the app confirms with a probe (src/lib/connectivity.ts;
  // setup.ts's test probe agrees with navigator.onLine), so wait one tick for it.
  const setOnline = async (v: boolean) => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => v });
    await act(async () => {
      window.dispatchEvent(new Event(v ? "online" : "offline"));
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  it("takes down its own offline toast the moment the network is back", async () => {
    await setOnline(false);
    render(<ApplyConfirmDialog {...makeProps({ applyMessage: "Free Sunday." })} />);
    // Offline: the submit is refused with the critical offline toast, and nothing dismisses it yet.
    toastDismiss.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(toastDismiss).not.toHaveBeenCalledWith("apply-offline");
    await setOnline(true);
    expect(toastDismiss).toHaveBeenCalledWith("apply-offline");
    expect(screen.getByRole("button", { name: "Apply at $100" })).toBeEnabled();
    cleanup();
  });

  // Board 58: what you apply to, said once at the top; the note addressed by first name; the button names the price.
  it("board 58: the job card, 'Say hi to <first name>', the contact rule, and 'Apply at $X' (crew: 'Apply now')", () => {
    const { unmount } = render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ posterName: "Travis Boudreaux" }) })} />);
    const card = screen.getByTestId("apply-job-summary");
    expect(card.textContent).toMatch(/Travis Boudreaux/);
    expect(card.textContent).toMatch(/\$100/);
    expect(screen.getByLabelText(/Say hi to Travis/)).toBeInTheDocument();
    expect(screen.getByText(/can't be sent until you're hired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply at $100" })).toBeInTheDocument();
    unmount();
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ budget: 200, is_group_job: true, helpers_needed: 4 }) })} />);
    expect(screen.getByRole("button", { name: "Apply now" })).toBeInTheDocument();
  });

  // Owner 2026-10-30 (lead's decision, T1 saw $60 around the $50): applying to the giveaway shows $50 only.
  describe("the price on the card and the button", () => {
    const stamp = { budget: 60, urgent_fee: 0, helper_fee_percent: 5 };
    afterEach(() => { owedFee.cents = 0; cleanup(); });

    for (const cents of [0, 200]) {
      const owing = cents ? ", setup fee owed" : "";
      it(`the giveaway says $50 on both, with no $60, no take-home words and no setup fee${owing}`, () => {
        owedFee.cents = cents;
        render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ ...stamp, helper_fee_flat_cents: 700 }) })} />);
        expect(screen.getByTestId("apply-job-summary").textContent).toContain("$50");
        expect(screen.getByRole("button", { name: "Apply at $50" })).toBeEnabled();
        const sheet = document.body.textContent ?? "";
        expect(sheet).not.toContain("$60");
        expect(sheet).not.toContain("$48");
        expect(sheet).not.toMatch(/take[\s-]?home/i);
        expect(sheet).not.toMatch(/setup fee/i);
      });

      it(`every other job keeps its price on both and its take-home below${owing}`, () => {
        owedFee.cents = cents;
        render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ ...stamp, helper_fee_flat_cents: 70 }) })} />);
        expect(screen.getByTestId("apply-job-summary").textContent).toContain("$60");
        expect(screen.getByRole("button", { name: "Apply at $60" })).toBeEnabled();
        const sheet = document.body.textContent ?? "";
        expect(sheet).toContain(cents ? "$54" : "$56");
        expect(sheet).toMatch(/take home/i);
        if (cents) expect(sheet).toMatch(/setup fee/i);
      });
    }
  });

  // Deep audit 2026-10-28: with only the "a neighbor" fallback name, the note label read "Say hi to a".
  it("never says 'Say hi to a' when the poster's name is only the fallback", () => {
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ posterName: "a neighbor" }) })} />);
    expect(screen.queryByText(/Say hi to a\b/)).toBeNull();
    expect(screen.getByText(/Note to the person who posted this job/)).toBeInTheDocument();
  });

  // Board 58 (lead): the sheet takes the initial focus, not the fee breakdown's disclosure.
  it("board 58: opens with focus on the sheet", async () => {
    render(<ApplyConfirmDialog {...makeProps()} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    expect(document.activeElement?.getAttribute("aria-expanded")).toBeNull();
  });
});
