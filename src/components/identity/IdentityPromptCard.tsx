import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { identityView, openIdentityCheck, type IdentityCheckReason } from "@/lib/identityCheck";

/** The prompt's line, honest about where the check stands (the sheet's states). */
const LINE: Record<string, { title: string; body: string; cta: string | null }> = {
  start: {
    title: "Verify your ID with Stripe",
    body: "Before your next job, Stripe checks a photo ID and a selfie. It takes about 2 minutes, once.",
    cta: "Verify my ID",
  },
  continue: { title: "Finish your ID check", body: "You started it with Stripe. Pick up where you left off.", cta: "Continue" },
  checking: { title: "Stripe is checking your ID", body: "This usually takes a few minutes. We'll let you know.", cta: null },
  // Not a dead end (owner report 2026-10-21): the sheet offers a fresh Stripe check.
  with_team: {
    title: "Your ID check is with our team",
    body: "We'll let you know when it's done, usually within 24 hours. You can also start a fresh check.",
    cta: "See options",
  },
  failed: { title: "We couldn't verify this ID", body: "Get in touch and we'll help you sort it out.", cta: "See what to do" },
};

/**
 * The Stripe Identity line on a hired Helpr's job card (owner 2026-10-30: never
 * on Home, a checklist or a posted job). The caller decides WHEN
 * (needsIdentityCheck on an active hire); this says where the check stands and
 * opens the one ID sheet.
 */
export function IdentityPromptCard({
  idvStatus,
  reason = "general",
  compact = false,
}: {
  idvStatus: string | null | undefined;
  reason?: IdentityCheckReason;
  compact?: boolean;
}) {
  // ID check off (switch `identity_check`, owner 2026-10-23): no prompt at all.
  const idOn = useIdentityCheckOnStore();
  const view = identityView(idvStatus);
  if (!idOn || view === "verified") return null;
  const line = LINE[view];
  const open = () => openIdentityCheck(reason);
  if (compact) {
    return (
      <div data-testid="identity-prompt-line" className="flex items-center gap-2 text-ds-13 text-foreground">
        <ShieldCheck className="w-4 h-4 shrink-0 text-primary" aria-hidden />
        <span className="flex-1 min-w-0">{line.title}</span>
        {line.cta && (
          <Button type="button" variant="ghost" size="sm" onClick={open} className="-my-2 px-1 text-ds-13 tracking-normal text-primary">
            {line.cta}
          </Button>
        )}
      </div>
    );
  }
  return (
    <section data-testid="identity-prompt" aria-label="Verify your ID" className="liquid-glass p-card flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 shrink-0 text-primary" aria-hidden />
        <h2 className="text-ds-16 font-bold text-foreground">{line.title}</h2>
      </div>
      <p className="text-ds-14 text-muted-foreground">{line.body}</p>
      {line.cta && (
        <Button type="button" size="sm" onClick={open} className="btn-press self-start px-5 mt-2 text-ds-15 font-semibold tracking-normal shadow-none">
          {line.cta}
        </Button>
      )}
    </section>
  );
}
