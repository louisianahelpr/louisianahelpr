/**
 * L7 (share-profile audit 11-05; owner: search engines are OPT-IN per person, default off). Settings › Your profile
 * link › "Show my profile in search engines" writes profiles.show_in_search (self-writable column,
 * 20261105165059). While it is off, /u/<handle> says "noindex" on the page (PublicProfilePage) and in its link card
 * (api/share.ts); on, "index, follow".
 */
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import "@/lib/i18n/enAccount";
import { t, useLanguage } from "@/lib/i18n/language";

export function ShowInSearchSwitch({ userId, initial }: { userId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  const id = useId();
  useLanguage();
  // The profile can refresh after first paint: follow it unless a write is in flight.
  useEffect(() => {
    if (!saving) setOn(initial);
    // Only a new server value moves the switch; `saving` is read at that moment on purpose.
  }, [initial]);
  const change = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      unwrapMutation(
        await supabase.from("profiles").update({ show_in_search: next }).eq("user_id", userId).select("id"),
        { action: "save your search engine setting", context: { next } },
      );
      setOn(next);
    } catch (err) {
      report(err, { severity: "error", tags: { source: "ShowInSearchSwitch" } });
      toast.error(t("acct.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  return (
    // Phone polish C #30 (11-25): centred like every other Settings switch row (it sat top-aligned beside 4 lines).
    <div className="flex items-center gap-3" data-testid="show-in-search">
      <label htmlFor={id} className="flex-1 min-w-0">
        <span className="block text-ds-15 font-semibold leading-tight text-foreground">{t("acct.searchTitle")}</span>
        <span className="block text-ds-13 text-muted-foreground mt-0.5">{t("acct.searchBody")}</span>
      </label>
      <Switch id={id} checked={on} disabled={saving} aria-busy={saving || undefined} onCheckedChange={(v) => void change(v)} />
    </div>
  );
}
