import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Camera, Clock, IdCard, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { functionErrorBody, functionErrorMessage } from "@/lib/supabaseResult";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";
import {
  closeIdentityCheck,
  identityView,
  openIdentityCheck,
  useIdentityCheckSheet,
  type IdentityCheckReason,
  type IdentityView,
} from "@/lib/identityCheck";

/** Why it is asked now: the first sentence of the start view, per entry point. */
const LEAD: Record<IdentityCheckReason, string> = {
  start: "Before you head out on a job, Stripe checks a photo ID and a selfie.",
  post: "Before you post a job, Stripe checks a photo ID and a selfie.",
  accept: "Before your first job is booked, Stripe checks a photo ID and a selfie.",
  general: "Stripe checks a photo ID and a selfie before a member's first accepted or posted job.",
};

const COPY: Record<Exclude<IdentityView, "start">, { title: string; body: string }> = {
  continue: {
    title: "Finish your ID check",
    body: "You started an ID check with Stripe. Pick up where you left off; it takes about 2 minutes.",
  },
  checking: {
    title: "Stripe is checking your ID",
    body: "This usually takes a few minutes. We'll let you know as soon as it's done.",
  },
  with_team: {
    title: "Your ID check is with our team",
    body: "Stripe couldn't confirm it on its own, so a person on our team is looking at it. We'll let you know when it's done, usually within 24 hours.",
  },
  failed: {
    title: "We couldn't verify this ID",
    body: "Get in touch and we'll help you sort it out.",
  },
  verified: {
    title: "Your ID is verified",
    body: "Thanks. You're all set, and you won't be asked again.",
  },
};

/**
 * THE Identity sheet (spec v2 §3: a bottom sheet on phone, a centred 480px
 * dialog on desktop), mounted once in App. Every entry point opens it through
 * openIdentityCheck(): the job card before On the way, the day-of confirm, Post
 * a job, the accept dialog, Home, Settings, and the one notice
 * (`/home?verify_id=1`). Stripe sends the member back with `idv=complete`, which
 * reopens it on the honest state the webhook has written.
 */
export function IdentityCheckHost() {
  const { open, reason } = useIdentityCheckSheet();
  const { user, profile, refresh } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  // The server's own answer when it differs from the profile we hold (the
  // manual-review refusal arrives before the profile refetch does).
  const [override, setOverride] = useState<IdentityView | null>(null);

  // Entry by link: the notice (?verify_id=1) and Stripe's return (?idv=complete).
  useEffect(() => {
    const verify = params.get("verify_id") === "1";
    const back = params.get("idv") === "complete";
    if (!verify && !back) return;
    if (!user) return;
    const next = new URLSearchParams(params);
    next.delete("verify_id");
    next.delete("idv");
    setParams(next, { replace: true });
    if (back) void refresh();
    openIdentityCheck("general");
  }, [params, setParams, user, refresh]);

  // Coming back to the app is when the webhook's answer lands: refetch on open.
  useEffect(() => {
    if (open) {
      setOverride(null);
      void refresh();
    }
  }, [open, refresh]);

  const view: IdentityView = override ?? identityView(profile?.idv_status);
  const copy = view === "start" ? null : COPY[view];

  const start = async () => {
    setLoading(true);
    try {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const { data, error } = await supabase.functions.invoke("stripe-idv-start", {
        body: { native: isNativePlatform, return_path: returnPath },
      });
      if (error) {
        const body = (await functionErrorBody(error)) as { inManualReview?: boolean } | null;
        if (body?.inManualReview === true) {
          setOverride("with_team");
          return;
        }
        throw new Error(await functionErrorMessage(error, "We couldn't start the ID check"));
      }
      if (data?.alreadyVerified) {
        setOverride("verified");
        void refresh();
        return;
      }
      if (!data?.url) throw new Error("We couldn't start the ID check. Try again in a moment.");
      // Go first, close after (AwardGateDialog's lesson): on the web the page
      // leaves; in the app Stripe opens over the sheet and we refetch on return.
      await openExternalUrl(data.url, () => {
        void refresh();
        openIdentityCheck("general");
      });
      if (isNativePlatform) closeIdentityCheck();
    } catch (e: unknown) {
      report(e, { severity: "warning", tags: { area: "identity", op: "stripe-idv-start" } });
      toast.error(userFacingError(e, "We couldn't start the ID check. Try again in a moment."));
    } finally {
      setLoading(false);
    }
  };

  const primary =
    view === "start" ? { label: "Verify my ID", onClick: start }
    : view === "continue" ? { label: "Continue with Stripe", onClick: start }
    : view === "failed" ? { label: "Contact support", onClick: () => { closeIdentityCheck(); navigate("/support"); } }
    : { label: view === "verified" ? "Done" : "Got it", onClick: closeIdentityCheck };

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? undefined : closeIdentityCheck())}>
      <SheetContent side="bottom" data-testid="identity-check-sheet" data-view={view}>
        <SheetHero title={view === "start" ? "Verify your ID" : copy!.title} />
        {view === "start" ? (
          <div className="space-y-4">
            <p className="text-ds-15 text-foreground">
              {LEAD[reason]} It takes about 2 minutes, and you only do it once.
            </p>
            <ul className="space-y-3" aria-label="What you'll need">
              <Step icon={<IdCard className="w-4 h-4" />} text="A photo ID: driver's license, passport or ID card" />
              <Step icon={<Camera className="w-4 h-4" />} text="A quick selfie, to match it to you" />
              <Step icon={<ShieldCheck className="w-4 h-4" />} text="Stripe runs the check. Helpr covers its cost." />
            </ul>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 text-primary" aria-hidden>
              {view === "verified" ? <ShieldCheck className="w-5 h-5" /> : view === "failed" ? <UserRound className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
            </span>
            <p className="text-ds-15 text-foreground">{copy!.body}</p>
          </div>
        )}
        <SheetFooter className="pt-5">
          {(view === "start" || view === "continue") && (
            <SheetSecondaryAction onClick={closeIdentityCheck} disabled={loading}>Not now</SheetSecondaryAction>
          )}
          <SheetPrimaryAction onClick={primary.onClick} disabled={loading} data-testid="identity-check-primary">
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />}
            {primary.label}
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Step({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-3 text-ds-14 text-foreground">
      <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-primary bg-primary/10" aria-hidden>
        {icon}
      </span>
      {text}
    </li>
  );
}
