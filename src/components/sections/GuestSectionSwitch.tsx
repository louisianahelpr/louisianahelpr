import { useNavigate } from "react-router-dom";
import { FilterChips } from "@/components/ui/FilterChips";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";
import { useLanguage } from "@/lib/i18n/language";

type GuestSection = "jobs" | "declutter";
const PATH: Record<GuestSection, string> = { jobs: "/browse", declutter: "/declutter" };

/**
 * M13 (iOS design audit 11-16): a guest's first screen (/browse) was four jobs with no visible label and no way to
 * Declutter, though Declutter is open to everyone. Both guest screens now start with the same labelled switch,
 * "Jobs | Declutter", the selected one pressed (the shared FilterChips, the Inbox's filter row), so a guest sees which
 * section this is and reaches the other in one tap. Declutter is offered only while it is open to everyone (the same
 * features_open_to_everyone answer DeclutterGate reads); with only Jobs the switch is not drawn.
 * Guard: src/test/guestFirstScreenSwitch.test.tsx.
 */
export function GuestSectionSwitch({ at, className = "" }: { at: GuestSection; className?: string }) {
  // Guest Declutter is only drawn while Declutter is open to everyone (DeclutterGate), so it asks nothing.
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { open } = useSectionsOpen(at !== "declutter");
  if (at !== "declutter" && !open?.has("declutter")) return null;
  return (
    <div className={className} data-guest-section-switch="">
      <FilterChips<GuestSection>
        chips={[{ value: "jobs", label: t("nav.jobs") }, { value: "declutter", label: t("nav.declutter") }]}
        value={at}
        onChange={(next) => { if (next !== at) navigate(PATH[next]); }}
        label={t("nav.sections")}
        chipAttr="data-guest-section"
      />
    </div>
  );
}
