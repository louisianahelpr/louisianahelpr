import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { isAccountRestricted } from "@/lib/banStatus";

interface ReferralCredit {
  id: string;
  amount: number;
  reason: string;
  redeemed: boolean;
  created_at: string;
}

export interface ReferralData {
  referralCode: string | null;
  credits: ReferralCredit[];
  referralCount: number;
  hasStripeAccount: boolean;
}

const generateCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

/** The insert lost a race to another mint for the same user (not a code collision). */
function isUserCodeTaken(err: { code?: string; message?: string }): boolean {
  return err.code === "23505" && /referral_codes_user_id_key/.test(err.message ?? "");
}

export async function fetchReferralData(userId: string): Promise<ReferralData> {
  const [codeRes, creditsRes, referralsRes, profileRes] = await Promise.all([
    supabase.from("referral_codes").select("code").eq("user_id", userId).maybeSingle(),
    supabase.from("referral_credits").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("referrals").select("*", { count: "exact", head: true }).eq("referrer_id", userId),
    supabase.from("profiles").select("stripe_account_id").eq("user_id", userId).single(),
  ]);

  // Surface a failed read as a query error instead of silently
  // returning blank data. Critically, a transient failure on the code
  // lookup must throw *here* — otherwise it falls through to inserting
  // a brand-new referral code even though the user already has one.
  // A HEAD count (no body, so no code): unwrap() carries its HTTP status (Q1182).
  unwrap(referralsRes);
  const codeRow = unwrap(codeRes);
  const credits = unwrap(creditsRes);
  const profile = unwrap(profileRes);

  let referralCode: string | null = codeRow?.code ?? null;
  if (!referralCode) {
    const newCode = generateCode();
    // A failed insert must not vanish: the user would see a missing
    // referral code with no telemetry. Report it (non-fatal — the page
    // still renders without a code) instead of dropping the error.
    const { data: inserted, error: insertErr } = await supabase
      .from("referral_codes")
      .insert({ user_id: userId, code: newCode })
      .select("code")
      .single();
    // A banned account's mint is refused by enforce_ban_gate (account_restricted).
    // That is the ban working, not a fault: the page still renders without a
    // code and the account screen explains the ban, so it is not sent to Sentry
    // (Q302: otherwise every banned sign-in reported an error).
    // Two concurrent loads can each find no code and each mint one; the second
    // insert then hits referral_codes_user_id_key (23505). That is not a
    // fault: the user HAS a code, the other insert wrote it. Read it back
    // instead of reporting and returning none (prod 2026-10-09, a new member:
    // one code stored, one 23505 in error_logs).
    if (insertErr && isUserCodeTaken(insertErr)) {
      const { data: existing, error: rereadErr } = await supabase
        .from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
      if (rereadErr) report(rereadErr, { context: { where: "referral_codes.reread", userId } });
      referralCode = existing?.code ?? null;
    } else {
      if (insertErr && !isAccountRestricted(insertErr)) {
        report(insertErr, { context: { where: "referral_codes.insert", userId } });
      }
      referralCode = inserted?.code ?? null;
    }
  }

  return {
    referralCode,
    credits: (credits as ReferralCredit[]) || [],
    referralCount: referralsRes.count || 0,
    hasStripeAccount: !!profile?.stripe_account_id,
  };
}

export function useReferralData(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? queryKeys.referral.byUser(userId) : ["referral", "anon"],
    queryFn: () => fetchReferralData(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}
