import { Link } from "react-router-dom";
import { useLanguage } from "@/lib/i18n/language";
import { Button } from "@/components/ui/button";

/**
 * F259g (audit 11-10): after one miss the nudge is a full-width outline button on its own line under the words
 * ("Forgot your password? We can email you a reset link."), not a second small "Forgot password?" link squeezed
 * between the error and the one on the Password row.
 */
export const LoginForgotNudge = ({ state }: { state: unknown }) => {
  const { t } = useLanguage();
  return (
    <Button asChild variant="outline" size="wrapSm" className="basis-full mt-1 text-ds-13">
      <Link to="/forgot-password" state={state} data-login-forgot-nudge="">
        {t("login.forgotNudge")}
      </Link>
    </Button>
  );
};
