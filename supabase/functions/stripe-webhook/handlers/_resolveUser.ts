/**
 * Resolve the Helpr account a Stripe subscription belongs to.
 *
 * Prefers `subscription.metadata.user_id`, which create-pro-checkout now
 * stamps onto subscription_data. Falls back to matching `profiles.email` for
 * subscriptions created before that, but ONLY when exactly one profile
 * matches — `profiles.email` has no unique constraint, so a bare
 * `.eq("email", …)` update could silently touch zero rows (paying customer
 * loses access) or several (someone else gains it). Both were possible before.
 */
export async function resolveSubscriptionUserId(
  supabase: any,
  subscription: { metadata?: Record<string, string> | null },
  email: string | null,
  logStep: (m: string, d?: unknown) => void,
): Promise<{ userId: string | null; reason?: string }> {
  const fromMetadata = subscription?.metadata?.user_id;
  if (fromMetadata) return { userId: fromMetadata };

  if (!email) return { userId: null, reason: "no user_id metadata and no customer email" };

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("email", email);

  if (error) return { userId: null, reason: `profile lookup failed: ${error.message}` };
  if (!data || data.length === 0) return { userId: null, reason: `no profile for ${email}` };
  if (data.length > 1) {
    logStep("AMBIGUOUS email match — refusing to guess", { email, matches: data.length });
    return { userId: null, reason: `${data.length} profiles share ${email}` };
  }
  return { userId: data[0].user_id };
}
