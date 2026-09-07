import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViolationDialog } from "./ViolationDialog";
import { scanMessage } from "@/lib/messageScanner";

/**
 * THE FAILURE THESE PREVENT
 *
 * This dialog previously received the violation label as a prop and rendered
 * neither it nor anything else: a title, a button, and blank space. A sender
 * whose legitimate message ("call me when you're outside") was blocked had no
 * statement of which words were the problem, so the only way forward was to
 * guess and retry — and a retry that still matched blocked them again.
 *
 * So every assertion below is on RENDERED TEXT, and specifically on the
 * offending substring, which is the one thing a label alone can never carry.
 * A test that only asserted the dialog opens would have passed against the
 * empty version.
 */

/** Drive the dialog from the real scanner, so the test cannot pass against a
 *  hand-written violation shape the app never actually produces. */
const scanned = (text: string) => scanMessage(text);

describe("ViolationDialog", () => {
  it("names the exact text that tripped the rule, not just that something did", () => {
    const violations = scanned("Give me a ring on 504-555-0100 when you're close");
    // Guard the guard: if the scanner stops matching this, the assertions
    // below would pass vacuously against an unopened dialog.
    expect(violations).toHaveLength(1);
    expect(violations[0].match).toContain("504-555-0100");

    render(<ViolationDialog violations={violations} onOpenChange={vi.fn()} />);

    // The substring from the user's own message must be on screen.
    expect(screen.getByText(/504-555-0100/)).toBeInTheDocument();
    // …and the rule that fired, as its own statement.
    expect(screen.getByText(/Phone number detected/i)).toBeInTheDocument();
    // …and what to do about it.
    expect(screen.getByText(/Remove or reword the quoted text/i)).toBeInTheDocument();
  });

  it("explains the rule for the case that reads as a false positive", () => {
    // "call me when you're outside" is the exact message the report was
    // written about: a real, innocent sentence that the off-platform filter
    // blocks. If the dialog cannot explain THIS one it has not solved anything.
    const violations = scanned("call me when you're outside");
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("direct_pay");

    render(<ViolationDialog violations={violations} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/call me/i)).toBeInTheDocument();
    expect(screen.getByText(/moving the job off Helpr/i)).toBeInTheDocument();
  });

  it("lists every distinct rule when a message trips more than one", () => {
    const violations = scanned("email me at joe@example.com or venmo me instead");
    const types = new Set(violations.map((v) => v.type));
    expect(types.has("email")).toBe(true);
    expect(types.has("payment_app")).toBe(true);

    render(<ViolationDialog violations={violations} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/joe@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/venmo/i)).toBeInTheDocument();
  });

  it("collapses a repeated match into one row to fix", () => {
    // The scanner reports one violation per match, so a number typed twice
    // arrives twice. Two identical bullets read as two separate problems.
    const violations = scanned("504-555-0100 — again, that's 504-555-0100");
    expect(violations.length).toBeGreaterThan(1);

    render(<ViolationDialog violations={violations} onOpenChange={vi.fn()} />);

    expect(screen.getAllByText(/504-555-0100/)).toHaveLength(1);
  });

  it("renders nothing when there is no violation", () => {
    render(<ViolationDialog violations={[]} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
