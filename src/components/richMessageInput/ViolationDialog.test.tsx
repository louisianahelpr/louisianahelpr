import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViolationDialog, violationTitle } from "./ViolationDialog";
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
    // Board 85: a calm title, never "This Violates Platform Rules".
    expect(screen.getByRole("heading", { name: "Kept private for now" })).toBeInTheDocument();
  });

  it("board 85 titles: contact -> kept private; a payment app -> keep payment on Helpr; other off-app talk -> keep it on Helpr", () => {
    expect(violationTitle(["phone_number"])).toBe("Kept private for now");
    expect(violationTitle(["email", "payment_app"])).toBe("Kept private for now");
    expect(violationTitle(["payment_app", "direct_pay"])).toBe("Let's keep payment on Helpr");
    expect(violationTitle(["direct_pay"])).toBe("Let's keep it on Helpr");
  });

  it("explains the rule for the case that reads as a false positive", () => {
    // "call me when you're outside" was the message the report was written
    // about; since Messages audit M3 (2026-10-30) it passes the filter with no
    // contact detail beside it. "dm me when you're outside" is the same shape
    // and still trips the off-platform rule, so the dialog must explain it.
    expect(scanned("call me when you're outside")).toHaveLength(0);
    const violations = scanned("dm me when you're outside");
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("direct_pay");

    render(<ViolationDialog violations={violations} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/dm me/i)).toBeInTheDocument();
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
    // AUD31-41: with two catches no explanation follows each bullet, so none may end in a dangling dash.
    // @mutate src/components/richMessageInput/ViolationDialog.tsx | {unique.length === 1 ? <>{" — "}{EXPLANATION[v.type]}</> : null} | {" — "}{unique.length === 1 ? EXPLANATION[v.type] : null}
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(1);
    for (const li of items) expect(li.textContent ?? "").not.toMatch(/—\s*$/);
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

// The dialog's entire reason to exist is printing the offending SUBSTRING —
// the one thing a label alone can never carry. Replace it with the rule key
// and the sender is back to guess-and-retry.
// @mutate src/components/richMessageInput/ViolationDialog.tsx | {excerpt(v.match)} | {v.type}
// @mutate src/components/richMessageInput/ViolationDialog.tsx |           title={violationTitle(unique.map((v) => v.type))} |           title={unique.length === 1 ? unique[0].label : "This Violates Platform Rules"}
// @mutate src/components/richMessageInput/ViolationDialog.tsx |   if (types.includes("payment_app")) return "Let's keep payment on Helpr"; |   if (types.includes("payment_app")) return "Kept private for now";
