import {
  Dialog,
  DialogPrimaryAction,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogBody,
  DialogCallout,
} from "@/components/ui/dialog";
import type { DetectedViolation } from "@/lib/messageScanner";

/**
 * WHY THIS DIALOG SHOWS THE REASON AND THE OFFENDING TEXT
 *
 * It used to receive the violation label as a prop and render NOTHING but a
 * title and a button — the reason was computed, passed in, and dropped on the
 * floor. So a poster who wrote "call me when you're outside" — a legitimate
 * sentence — was told they had violated platform rules, with no statement of
 * which words were the problem and no way to find out. The only escape was to
 * guess and retry, and every retry that still matched re-blocked them.
 *
 * `scanMessage` already returns the exact matched substring alongside the
 * label, so both are shown: the RULE that fired, and the TEXT in their own
 * message that fired it. That is the difference between "something here is
 * wrong" and "delete these five characters".
 *
 * On the server the equivalent string lives in `messages.flag_reason`, written
 * by `contact_leak_reason()` (migration 20260907005738). It is NOT the source
 * here and cannot be: this dialog opens BEFORE the insert, so no row and no
 * `flag_reason` exists yet. `scanMessage` is the client mirror of that same
 * function, and the labels below are kept in the wording the server uses for
 * the rules the two share.
 *
 * One deliberate divergence, and it is why the explanations are keyed on
 * `type` rather than reprinting a server string verbatim: "my number" and
 * "my email" are CLIENT-ONLY warnings (see messageScanner.ts). The server does
 * not flag them, so telling a user the platform detected off-platform payment
 * intent would be a claim the server never made.
 */

/** One sentence per rule: what was found, and what to do instead. */
const EXPLANATION: Record<DetectedViolation["type"], string> = {
  phone_number:
    "Phone numbers can't be sent through Helpr chat. Arrange everything here — Helpr texts the other person your contact details automatically once a job is confirmed.",
  email:
    "Email addresses can't be sent through Helpr chat. Keep the conversation in the thread so the whole job stays on one record.",
  payment_app:
    "Payment apps can't be arranged through Helpr. Money moves through Helpr so the job is covered — a payment sent outside it has no protection, no receipt and no dispute route.",
  direct_pay:
    "This reads as moving the job off Helpr. Keeping it here is what makes the work covered, the payment held in escrow, and a dispute answerable.",
};

interface ViolationDialogProps {
  /**
   * Every rule the composed message tripped, in the order `scanMessage` found
   * them. `null` (or empty) closes the dialog.
   */
  violations: DetectedViolation[] | null;
  onOpenChange: (open: boolean) => void;
}

/** A long match is quoted, not dumped — 60 chars is enough to locate it. */
const excerpt = (match: string) =>
  match.length > 60 ? `${match.slice(0, 60)}…` : match;

export const ViolationDialog = ({
  violations, onOpenChange,
}: ViolationDialogProps) => {
  const list = violations ?? [];
  // De-duplicate by rule + matched text: "504-555-0100" typed twice is one
  // thing to fix, not two identical rows.
  const unique = list.filter(
    (v, i) => list.findIndex((o) => o.type === v.type && o.match === v.match) === i,
  );

  return (
    <Dialog open={unique.length > 0} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog">
        <DialogHero
          title={
            unique.length === 1
              ? unique[0].label
              : "This Violates Platform Rules"
          }
        />

        <DialogBody>
          <p>
            {unique.length === 1
              ? "This message wasn't sent. Here's the part that stopped it:"
              : "This message wasn't sent. Here are the parts that stopped it:"}
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {unique.map((v) => (
              <li key={`${v.type}:${v.match}`}>
                <span
                  className="not-italic font-semibold"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  “{excerpt(v.match)}”
                </span>
                {" — "}
                {unique.length === 1 ? EXPLANATION[v.type] : v.label}
              </li>
            ))}
          </ul>
          {unique.length > 1 && (
            <p>
              Contact details and off-platform payment arrangements can't be
              sent through Helpr chat. Keeping the job here is what makes the
              work covered, the payment held in escrow, and a dispute
              answerable.
            </p>
          )}
        </DialogBody>

        <DialogCallout>
          Remove or reword the quoted text and send again. Nothing has been sent
          and no strike has been recorded — the message is still in your box
          exactly as you typed it.
        </DialogCallout>

        {/* Single CTA on purpose. A "Send Anyway" action here was a trap:
            the downstream scan re-blocked the message every time and logged
            a violation per tap, so two taps reached the permanent-ban
            branch. Editing is the only path forward — the server trigger
            remains the true gate. */}
        <DialogFooter>
          <DialogPrimaryAction onClick={() => onOpenChange(false)}>
            Edit Message
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
