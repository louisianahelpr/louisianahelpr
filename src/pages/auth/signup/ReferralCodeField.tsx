// The optional "Have a referral code?" disclosure on the one sign-up form (moved out of the retired SignupStep2,
// owner 11-23: there is no second screen). Guard: src/test/referralCodeEnterable.test.ts.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

/**
 * Optional "Have a referral code?" disclosure.
 *
 * Exists because a referral code could previously arrive ONLY through a
 * `?ref=` deep link, so anyone who HEARD a code, read it on a flyer, or saw it
 * in a comment had no way to use it at all.
 *
 * Deliberately not a required field and deliberately without validation: an
 * unknown or mistyped code must never be the reason a signup fails. The code
 * is upper-cased and trimmed as the user types, mirroring what process_referral
 * does server-side, so casing and stray whitespace can never be the reason a
 * real code does not match.
 */
export function ReferralCodeField({
  referralCode,
  setReferralCode,
  inputCls,
  labelCls,
}: {
  referralCode: string;
  setReferralCode: (v: string) => void;
  inputCls: string;
  labelCls: string;
}) {
  // Open from the start when a link already supplied a code — a pre-filled
  // field hidden behind a closed toggle is a value the user never consented to.
  const [open, setOpen] = useState(() => referralCode.trim().length > 0);
  const { t } = useLanguage();

  return (
    <div className="space-y-2">
      {!open && (
        <InlineTextButton
          data-testid="referral-code-toggle"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-ds-12 underline"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          aria-expanded={false}
        >
          {t("signup.referralAsk")}
          <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
        </InlineTextButton>
      )}
      {open && (
        <>
          <Label htmlFor="referralCode" className={labelCls}>
            {t("signup.referral")}{" "}
            <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              {t("signup.optional")}
            </span>
          </Label>
          <Input
            id="referralCode"
            data-testid="referral-code-input"
            value={referralCode}
            // Normalise as they type: the referral RPC accepts " fuhnw3 " and
            // resolves it to FUHNW3, so showing the canonical form back is
            // honest about what will be sent.
            onChange={(e) => setReferralCode(e.target.value.trim().toUpperCase())}
            placeholder={t("signup.referralExample")}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            className={inputCls}
          />
          <p className="text-ds-11 text-muted-foreground">
            {t("signup.referralHelp")}
          </p>
        </>
      )}
    </div>
  );
}
