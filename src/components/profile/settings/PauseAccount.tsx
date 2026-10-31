import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeError, unwrap } from "@/lib/supabaseResult";
import { confirmConsequential } from "@/lib/toastPolicy";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** What a pause does, in the order it happens (true of 20261026023246 + pause-own-account). */
export const PAUSE_WHAT_HAPPENS = [
  "Your Declutter listings come down, and open offers on them close.",
  "Your profile page shows others “This member has paused their account”.",
  "Resume any time here. The listings the pause took down go back up.",
] as const;

export interface PauseRow { testId: string; label: string; sub: string; onClick: () => void }

/**
 * BOARD 120's "Pause my account" (on for everyone): a row in You › Settings › Your account.
 * Not paused: "Pause my account · Hide your profile and listings for now" opens the confirm, which
 * calls pause-own-account (refused, with the reason, while there is live work or an open job posted).
 * Paused: "Your account is paused · Resume to show your profile and listings" resumes at once
 * (account_resume). /profile?tab=settings&pause=1 (the delete sheet's "Pause instead") opens the confirm.
 */
export function PauseAccount({ children }: { children: (row: PauseRow) => ReactNode }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = ["account", "paused", user?.id] as const;
  const paused = useQuery({
    queryKey: key,
    enabled: !!user?.id,
    queryFn: async () => unwrap(await supabase.rpc("account_is_paused", { p_user_id: user!.id })) === true,
  });

  useEffect(() => {
    if (params.get("pause") !== "1") return;
    setConfirmOpen(true);
    setParams((p) => { const n = new URLSearchParams(p); n.delete("pause"); return n; }, { replace: true });
  }, [params, setParams]);

  if (paused.isLoading || paused.isError) return null;

  const pause = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("pause-own-account", { body: {} });
      if (error) {
        const e = (await functionInvokeError(error)) as { message?: string } | null;
        toast.error(e?.message || "Couldn't pause your account just now. Try again.");
        return;
      }
      const n = Number((data as { listings_paused?: number } | null)?.listings_paused ?? 0);
      confirmConsequential(n > 0 ? `Account paused. ${n} listing${n === 1 ? "" : "s"} taken down.` : "Account paused.");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  const resume = async () => {
    setBusy(true);
    const res = await supabase.rpc("account_resume");
    setBusy(false);
    if (res.error) toast.error("Couldn't resume your account. Try again.");
    else confirmConsequential("Welcome back. Your profile and listings are showing again.");
    void qc.invalidateQueries({ queryKey: key });
  };

  return (
    <>
      {paused.data
        ? children({ testId: "resume-account", label: "Your account is paused", sub: busy ? "Resuming…" : "Resume to show your profile and listings", onClick: () => { if (!busy) void resume(); } })
        : children({ testId: "pause-account", label: "Pause my account", sub: "Hide your profile page and listings for now", onClick: () => setConfirmOpen(true) })}
      <BrandConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => { if (!busy) setConfirmOpen(o); }}
        title="Pause your account?"
        description="Here's what happens."
        primaryLabel={busy ? "Pausing…" : "Pause my account"}
        primaryTone="bark"
        onPrimary={(e) => { e.preventDefault(); if (!busy) void pause(); }}
        secondaryLabel="Cancel"
      >
        <ul className="space-y-2 rounded-2xl px-4 py-3" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          {PAUSE_WHAT_HAPPENS.map((l) => <li key={l} className="text-ds-13 leading-snug">{l}</li>)}
        </ul>
      </BrandConfirmDialog>
    </>
  );
}
