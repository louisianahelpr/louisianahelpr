/**
 * EVERY CONFIRM BUTTON READS JUST "Confirm" (owner 2026-11-01: "make the confirm button just confirm").
 * The job page's row (alone or in a pair), the card's row primary (JobStepPrimaryButton, the day-of confirm) and the
 * card actions the page re-draws (MenuAction) show "Confirm"; the full words stay the accessible name, so a screen
 * reader and every getByRole still hear what is being confirmed. Dialog titles and the crew's "Confirm work" keep theirs.
 *
 * @mutate src/components/ui/pairLabel.ts |   return CONFIRM_FULL.test(label) ? "Confirm" : label; |   return label;
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |   const shown = pair ? pairLabel(a.label) : buttonLabel(a.label); |   const shown = pair ? pairLabel(a.label) : a.label;
 * @mutate src/components/job-card/JobActionRow.tsx |   const shown = buttonLabel(label); |   const shown = label;
 * @mutate src/components/job-card/jobStepMenu.tsx |     const shown = pair ? pairLabel(p.label) : buttonLabel(p.label); |     const shown = pair ? pairLabel(p.label) : p.label;
 * @mutate src/components/ui/pairLabel.ts | const CONFIRM_FULL = /^Confirm (they've arrived\|it's still on\|you'll be at the job\|I'll be there\|new day)$/; | const CONFIRM_FULL = /^Confirm (they've arrived\|it's still on\|you'll be at the job)$/;
 * @mutate src/lib/lifecycleErrors.ts |     helper_not_dayof_confirmed: "Tap Confirm first, then you can head out.", |     helper_not_dayof_confirmed: "Tap \"Confirm you'll be at the job\" first, then you can head out.",
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CheckCircle2 } from "lucide-react";
import { JobPageActionRow } from "@/pages/jobs/jobPage/JobPageActionRow";
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { MenuAction } from "@/components/job-card/jobStepMenu";
import { buttonLabel } from "@/components/ui/pairLabel";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const FULL = ["Confirm you'll be at the job", "Confirm it's still on", "Confirm they've arrived", "Confirm I'll be there", "Confirm new day"];
const noop = () => {};

afterEach(cleanup);

describe("every confirm button reads just 'Confirm' (owner 11-01)", () => {
  it("the rule: each of the five confirms is 'Confirm'; other labels and the crew's 'Confirm work' keep their words", () => {
    expect(FULL.length).toBeGreaterThan(4);
    for (const f of FULL) expect(buttonLabel(f)).toBe("Confirm");
    for (const keep of ["Confirm work", "Approve and release", "Message Yusef", "I'm on my way"]) expect(buttonLabel(keep)).toBe(keep);
  });

  for (const full of FULL) {
    it(`the job page's row: '${full}' alone and in a pair shows 'Confirm', named in full`, () => {
      render(<JobPageActionRow tag="t" lead={{ key: "c", label: full, go: noop }} leadIsStep extras={[]} />);
      const alone = screen.getByRole("button", { name: full });
      expect(alone.textContent).toBe("Confirm");
      cleanup();
      render(<JobPageActionRow tag="t" lead={{ key: "c", label: full, go: noop }} leadIsStep extras={[{ key: "m", label: "Message", go: noop }]} />);
      expect(screen.getByRole("button", { name: full }).textContent).toBe("Confirm");
    });
  }

  it("the card's row primary (the day-of confirm) shows 'Confirm', named in full", () => {
    render(<JobStepPrimaryButton icon={CheckCircle2} label="Confirm you'll be at the job" onClick={noop} />);
    const b = screen.getByRole("button", { name: "Confirm you'll be at the job" });
    expect(b.textContent).toBe("Confirm");
  });

  it("a card action re-drawn on the page (More options list) shows 'Confirm', named in full", () => {
    render(<MenuAction chip={<JobStepPrimaryButton icon={CheckCircle2} label="Confirm they've arrived" onClick={noop} />} />);
    expect(screen.getByRole("button", { name: "Confirm they've arrived" }).textContent).toBe("Confirm");
  });

  it("the refusal names the button by what it says: 'Tap Confirm first'", () => {
    const copy = JSON.stringify(RPC_ERROR_COPY);
    expect(copy).toContain("Tap Confirm first, then you can head out.");
    expect(copy).not.toContain("Confirm you'll be at the job\\\" first");
  });
});
