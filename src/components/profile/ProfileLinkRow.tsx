import { useState } from "react";
import { ChevronRight, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  HANDLE_PATTERN,
  ensureMyHandle,
  profileLinkLabel,
  setMyHandle,
  shareMyProfile,
} from "@/lib/profileLink/api";

/**
 * SETTINGS › YOUR ACCOUNT › "Your profile link" (LEAD-PROFILE-LINK, owner 2026-10-31):
 * one shareable link, louisianahelpr.com/u/<handle>, showing what the member posts and does.
 *
 * Nothing is fetched until the row is opened: the handle is made the first time it is needed
 * (rpc_ensure_my_handle), so opening Settings never writes. Open, it shows the link, the
 * "Share my profile" button, and "Change link" while the member has not changed it yet
 * (rpc_set_my_handle, once; the server refuses a second change either way).
 */
export function ProfileLinkRow({ name, changedOnce }: { name?: string | null; changedOnce?: boolean }) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(!!changedOnce);

  const load = async () => {
    setLoading(true);
    setError(null);
    const r = await ensureMyHandle();
    setLoading(false);
    if (r.error !== undefined) setError(r.error);
    else setHandle(r.handle);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !handle && !loading) void load();
  };

  const normalised = draft.trim().toLowerCase();
  const draftOk = HANDLE_PATTERN.test(normalised);

  const save = async () => {
    if (!draftOk || saving) return;
    setSaving(true);
    setError(null);
    const r = await setMyHandle(normalised);
    setSaving(false);
    if (r.error !== undefined) {
      setError(r.error);
      return;
    }
    setHandle(r.handle);
    setChanged(true);
    setEditing(false);
  };

  return (
    <Collapsible open={open} onOpenChange={toggle} data-settings-row="profile-link">
      <CollapsibleTrigger
        className="glass-press ctl-tint transition-colors w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-ds-15 font-semibold leading-tight text-foreground">Your profile link</span>
          <span className="block text-ds-13 text-muted-foreground mt-0.5 break-all">
            {handle ? profileLinkLabel(handle) : "One link to what you post and do"}
          </span>
        </span>
        <ChevronRight className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent id="profile-link-panel" className="px-4 pb-4 flex flex-col gap-3">
        {loading && (
          <p className="flex items-center gap-2 text-ds-13 text-muted-foreground" role="status">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Getting your link…
          </p>
        )}
        {error && (
          <p className="text-ds-13" style={{ color: "hsl(var(--alert-ink))" }} role="alert">
            {error}
          </p>
        )}
        {!handle && !loading && error && (
          <Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>
        )}
        {handle && !editing && (
          <>
            <p className="text-ds-13 text-muted-foreground">
              Anyone with the link sees your listings, open jobs, Helpr work and Wanted posts. Never your address or contact info.
            </p>
            <Button type="button" data-share-my-profile onClick={() => void shareMyProfile(handle, name)} className="gap-2">
              <Share2 className="w-4 h-4" aria-hidden /> Share my profile
            </Button>
            {!changed && (
              <Button type="button" variant="ghost" onClick={() => { setDraft(handle); setError(null); setEditing(true); }}>
                Change link (once)
              </Button>
            )}
          </>
        )}
        {handle && editing && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <label htmlFor="profile-handle" className="text-ds-13 font-semibold text-foreground">New link</label>
            <div className="flex items-center gap-1 text-ds-13 text-muted-foreground">
              <span className="shrink-0">louisianahelpr.com/u/</span>
              <Input
                id="profile-handle"
                value={draft}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="profile-handle-hint"
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <p id="profile-handle-hint" className="text-ds-12 text-muted-foreground">
              3 to 30 letters, numbers or single hyphens. You can change it once.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
              <Button type="submit" disabled={!draftOk || saving} aria-busy={saving || undefined}>
                {saving ? "Saving…" : "Save link"}
              </Button>
            </div>
          </form>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
