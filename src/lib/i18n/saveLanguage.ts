/**
 * F260q (lead 11-11): the member's language follows the ACCOUNT, so server-written words (emails, push titles) can
 * read it. setLang() (language.ts) loads this on its own chunk and calls saveLanguage(); a signed-out visitor writes
 * nothing (the device copy in safeStorage stays the only one). profiles.language is self-writable through a column
 * grant (20261111213927_profile_language.sql) under the own-row policy. Zero rows back is a real miss (a signed-in
 * member always has a profile row), so it is reported; a failure never blocks the switch on screen.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import type { Lang } from "./language";

export async function saveLanguage(lang: Lang): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;
    unwrapMutation(
      await supabase.from("profiles").update({ language: lang }).eq("user_id", userId).select("user_id"),
      { action: "save your language" },
    );
  } catch (err) {
    report(err, { severity: "warning", tags: { area: "i18n", op: "saveLanguage" } });
  }
}
