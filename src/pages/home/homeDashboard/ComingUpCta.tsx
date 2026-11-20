/**
 * Owner polish 11-20: Home's empty "Coming up · Nothing booked yet" offers the two ways to book something: Post a job
 * (behind the same age gate as the Create pill, like WelcomeCard) and Find work (the jobs feed). Outline buttons, so
 * Home keeps its one primary action. Guard: src/test/homeComingUpCta1120.test.tsx.
 */
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAgeGate } from "@/hooks/useAgeGate";
import "@/lib/i18n/enHome";
import { useLanguage } from "@/lib/i18n/language";

export function ComingUpCta() {
  const navigate = useNavigate();
  const gate = useAgeGate();
  const { t } = useLanguage();
  return (
    <div data-coming-up-cta="" className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" data-coming-up-post="" onClick={gate.gate("post", () => navigate("/post-job"))} className="px-4 text-ds-14 font-semibold tracking-normal">
        {t("home.cu.postJob")}
      </Button>
      <Button type="button" variant="outline" size="sm" data-coming-up-find="" onClick={() => navigate("/jobs")} className="px-4 text-ds-14 font-semibold tracking-normal">
        {t("home.cu.findWork")}
      </Button>
    </div>
  );
}
