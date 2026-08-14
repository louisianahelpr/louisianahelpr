import { Users, Check } from "lucide-react";

interface ApplicantQueueBannerProps {
  guest: boolean;
  applicationCount: number | null;
  viewerAppPosition: number | null;
}

/* Applicant queue banner. Two flavors:
    - **Already applied** — the viewer is in the queue. Show a
      calm green "you're #3 of 7" banner that frames their
      position relative to the rest, so they don't doom-refresh.
    - **Not yet applied** — the original "X applied — you'd be
      #(X+1) in line" sienna nudge. Only renders when there's
      at least one existing applicant, so fresh posts don't
      fire the urgency tone for nothing.

    While `applicationCount` is still loading (null), reserve the
    banner's height with a quiet pulsing skeleton row so the footer
    buttons below don't jump down when the count resolves on a slow
    network. The skeleton matches the real banner's px-3 py-2 box so
    the swap is zero-shift. */
export const ApplicantQueueBanner = ({ guest, applicationCount, viewerAppPosition }: ApplicantQueueBannerProps) => {
  return (
    <>
      {applicationCount === null && !guest ? (
        <div
          aria-hidden
          className="rounded-ds-md px-3 py-2 flex items-center gap-2 motion-safe:animate-pulse"
          style={{
            background: "hsl(var(--olivewood) / 0.05)",
            border: "0.5px solid hsl(var(--olivewood) / 0.10)",
          }}
        >
          <span
            className="w-3.5 h-3.5 shrink-0 rounded-full"
            style={{ background: "hsl(var(--olivewood) / 0.14)" }}
          />
          <span
            className="h-3 rounded-full w-2/3"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
        </div>
      ) : viewerAppPosition !== null && (
        <div
          className="rounded-ds-md px-3 py-2 flex items-center gap-2"
          style={{
            background: "hsl(var(--success-tint))",
            border: "0.5px solid hsl(var(--success-border) / 0.35)",
          }}
        >
          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--success-ink))" }} strokeWidth={2.5} />
          <p
            className="font-serif italic leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--success-ink-deep))" }}>
              You've applied.
            </span>{" "}
            You're applicant #{viewerAppPosition} of {applicationCount}.
          </p>
        </div>
      )}
      {viewerAppPosition === null && applicationCount !== null && applicationCount > 0 && (
        <div
          className="rounded-ds-md px-3 py-2 flex items-center gap-2"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <Users className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} />
          <p
            className="font-serif italic leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              {applicationCount} Helpr{applicationCount === 1 ? "" : "s"} already applied.
            </span>{" "}
            You'd be #{applicationCount + 1} in line.
          </p>
        </div>
      )}
    </>
  );
};
