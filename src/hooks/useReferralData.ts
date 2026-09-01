import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";

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
  if (referralsRes.error) throw referralsRes.error;
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
    if (insertErr) report(insertErr, { context: { where: "referral_codes.insert", userId } });
    referralCode = inserted?.code ?? null;
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
