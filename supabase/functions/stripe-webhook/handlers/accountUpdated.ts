import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handleAccountUpdated(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const account = event.data.object as Stripe.Account;
  logStep("Connect account updated", { accountId: account.id, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });

  // Find the helper with this Stripe account
  // Throw rather than drop: this lookup gates Stripe-verified AUTO-APPROVAL.
  // Swallowing the error silently skipped the approval, leaving a helper who
  // passed Stripe's identity checks stuck in `pending` forever with nothing
  // logged and no retry. The 500 path makes Stripe redeliver instead.
  const { data: helperProfile, error: helperProfileError } = await supabase
    .from("profiles")
    .select("user_id, full_name, approval_status, email_verified")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  if (helperProfileError) {
    throw new Error(`helper lookup failed for account ${account.id}: ${helperProfileError.message}`);
  }

  if (helperProfile) {
    if (account.charges_enabled && account.payouts_enabled) {
      // Auto-approve: Stripe verified identity (free database matching: SSN/IRS/credit bureau)
      // Requirement: email verified + Stripe charges + payouts enabled
      const shouldAutoApprove =
        helperProfile.email_verified === true &&
        helperProfile.approval_status === "pending";

      if (shouldAutoApprove) {
        const { error: approvalErr } = await supabase
          .from("profiles")
          .update({ approval_status: "approved" })
          .eq("user_id", helperProfile.user_id);

        if (approvalErr) {
          // Throw so the outer handler rolls back the idempotency row and returns
          // 500, letting Stripe retry once the DB recovers. A plain log + 200 here
          // permanently drops the approval: Stripe won't retry, the helper stays
          // stuck in "pending" status despite Stripe verifying them, and there is
          // no follow-up event to trigger a re-attempt unless they change their
          // Connect account again. Matches the throw-on-DB-error pattern in
          // customerSubscriptionDeleted, customerSubscriptionUpdated, etc.
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "account.updated — helper auto-approval DB write failed",
            message: `Stripe verified helper ${helperProfile.user_id} (charges + payouts enabled) but the profiles UPDATE (approval_status → approved) failed. Helper stays in "pending" until the DB recovers and Stripe retries this event.`,
            fields: {
              user_id: helperProfile.user_id,
              account_id: account.id,
              db_error: approvalErr.message.slice(0, 200),
            },
          });
          throw new Error(`Failed to auto-approve helper ${helperProfile.user_id} for account ${account.id}: ${approvalErr.message}`);
        } else {
          logStep("✅ Auto-approved helper via Stripe verification", { userId: helperProfile.user_id });
          await supabase.from("notifications").insert({
            user_id: helperProfile.user_id,
            title: "Welcome in.",
            message: "Your identity and payout account are set. You're cleared to accept jobs.",
            type: "success",
            link: "/dashboard",
          });
        }
      } else {
        await supabase.from("notifications").insert({
          user_id: helperProfile.user_id,
          title: "Payout account verified",
          message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
          type: "success",
          link: "/profile",
        });
        logStep("Helper payout account verified (no auto-approve needed)", { userId: helperProfile.user_id, email_verified: helperProfile.email_verified, approval_status: helperProfile.approval_status });
      }
    } else if (account.requirements?.currently_due && account.requirements.currently_due.length > 0) {
      await supabase.from("notifications").insert({
        user_id: helperProfile.user_id,
        title: "Payout account needs attention",
        message: "Your payout account requires additional information. Please update your details to continue receiving payments.",
        type: "warning",
        link: "/profile",
      });
      logStep("Helper account needs attention", { userId: helperProfile.user_id, due: account.requirements.currently_due });
    }
  }
}
