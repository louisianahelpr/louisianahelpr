import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { clearPendingReferral, readPendingReferral } from "@/lib/pendingReferral";

/**
 * "Got a friend's code?" for 7 days after joining (owner 2026-10-25).
 * The email sign-up form has an optional referral field, but an Apple or
 * Google sign-up never asked for one, and someone who forgot to type it had no
 * second chance (prod 2026-10-25: 283 codes, 3 referrals ever). The server
 * decides everything (public.claim_my_referral_code): the 7-day window, once
 * per account, a real code, not your own.
 */
const REFERRAL_CLAIM_DAYS = 7;

const ANSWERS: Record<string, string> = {
  recorded: "Done. You and your friend each get $5 once you finish your first job.",
  no_such_code: "We couldn't find that code. Check it with your friend and try again.",
  own_code: "That's your own code. Share it with friends instead.",
  already_referred: "Your account already has a referral code.",
  too_late: `Codes can be added within ${REFERRAL_CLAIM_DAYS} days of joining.`,
  invalid: "Enter the code your friend shared.",
  failed: "That didn't go through. Check your connection and try again.",
};

/** The days left to add a code, or 0 when the window has passed. */
export function referralClaimDaysLeft(createdAt: string | null | undefined, now = Date.now()): number {
  if (!createdAt) return 0;
  const left = REFERRAL_CLAIM_DAYS - (now - new Date(createdAt).getTime()) / 86_400_000;
  return left > 0 ? Math.ceil(left) : 0;
}

export function EnterReferralCodeCard() {
  // When the account was created, from the signed-in session (no extra read).
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (live) setCreatedAt(data.session?.user?.created_at ?? null);
    });
    return () => {
      live = false;
    };
  }, []);
  const [code, setCode] = useState(readPendingReferral);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  // A refusal the server words (account_restricted): its own copy, never "check your connection".
  const [refusal, setRefusal] = useState<string | null>(null);
  const daysLeft = referralClaimDaysLeft(createdAt);

  useEffect(() => {
    if (answer === "recorded" || answer === "already_referred") clearPendingReferral();
  }, [answer]);

  if (daysLeft === 0 || answer === "recorded" || answer === "already_referred") {
    return answer ? <p className="text-ds-13 text-muted-foreground" data-testid="referral-claim-answer">{ANSWERS[answer]}</p> : null;
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("claim_my_referral_code", { p_code: code });
      if (error) {
        const copy = rpcErrorMessage("claim_my_referral_code", error);
        if (copy) {
          setRefusal(copy);
          setAnswer(null);
          return;
        }
        throw error;
      }
      setRefusal(null);
      setAnswer(typeof data === "string" && data in ANSWERS ? data : "invalid");
    } catch (e) {
      report(e, { tags: { source: "EnterReferralCodeCard" } });
      setAnswer("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[20px] liquid-glass p-card space-y-3" data-testid="enter-referral-code-card">
      <Label htmlFor="claimReferralCode" className="text-ds-15 font-semibold text-foreground">
        Got a friend&apos;s code?
      </Label>
      <p className="text-ds-13 text-muted-foreground">
        Add it in the next {daysLeft} {daysLeft === 1 ? "day" : "days"} and you both get $5 once you finish your first job.
      </p>
      <div className="flex gap-2">
        <Input
          id="claimReferralCode"
          value={code}
          onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
          placeholder="e.g. FUHNW3"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="button" onClick={submit} disabled={busy || !code}>
          {busy ? "Adding…" : "Add"}
        </Button>
      </div>
      {(refusal ?? answer) && <p className="text-ds-12 text-muted-foreground" data-testid="referral-claim-answer">{refusal ?? ANSWERS[answer!]}</p>}
    </div>
  );
}
