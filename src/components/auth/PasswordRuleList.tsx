// The password rule, shown under a new-password field from the start, one tick per part as it is met.
//
// F021 (owner UI audit 11-09; the lead's call, superseding the 10-25 removal, the owner may override): Sign up
// showed the rules only after a failed Continue. The follow-up gave Reset password the same up-front list, so the
// two screens that set a password say the rule the same way. The ticks run from PASSWORD_RULES (the real check);
// passwordProblem() still names what is missing after a submit.

import { Check } from "lucide-react";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES } from "@/pages/auth/signup/signupHelpers";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

export function PasswordRuleList({ password }: { password: string }) {
  const { t } = useLanguage();
  const hint = t("signup.passwordHint", { n: PASSWORD_MIN_LENGTH });
  return (
    <div data-password-rules="" className="space-y-1">
      {/* F219 (audit 11-10): the rules were written twice, a sentence and this checklist; the sentence stays as the
          list's label for a screen reader and the checklist is the one visible copy. */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={hint}>
        {PASSWORD_RULES.map((r) => {
          const met = r.test(password);
          return (
            <li key={r.needKey} data-rule-met={met ? "true" : "false"} className={`inline-flex items-center gap-1 text-ds-11 ${met ? "text-primary" : "text-muted-foreground"}`}>
              {met ? <Check className="w-3 h-3" aria-hidden /> : <span aria-hidden className="inline-block w-3 h-3 rounded-full border border-current" />}
              <span>{t(r.needKey, { n: PASSWORD_MIN_LENGTH })}</span>
              <span className="sr-only">{met ? t("signup.ruleMet") : t("signup.ruleNotMet")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
