import { getLang } from "@/lib/i18n/language";
import { wordInLang } from "@/lib/i18n/inLang";

/**
 * An inbox row's age, relative so the list reads as "active", not as a stack
 * of full dates: "now", "5m", "3h", "2d", then "Oct 4".
 */
export function rowAge(lastAt: string, now: number = Date.now()): string {
  const ageMin = Math.floor((now - new Date(lastAt).getTime()) / 60000);
  const ageHr = Math.floor(ageMin / 60);
  const ageDay = Math.floor(ageHr / 24);
  // Design audit r2 #34: in the reader's language ("Nov 5" read English in the Spanish inbox).
  return ageMin < 1 ? wordInLang("msg.age.now", "now") :
    ageMin < 60 ? wordInLang("msg.age.min", `${ageMin}m`, { n: ageMin }) :
    ageHr < 24 ? wordInLang("msg.age.h", `${ageHr}h`, { n: ageHr }) :
    ageDay < 7 ? wordInLang("msg.age.d", `${ageDay}d`, { n: ageDay }) :
    new Date(lastAt).toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", { month: "short", day: "numeric" });
}
