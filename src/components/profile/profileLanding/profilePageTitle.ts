import { getLang, t } from "@/lib/i18n/language";
import { PROFILE_PAGE_TITLE } from "./headingContract";

/**
 * The page title the member reads (design audit r2 #31): "You" in English, the dock's own word in Spanish ("Perfil",
 * nav.you), so the bar, the dock and the rail say one word. Callers subscribe with useLanguage() to re-render.
 * Its own module (not headingContract.ts) because the sign-back-in journey imports the contract in Node.
 */
export function profilePageTitle(): string {
  return getLang() === "es" ? t("nav.you") : PROFILE_PAGE_TITLE;
}
