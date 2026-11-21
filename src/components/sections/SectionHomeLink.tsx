import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";

/**
 * Owner 11-20 (site polish A1): the small "← Home" link above a section's heading on a guest's public page (passed to
 * SectionScreen's `homeLink`, which draws it only in the guest frame). Its own file so it loads with the page that
 * draws it (Declutter's Browse), not with SectionScreen on every member screen.
 */
export function SectionHomeLink() {
  const { t } = useLanguage();
  return (
    <Link to="/" data-section-home-link="" className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-sm text-ds-13 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {t("nav.home")}
    </Link>
  );
}
