import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

/**
 * Early warning on the PLATFORM's own Stripe account (owner 2026-10-25, after
 * Stripe closed the account on 2026-10-23 01:56 CDT and restored it at 16:38).
 *
 * account.updated for our own account arrives with no `event.account` (a
 * connected account's event carries its id there). It used to fall through
 * handleAccountUpdated's profile lookup and be skipped with "no profile links
 * this account", so a requirement, a review or a lost capability on the
 * account every payment runs through reached nobody. Now any such state pages
 * #ops-alerts as money_at_risk (always critical), and so does a recovery, so
 * the owner can answer Stripe within hours instead of finding out when
 * payments stop.
 */

/** Capabilities the app runs on: card checkout and transfers to Helprs. */
const NEEDED_CAPABILITIES = ["card_payments", "transfers"] as const;

interface PlatformAccountProblems {
  problems: string[];
  healthy: boolean;
}

/**
 * Everything about the platform account that needs the owner, in plain words.
 * @public src/test/edge/platformAccountUpdated.test.ts loads it by a non-literal path.
 */
export function platformAccountProblems(account: Stripe.Account): PlatformAccountProblems {
  const problems: string[] = [];
  if (account.charges_enabled === false) problems.push("charges are OFF (nobody can pay by card)");
  if (account.payouts_enabled === false) problems.push("payouts to our bank are OFF");
  const req = account.requirements;
  if (req?.disabled_reason) problems.push(`Stripe disabled the account: ${req.disabled_reason}`);
  if (req?.past_due?.length) problems.push(`past due: ${req.past_due.join(", ")}`);
  if (req?.currently_due?.length) {
    const deadline = req.current_deadline ? ` by ${new Date(req.current_deadline * 1000).toISOString()}` : "";
    problems.push(`Stripe needs: ${req.currently_due.join(", ")}${deadline}`);
  }
  const future = account.future_requirements;
  if (future?.currently_due?.length) problems.push(`coming up: ${future.currently_due.join(", ")}`);
  const caps = (account.capabilities ?? {}) as Record<string, string | undefined>;
  for (const cap of NEEDED_CAPABILITIES) {
    const status = caps[cap];
    if (status && status !== "active") problems.push(`${cap} is ${status}`);
  }
  return { problems, healthy: problems.length === 0 };
}

/** Pages on a platform-account problem, and on the account looking healthy again. */
export async function handlePlatformAccountUpdated(
  event: Stripe.Event,
  logStep: (msg: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  const account = event.data.object as Stripe.Account;
  const { problems, healthy } = platformAccountProblems(account);
  // A change that cleared earlier problems reads healthy now; say so once.
  const prev = (event.data.previous_attributes ?? {}) as Partial<Stripe.Account>;
  const wasRestricted = prev.charges_enabled === false || prev.payouts_enabled === false ||
    Boolean(prev.requirements && (prev.requirements.currently_due?.length || prev.requirements.past_due?.length || prev.requirements.disabled_reason));
  if (healthy && !wasRestricted) {
    logStep("Platform account.updated: healthy, nothing to report", { accountId: account.id });
    return;
  }
  const posted = await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: healthy ? "Stripe: our main account is healthy again" : "Stripe: our main account needs attention NOW",
    message: healthy
      ? "Charges and payouts are on and Stripe needs nothing right now."
      : `Stripe changed our main account. ${problems.join("; ")}. Open the Stripe dashboard and answer today: an unanswered requirement can pause payments and payouts.`,
    fields: { account: account.id, event: event.id, charges_enabled: String(account.charges_enabled), payouts_enabled: String(account.payouts_enabled) },
    link: "https://dashboard.stripe.com/",
  });
  logStep("Platform account.updated: alert", { accountId: account.id, healthy, problems, posted });
}
