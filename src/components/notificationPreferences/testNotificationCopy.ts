// The Notifications screen's "Send test" result copy: what create-notification
// reports per channel, turned into words that name a switch the member can flip.
// Moved out of NotificationPreferences.tsx unchanged (component size ratchet).
import { rows } from "./constants";

/** One delivery channel's outcome, as reported by `create-notification`. */
type TestChannel = {
  status?: "sent" | "skipped" | "failed" | "queued";
  /** Machine reason for a skip/failure (e.g. `email_disabled`). */
  reason?: string;
  /** Masked recipient, e.g. `lexi…@gmail.com`. */
  detail?: string;
  /** The `notification_preferences` column that suppressed the email. */
  pref_column?: string;
  /** Push only: how many devices this account has registered. */
  devices?: number;
};

export type TestSendResult = {
  success?: boolean;
  notification_id?: string;
  channels?: { in_app?: TestChannel; email?: TestChannel; push?: TestChannel };
};

// The email pref column the server names maps back to the row label the user
// can actually see and flip on this very screen, so the failure copy points at
// a switch rather than at a database column.
// Built from `rows` rather than hand-listed: the four columns that had no
// switch also had no entry here, so a skip attributed to `email_payments` or
// `email_system_alerts` fell through to the generic "email is turned off for
// this category" and named nothing the user could go and flip.
const EMAIL_PREF_LABEL: Record<string, string> = Object.fromEntries(
  rows.map((r) => [r.emailKey, r.label]),
);

/** `["a", "b", "c"]` -> `"a, b and c"`. */
export const joinList = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

export const emailSkipCopy = (ch: TestChannel): string => {
  switch (ch.reason) {
    case "email_disabled": {
      // The master is a column of its own now, so the server can name it as
      // the thing that suppressed the send. It has no row in `rows` and so no
      // entry in EMAIL_PREF_LABEL — without this case it would fall through to
      // "email is turned off for this category", which points at a category
      // switch that is not the one the user has to flip.
      if (ch.pref_column === "email_enabled") return "the Email master switch is off";
      const label = ch.pref_column ? EMAIL_PREF_LABEL[ch.pref_column] : undefined;
      return label
        ? `the Email switch for ${label} is off`
        : "email is turned off for this category";
    }
    case "no_email":
      return "your account has no email address on file";
    case "suppressed":
      return "your email address is on our bounce list";
    case "suppression_check_failed":
      return "we couldn't check your email address";
    default:
      return "the email was skipped";
  }
};
